const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

test.describe('LUDI Music Player', () => {
  let electronApp;
  let window;
  const consoleErrors = [];

  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'src', 'main', 'main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });

    // Listen for any process crashes
    electronApp.on('close', () => {
      console.log('Electron app closed');
    });

    // Wait a bit for the app to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the first window
    try {
      window = await electronApp.firstWindow({ timeout: 10000 });
    } catch (error) {
      console.error('Failed to get first window:', error);
      // Try to get console output from the electron process
      const isRunning = electronApp.process();
      console.log('Electron process running:', !!isRunning);
      throw error;
    }

    // Capture console errors
    window.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for the app to be ready
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    // Close the app
    await electronApp.close();
  });

  test('should launch successfully', async () => {
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();
  });

  test('should display the main window with correct title', async () => {
    const title = await window.title();
    expect(title).toBe('LUDI Music Player');
  });

  test('should display the sidebar', async () => {
    const sidebar = await window.locator('.sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('should display "Library" header in sidebar', async () => {
    const header = await window.locator('.sidebar-header h2');
    await expect(header).toBeVisible();
    await expect(header).toHaveText('Library');
  });

  test('should display the main panel with "Main Library" title', async () => {
    const mainPanel = await window.locator('.main-panel');
    await expect(mainPanel).toBeVisible();

    const title = await window.locator('#currentListTitle');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('Main Library');
  });

  test('should display explorer controls (Collapse All, Expand All)', async () => {
    const collapseBtn = await window.locator('#collapseAllBtn');
    await expect(collapseBtn).toBeVisible();
    await expect(collapseBtn).toHaveText('Collapse All');

    const expandBtn = await window.locator('#expandAllBtn');
    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toHaveText('Expand All');
  });

  test('should display the explorer tree container', async () => {
    const explorerTree = await window.locator('#explorerTree');
    // Check that the element exists in the DOM (attached) rather than visible
    // since empty lists may have 0 height
    await expect(explorerTree).toBeAttached();

    // Verify it has the correct data attribute
    const listId = await explorerTree.getAttribute('data-list-id');
    expect(listId).toBe('0');

    // Tree should be empty initially
    const treeItems = await window.locator('.tree-item').count();
    expect(treeItems).toBe(0);
  });

  test('should display player controls at bottom', async () => {
    const playerControls = await window.locator('.player-controls');
    await expect(playerControls).toBeVisible();
  });

  test('should display "No song playing" message initially', async () => {
    const songTitle = await window.locator('#currentSongTitle');
    await expect(songTitle).toBeVisible();
    await expect(songTitle).toHaveText('No song playing');
  });

  test('should have playback control buttons', async () => {
    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toBeVisible();
    await expect(playPauseBtn).toBeDisabled();

    const prevBtn = await window.locator('#prevBtn');
    await expect(prevBtn).toBeVisible();
    await expect(prevBtn).toBeDisabled();

    const nextBtn = await window.locator('#nextBtn');
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toBeDisabled();
  });

  test('should have volume controls', async () => {
    const volumeSlider = await window.locator('#volumeSlider');
    await expect(volumeSlider).toBeVisible();

    const muteBtn = await window.locator('#muteBtn');
    await expect(muteBtn).toBeVisible();
  });

  test('should have seek bar and time displays', async () => {
    const seekBar = await window.locator('#seekBar');
    await expect(seekBar).toBeVisible();
    await expect(seekBar).toBeDisabled();

    const currentTime = await window.locator('#currentTime');
    await expect(currentTime).toBeVisible();
    await expect(currentTime).toHaveText('0:00');

    const totalTime = await window.locator('#totalTime');
    await expect(totalTime).toBeVisible();
    await expect(totalTime).toHaveText('0:00');
  });

  test('should have Main Library in playlist list', async () => {
    const playlistItems = await window.locator('.playlist-item');
    const count = await playlistItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstPlaylist = playlistItems.first();
    await expect(firstPlaylist).toHaveText('Main Library');
    await expect(firstPlaylist).toHaveClass(/active/);
  });

  test('should not have any console errors', async () => {
    // Wait a bit to ensure any delayed errors are captured
    await window.waitForTimeout(1000);

    if (consoleErrors.length > 0) {
      console.log('Console errors found:');
      consoleErrors.forEach(err => console.log('  -', err));
    }

    expect(consoleErrors).toHaveLength(0);
  });

  test('should have properly initialized database', async () => {
    // Evaluate in the renderer process to check if electronAPI is available
    const hasAPI = await window.evaluate(() => {
      return typeof window.electronAPI !== 'undefined';
    });
    expect(hasAPI).toBe(true);

    // Try to get lists from the database
    const lists = await window.evaluate(async () => {
      return await window.electronAPI.getLists();
    });

    expect(Array.isArray(lists)).toBe(true);
    expect(lists.length).toBeGreaterThanOrEqual(1);
    expect(lists[0].title).toBe('Main Library');
    expect(lists[0].id).toBe(0);
  });
});
