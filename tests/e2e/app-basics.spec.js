const { test, expect } = require('./fixtures');

test.describe('App Basics', () => {
  test('should load app from Vite dev server', async ({ electronApp, window, consoleErrors }) => {
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    if (consoleErrors.length > 0) {
      console.log('[Debug] Console errors:', consoleErrors);
    }
  });

  test('should display the rendered UI', async ({ window }) => {
    const appContainer = await window.locator('.app-container');
    await expect(appContainer).toBeVisible({ timeout: 10000 });
  });

  test('should display sidebar', async ({ window }) => {
    const sidebar = await window.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    const header = await window.locator('.sidebar-header h2');
    await expect(header).toHaveText('Library');
  });

  test('should display explorer panel', async ({ window }) => {
    const explorer = await window.locator('.main-panel');
    await expect(explorer).toBeVisible();
  });

  test('should display player controls', async ({ window }) => {
    const playerControls = await window.locator('.player-controls');
    await expect(playerControls).toBeVisible();
  });

  test('should display explorer tree structure', async ({ window }) => {
    // Attached rather than visible: each run starts with an empty library, and an
    // empty list has no height.
    const explorerTree = window.locator('.explorer-tree');
    await expect(explorerTree).toBeAttached();
    await expect(explorerTree).toHaveAttribute('data-list-id', '0');
    await expect(explorerTree.locator('.loading')).toHaveCount(0);
  });

  test('should have no console errors', async ({ consoleErrors }) => {
    const realErrors = consoleErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('should have collapse all and expand all buttons in the sidebar', async ({ window }) => {
    const collapseBtn = await window.locator('.qa-collapse-all');
    await expect(collapseBtn).toBeVisible();
    await expect(collapseBtn).toHaveAttribute('data-tooltip', 'Collapse All');

    const expandBtn = await window.locator('.qa-expand-all');
    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toHaveAttribute('data-tooltip', 'Expand All');
  });

  test('should open settings window', async ({ electronApp, window }) => {
    await window.keyboard.press('Meta+,');
    await window.waitForTimeout(200);

    const windows = electronApp.windows();
    const settingsWindow = windows.find(w => w !== window);

    if (settingsWindow) {
      await settingsWindow.waitForLoadState('domcontentloaded');
      await settingsWindow.waitForTimeout(200);

      const settingsContainer = await settingsWindow.locator('.settings-container');
      await expect(settingsContainer).toBeVisible();

      const header = await settingsWindow.locator('.settings-header h1');
      await expect(header).toHaveText('Settings');

      const saveBtn = await settingsWindow.locator('#saveBtn');
      await expect(saveBtn).toBeVisible();

      await settingsWindow.close();
      await window.waitForTimeout(50);
    }
  });
});
