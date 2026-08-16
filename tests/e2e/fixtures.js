const { test: base, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { startViteServer } = require('../../scripts/vite-server');

// Shared state across all tests
let viteServer = null;
let electronApp = null;
let window = null;
const consoleMessages = [];
const consoleErrors = [];

async function setupElectronApp() {
  if (electronApp) {
    return { electronApp, window, consoleMessages, consoleErrors };
  }

  // Clean up test database and library before running tests.
  // Must match the 'test' mode paths in src/main/database.js.
  const testDbPath = path.join(os.homedir(), '.ludi', 'ludi-library-test.sqlite');
  const testLibraryPath = path.join(os.homedir(), 'Music', 'Ludi Library Test');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  if (fs.existsSync(testLibraryPath)) {
    fs.rmSync(testLibraryPath, { recursive: true, force: true });
  }

  // The test suite gets its own dev server on its own port, reaping anything a
  // previous run left behind. See scripts/vite-server.js -- a killed test run
  // used to leak a fully functional Vite server every time.
  viteServer = await startViteServer({
    role: 'test',
    onOutput: (text) => console.log('[Vite]:', text),
  });
  // Vite reports "ready" a beat before it will serve the first module.
  await new Promise(resolve => setTimeout(resolve, 1000));
  const vitePort = String(viteServer.port);

  // Launch Electron in dev mode
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../..', 'src', 'main', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VITE_DEV: 'true',
      VITE_PORT: vitePort
    }
  });

  // Wait for the window
  window = await electronApp.firstWindow({ timeout: 15000 });

  // Capture console messages for debugging
  window.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  window.on('pageerror', error => {
    consoleErrors.push(`[pageerror] ${error.message}`);
  });

  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(500);

  // A clean slate has to include the UI state the renderer persists, not just
  // the database. Sidebar width and column visibility live in localStorage,
  // which survives in the Electron profile forever -- so the run that resized
  // the sidebar moved every LATER run's columns 30px right, far enough that the
  // centre of a song row (where `row.click()` lands) stopped being dead space in
  // the rating column and became a star. Clicking a star deliberately doesn't
  // change the selection, so a dozen specs across tags, song-edit-panel and
  // similarity started failing on a machine that had once run sidebar-resize.
  await window.evaluate(() => localStorage.clear());
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(500);

  // Set volume low to avoid disruption during tests
  await window.evaluate(() => {
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
      volumeSlider.value = 10;
      volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  return { electronApp, window, consoleMessages, consoleErrors };
}

async function teardownElectronApp() {
  if (electronApp) {
    await electronApp.close();
    electronApp = null;
    window = null;
  }

  if (viteServer) {
    viteServer.stop();
    await new Promise(resolve => setTimeout(resolve, 500));
    viteServer = null;
  }
}

// Create the extended test with fixtures
const test = base.extend({
  // Fixture that provides the shared Electron app
  electronApp: async ({}, use) => {
    const { electronApp } = await setupElectronApp();
    await use(electronApp);
  },

  // Fixture that provides the main window
  window: async ({}, use) => {
    const { window } = await setupElectronApp();
    await use(window);
  },

  // Fixture that provides console messages
  consoleMessages: async ({}, use) => {
    const { consoleMessages } = await setupElectronApp();
    await use(consoleMessages);
  },

  // Fixture that provides console errors
  consoleErrors: async ({}, use) => {
    const { consoleErrors } = await setupElectronApp();
    await use(consoleErrors);
  },
});

// Export for use in test files
module.exports = {
  test,
  expect: require('@playwright/test').expect,
  setupElectronApp,
  teardownElectronApp,
  // Export path for test audio files
  testAudioDir: path.join(__dirname, '../test-audiofiles'),
};
