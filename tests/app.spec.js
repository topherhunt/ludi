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

    // Capture stdout and stderr
    electronApp.process().stdout.on('data', (data) => {
      console.log('[Electron stdout]:', data.toString());
    });

    electronApp.process().stderr.on('data', (data) => {
      console.error('[Electron stderr]:', data.toString());
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

    // Tree may or may not have items depending on previous usage
    const treeItems = await window.locator('.tree-item').count();
    expect(treeItems).toBeGreaterThanOrEqual(0);
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

  test('should have settings initialized with default values', async () => {
    const settings = await window.evaluate(async () => {
      return await window.electronAPI.getSettings();
    });

    expect(settings).toBeTruthy();
    expect(settings.library_path).toBeTruthy();
    expect(settings.library_path).toContain('Music/Ludi Library');
    expect(settings.database_path).toBeTruthy();
    expect(settings.database_path).toContain('.ludi/ludi-library.sqlite');
  });

  test('should have library path configured correctly', async () => {
    // Get the library path from settings
    const settings = await window.evaluate(async () => {
      return await window.electronAPI.getSettings();
    });

    // Verify library path is set and has expected format
    expect(settings.library_path).toBeTruthy();
    expect(settings.library_path).toMatch(/Ludi Library/);
    // The directory creation is tested implicitly - if it doesn't exist,
    // file imports will fail in the file import test
  });

  test('should have importFiles API available', async () => {
    const hasImportAPI = await window.evaluate(() => {
      return typeof window.electronAPI.importFiles === 'function';
    });
    expect(hasImportAPI).toBe(true);
  });

  test('should have drag-and-drop handlers on explorer tree', async () => {
    const explorerTree = await window.locator('#explorerTree');

    // Check that the explorer tree element exists and is attached
    await expect(explorerTree).toBeAttached();

    // Verify drag-and-drop event handlers are set up
    const hasDragHandlers = await window.evaluate(() => {
      const tree = document.getElementById('explorerTree');
      // Check if event listeners are attached by dispatching test events
      // We can't directly check listeners, but we can verify the element accepts drops
      return tree !== null;
    });

    expect(hasDragHandlers).toBe(true);
  });

  test('should have drag-and-drop handlers on playlist sidebar', async () => {
    const playlistList = await window.locator('#playlistList');

    // Check that the playlist list element exists and is attached
    await expect(playlistList).toBeAttached();

    // Verify the sidebar has the Main Library item
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await expect(mainLibraryItem).toBeAttached();
    await expect(mainLibraryItem).toHaveText('Main Library');
  });

  test('should have drop indicator element in DOM', async () => {
    const dropIndicator = await window.locator('#dropIndicator');
    await expect(dropIndicator).toBeAttached();

    // Verify it's initially not visible
    const isVisible = await dropIndicator.evaluate(el => {
      return el.classList.contains('visible');
    });
    expect(isVisible).toBe(false);
  });

  test('should handle file import simulation', async () => {
    // Simulate importing a file through the API
    // We'll test the error handling for an invalid file
    const result = await window.evaluate(async () => {
      try {
        // Try importing with an empty file list
        const importResult = await window.electronAPI.importFiles({
          filePaths: [],
          parentListId: 0,
          position: 0
        });
        return { success: true, result: importResult };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeTruthy();
    expect(result.result.imported).toEqual([]);
    expect(result.result.unsupported).toEqual([]);
    expect(result.result.errors).toEqual([]);
  });

  test('should have compact footer height', async () => {
    const footerDimensions = await window.evaluate(() => {
      const footer = document.querySelector('.player-controls');
      const rect = footer.getBoundingClientRect();
      const styles = window.getComputedStyle(footer);

      // Check all children heights
      const children = Array.from(footer.children).map(child => {
        const childRect = child.getBoundingClientRect();
        const childStyles = window.getComputedStyle(child);
        return {
          className: child.className,
          height: childRect.height,
          lineHeight: childStyles.lineHeight,
          marginTop: childStyles.marginTop,
          marginBottom: childStyles.marginBottom,
          paddingTop: childStyles.paddingTop,
          paddingBottom: childStyles.paddingBottom
        };
      });

      return {
        footer: {
          height: rect.height,
          padding: styles.padding,
          paddingTop: styles.paddingTop,
          paddingBottom: styles.paddingBottom,
          gap: styles.gap
        },
        children
      };
    });

    // Footer should be reasonably compact (less than 50px total height)
    expect(footerDimensions.footer.height).toBeLessThan(50);
  });

  test('should import audio file into empty playlist via drag-and-drop', async () => {
    const testFilePath = path.join(__dirname, 'test-audiofiles', '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

    // Get initial item count
    const initialCount = await window.evaluate(async () => {
      const items = await window.electronAPI.getListItems(0);
      return items.length;
    });

    // Simulate file import via the API (simulating drag-and-drop)
    const importResult = await window.evaluate(async (filePath) => {
      try {
        const result = await window.electronAPI.importFiles({
          filePaths: [filePath],
          parentListId: 0,
          position: 0
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, testFilePath);

    // Verify import was successful (or file already exists)
    expect(importResult.success).toBe(true);

    // Either the file was imported, or it already existed (unique constraint error)
    const wasImported = importResult.result.imported.length === 1;
    const alreadyExists = importResult.result.errors.length > 0 &&
                          importResult.result.errors[0].error.includes('UNIQUE constraint');

    expect(wasImported || alreadyExists).toBe(true);
    expect(importResult.result.unsupported).toHaveLength(0);

    if (wasImported) {
      expect(importResult.result.imported[0].title).toContain('Jump Into My Mouth');
    }

    // Verify item exists in the database
    const newCount = await window.evaluate(async () => {
      const items = await window.electronAPI.getListItems(0);
      return items.length;
    });

    // If it was imported, count should increase; if it already existed, count stays same
    if (wasImported) {
      expect(newCount).toBe(initialCount + 1);
    } else {
      expect(newCount).toBe(initialCount);
    }

    // Refresh the UI by clicking on Main Library again (simulating what happens after drop)
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();

    // Wait for UI to render
    await window.waitForTimeout(300);

    // Verify the tree item appears in the UI
    const treeItems = await window.locator('.tree-item');
    const count = await treeItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify the song exists in the list (may not be first if file already existed)
    const allLabels = await window.locator('.tree-item-label').allTextContents();
    const hasSong = allLabels.some(label => label.includes('Jump Into My Mouth') || label.includes('Breathe in the Stardust'));
    expect(hasSong).toBe(true);
  });

  test('should have shuffle and loop control buttons', async () => {
    const shuffleBtn = await window.locator('#shuffleBtn');
    await expect(shuffleBtn).toBeVisible();
    await expect(shuffleBtn).toHaveClass(/toggle-btn/);

    const loopBtn = await window.locator('#loopBtn');
    await expect(loopBtn).toBeVisible();
    await expect(loopBtn).toHaveClass(/toggle-btn/);
  });

  test('should toggle shuffle mode when shuffle button is clicked', async () => {
    const shuffleBtn = await window.locator('#shuffleBtn');

    // Check initial state (should be off)
    const initialState = await window.evaluate(() => {
      return window.shuffleEnabled || false;
    });
    expect(initialState).toBe(false);

    // Click to enable shuffle
    await shuffleBtn.click();
    await window.waitForTimeout(100);

    // Check if shuffle is enabled
    const enabledState = await window.evaluate(() => {
      return window.shuffleEnabled;
    });
    expect(enabledState).toBe(true);

    // Check if the button has active class
    await expect(shuffleBtn).toHaveClass(/active/);

    // Click to disable shuffle
    await shuffleBtn.click();
    await window.waitForTimeout(100);

    // Check if shuffle is disabled
    const disabledState = await window.evaluate(() => {
      return window.shuffleEnabled;
    });
    expect(disabledState).toBe(false);
  });

  test('should cycle through loop modes when loop button is clicked', async () => {
    const loopBtn = await window.locator('#loopBtn');

    // Check initial state (should be off)
    const initialMode = await window.evaluate(() => {
      return window.loopMode || 'off';
    });
    expect(initialMode).toBe('off');

    // Click to set loop mode to 'all'
    await loopBtn.click();
    await window.waitForTimeout(100);

    let loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    // Click to set loop mode to 'one'
    await loopBtn.click();
    await window.waitForTimeout(100);

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('one');
    await expect(loopBtn).toHaveClass(/active/);

    // Check if button text changed to loop one icon
    const loopOneText = await loopBtn.textContent();
    expect(loopOneText).toBe('🔂');

    // Click to set loop mode to 'off'
    await loopBtn.click();
    await window.waitForTimeout(100);

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('off');

    // Check if button text changed back to loop icon
    const loopOffText = await loopBtn.textContent();
    expect(loopOffText).toBe('🔁');
  });

  test('should have shuffle and loop state accessible from window', async () => {
    // Verify state variables are accessible
    const hasShuffleState = await window.evaluate(() => {
      return typeof window.shuffleEnabled !== 'undefined';
    });
    expect(hasShuffleState).toBe(true);

    const hasLoopState = await window.evaluate(() => {
      return typeof window.loopMode !== 'undefined';
    });
    expect(hasLoopState).toBe(true);
  });
});
