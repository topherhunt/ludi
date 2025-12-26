const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

test.describe('SolidJS Setup', () => {
  let viteProcess;
  let electronApp;
  let window;
  const consoleMessages = [];
  const consoleErrors = [];

  test.beforeAll(async () => {
    // Start Vite dev server
    viteProcess = spawn('npm', ['run', 'vite'], {
      cwd: path.join(__dirname, '..'),
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
          // Give Vite a moment to fully initialize
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

    // Launch Electron in Solid dev mode
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'src', 'main', 'main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SOLID_DEV: 'true'
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

    // Wait for Solid to render (give it more time)
    await window.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    // Close Electron
    if (electronApp) {
      await electronApp.close();
    }

    // Kill Vite server
    if (viteProcess) {
      viteProcess.kill('SIGTERM');
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });

  test('should load SolidJS app from Vite dev server', async () => {
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    // Debug: print what's in the page
    const bodyHTML = await window.evaluate(() => document.body.innerHTML);
    console.log('[Debug] Body HTML:', bodyHTML.substring(0, 500));
    console.log('[Debug] Console messages:', consoleMessages);
    if (consoleErrors.length > 0) {
      console.log('[Debug] Console errors:', consoleErrors);
    }
  });

  test('should display the SolidJS rendered UI', async () => {
    // Check that the app container is rendered by Solid
    const appContainer = await window.locator('.app-container');
    await expect(appContainer).toBeVisible({ timeout: 10000 });
  });

  test('should display sidebar', async () => {
    const sidebar = await window.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    const header = await window.locator('.sidebar-header h2');
    await expect(header).toHaveText('Library');
  });

  test('should display explorer panel', async () => {
    // The main content panel uses .explorer class in the SolidJS version
    const explorer = await window.locator('.explorer');
    await expect(explorer).toBeVisible();
  });

  test('should display player controls', async () => {
    const playerControls = await window.locator('.player-controls');
    await expect(playerControls).toBeVisible();
  });

  test('should display explorer tree structure', async () => {
    // Check that the tree structure is rendered
    const explorerTree = await window.locator('.explorer-tree');
    await expect(explorerTree).toBeVisible();
  });

  test('should have no console errors', async () => {
    const consoleErrors = [];

    window.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a bit to capture any delayed errors
    await window.waitForTimeout(1000);

    // Filter out expected warnings (like Vite HMR messages)
    const realErrors = consoleErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );

    expect(realErrors).toHaveLength(0);
  });

  test('should open settings window with SolidJS UI', async () => {
    // Open settings via keyboard shortcut
    await window.keyboard.press('Meta+,');

    // Wait for the settings window to open
    await window.waitForTimeout(500);

    // Get the settings window
    const windows = electronApp.windows();
    const settingsWindow = windows.find(w => w !== window);

    if (settingsWindow) {
      // Wait for settings to load
      await settingsWindow.waitForLoadState('domcontentloaded');
      await settingsWindow.waitForTimeout(1000);

      // Check that settings container is rendered
      const settingsContainer = await settingsWindow.locator('.settings-container');
      await expect(settingsContainer).toBeVisible();

      // Check that header is present
      const header = await settingsWindow.locator('.settings-header h1');
      await expect(header).toHaveText('Settings');

      // Check that save button is present
      const saveBtn = await settingsWindow.locator('#saveBtn');
      await expect(saveBtn).toBeVisible();

      // Close settings window
      await settingsWindow.keyboard.press('Escape');
      await window.waitForTimeout(200);
    }
  });
});
