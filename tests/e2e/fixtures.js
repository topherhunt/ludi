const { test: base, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Shared state across all tests
let viteProcess = null;
let electronApp = null;
let window = null;
const consoleMessages = [];
const consoleErrors = [];

async function setupElectronApp() {
  if (electronApp) {
    return { electronApp, window, consoleMessages, consoleErrors };
  }

  // Clean up test database and library before running tests
  const testDbPath = path.join(os.homedir(), '.ludi', 'ludi-library-test.sqlite');
  const testLibraryPath = path.join(os.homedir(), '.ludi', 'library-test');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  if (fs.existsSync(testLibraryPath)) {
    fs.rmSync(testLibraryPath, { recursive: true, force: true });
  }

  // Start Vite dev server
  viteProcess = spawn('npm', ['run', 'vite'], {
    cwd: path.join(__dirname, '../..'),
    stdio: 'pipe',
    shell: true
  });

  // Wait for Vite to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Vite server did not start within 30 seconds'));
    }, 30000);

    viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Vite]:', output);
      if (output.includes('Local:') || output.includes('ready')) {
        clearTimeout(timeout);
        setTimeout(resolve, 1000);
      }
    });

    viteProcess.stderr.on('data', (data) => {
      console.error('[Vite stderr]:', data.toString());
    });

    viteProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Launch Electron in dev mode
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../..', 'src', 'main', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VITE_DEV: 'true'
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

  if (viteProcess) {
    viteProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 500));
    viteProcess = null;
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
