const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

test.describe('LUDI Music Player', () => {
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

    // Launch Electron in dev mode
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'src', 'main', 'main.js')],
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

    // Wait for Solid to render
    await window.waitForTimeout(500);

    // Set volume low to avoid disruption during tests
    await window.evaluate(() => {
      const volumeSlider = document.getElementById('volumeSlider');
      if (volumeSlider) {
        volumeSlider.value = 10;
        volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
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

  test('should load app from Vite dev server', async () => {
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    // Debug: print what's in the page
    const bodyHTML = await window.evaluate(() => document.body.innerHTML);
    // console.log('[Debug] Body HTML:', bodyHTML.substring(0, 500));
    // console.log('[Debug] Console messages:', consoleMessages);
    if (consoleErrors.length > 0) {
      console.log('[Debug] Console errors:', consoleErrors);
    }
  });

  test('should display the rendered UI', async () => {
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
    const explorer = await window.locator('.main-panel');
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
    // Check if any errors were captured during setup (they were collected in beforeAll)
    // Filter out Vite HMR/WebSocket messages
    const realErrors = consoleErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );

    expect(realErrors).toHaveLength(0);
  });

  test('should start playback when double-clicking a song', async () => {
    const testFilePath = path.join(__dirname, 'test-audiofiles', '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

    // Track errors during this test
    const playbackErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        playbackErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    // Import a test audio file
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

    expect(importResult.success).toBe(true);

    // Refresh UI by clicking Main Library
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    // Find a song item (not a folder) and double-click it
    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });

    // Double-click to start playback
    await songItem.dblclick();

    // Wait briefly for playback to be initiated
    await window.waitForTimeout(300);

    // Verify the play button shows "playing" state
    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    // Check that no errors occurred during playback initiation
    const relevantErrors = playbackErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    // Verify the song title appears in player controls
    const songTitleElement = await window.locator('.player-info .song-title');
    await expect(songTitleElement).toBeVisible();
    const songTitle = await songTitleElement.textContent();
    expect(songTitle).toContain('Jump Into My Mouth');

    // Stop playback to avoid audio bleeding into next test
    await playPauseBtn.click();
    await window.waitForTimeout(50);

    // Clean up error handler
    window.off('console', errorHandler);
  });

  test('should show rename modal when moving selection into new folder', async () => {
    // Ensure we have a song in the library (from previous test)
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // Find and click a song to select it
    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    // Right-click to open context menu
    await songItem.click({ button: 'right' });
    await window.waitForTimeout(50);

    // Verify context menu is visible
    const contextMenu = await window.locator('.context-menu');
    await expect(contextMenu).toBeVisible();

    // Click "Move into New Folder..."
    const moveIntoFolderItem = await window.locator('.context-menu-item').filter({ hasText: 'Move into New Folder' });
    await expect(moveIntoFolderItem).toBeVisible();
    await moveIntoFolderItem.click();

    // Verify rename modal appears with "New Folder" as default value
    const renameModal = await window.locator('.modal-overlay.visible, .rename-modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    // Verify input has "New Folder" as default value
    const renameInput = await window.locator('#renameInput');
    await expect(renameInput).toBeVisible();
    const inputValue = await renameInput.inputValue();
    expect(inputValue).toBe('New Folder');

    // Cancel the modal (don't actually create the folder)
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);
  });

  test('should open settings window', async () => {
    // Open settings via keyboard shortcut
    await window.keyboard.press('Meta+,');

    // Wait for the settings window to open
    await window.waitForTimeout(200);

    // Get the settings window
    const windows = electronApp.windows();
    const settingsWindow = windows.find(w => w !== window);

    if (settingsWindow) {
      // Wait for settings to load
      await settingsWindow.waitForLoadState('domcontentloaded');
      await settingsWindow.waitForTimeout(200);

      // Check that settings container is rendered
      const settingsContainer = await settingsWindow.locator('.settings-container');
      await expect(settingsContainer).toBeVisible();

      // Check that header is present
      const header = await settingsWindow.locator('.settings-header h1');
      await expect(header).toHaveText('Settings');

      // Check that save button is present
      const saveBtn = await settingsWindow.locator('#saveBtn');
      await expect(saveBtn).toBeVisible();

      // Close settings window by calling close() directly
      await settingsWindow.close();
      await window.waitForTimeout(50);
    }
  });

  test('should select a single item when clicked', async () => {
    // Ensure no modals are blocking
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      const firstItem = treeItems.first();
      await firstItem.click();

      // Verify the item has the selected class
      await expect(firstItem).toHaveClass(/selected/);

      // Verify only one item is selected
      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(1);
    }
  });

  test('should deselect previous item when clicking a different item', async () => {
    // First import a second file so we have multiple items
    const testFilePath2 = path.join(__dirname, 'test-audiofiles', '01 Bring Tequila.mp3');
    await window.evaluate(async (filePath) => {
      try {
        await window.electronAPI.importFiles({
          filePaths: [filePath],
          parentListId: 0,
          position: 1
        });
      } catch (e) {
        // May already exist
      }
    }, testFilePath2);

    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      const firstItem = treeItems.nth(0);
      const secondItem = treeItems.nth(1);

      // Click first item
      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      // Click second item
      await secondItem.click();
      await expect(secondItem).toHaveClass(/selected/);

      // First item should no longer be selected
      const firstHasSelected = await firstItem.evaluate(el => el.classList.contains('selected'));
      expect(firstHasSelected).toBe(false);

      // Only one item should be selected
      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(1);
    }
  });

  test('should toggle selection with CMD+click', async () => {
    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      const firstItem = treeItems.nth(0);
      const secondItem = treeItems.nth(1);

      // Select first item
      await firstItem.click();

      // CMD+click second item to add to selection
      await secondItem.click({ modifiers: ['Meta'] });

      // Both should be selected
      await expect(firstItem).toHaveClass(/selected/);
      await expect(secondItem).toHaveClass(/selected/);

      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(2);

      // CMD+click second item again to deselect it
      await secondItem.click({ modifiers: ['Meta'] });

      const secondHasSelected = await secondItem.evaluate(el => el.classList.contains('selected'));
      expect(secondHasSelected).toBe(false);
      await expect(firstItem).toHaveClass(/selected/);
    }
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

    // Check if shuffle is enabled
    const enabledState = await window.evaluate(() => {
      return window.shuffleEnabled;
    });
    expect(enabledState).toBe(true);

    // Check if the button has active class
    await expect(shuffleBtn).toHaveClass(/active/);

    // Click to disable shuffle
    await shuffleBtn.click();

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

    let loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    // Click to set loop mode to 'one'
    await loopBtn.click();

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('one');
    await expect(loopBtn).toHaveClass(/active/);

    // Check if button icon changed to loop one (bi-repeat-1)
    const loopOneIcon = loopBtn.locator('i.bi-repeat-1');
    await expect(loopOneIcon).toBeVisible();

    // Click to set loop mode to 'off'
    await loopBtn.click();

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('off');

    // Check if button icon changed back to loop (bi-repeat)
    const loopOffIcon = loopBtn.locator('i.bi-repeat');
    await expect(loopOffIcon).toBeVisible();
  });

  test('should navigate with arrow keys', async () => {
    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      // Select first item
      const firstItem = treeItems.first();
      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      // Press arrow down to move to next item
      await window.keyboard.press('ArrowDown');

      // Second item should now be selected
      const secondItem = treeItems.nth(1);
      await expect(secondItem).toHaveClass(/selected/);

      // First item should no longer be selected
      const firstStillSelected = await firstItem.evaluate(el => el.classList.contains('selected'));
      expect(firstStillSelected).toBe(false);

      // Press arrow up to go back to first
      await window.keyboard.press('ArrowUp');

      await expect(firstItem).toHaveClass(/selected/);
    }
  });

  test('should clear selection with Escape key', async () => {
    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      // Select first item
      const firstItem = treeItems.first();
      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      // Press Escape to clear selection
      await window.keyboard.press('Escape');

      // No items should be selected
      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(0);
    }
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

    const currentTime = await window.locator('#currentTime');
    await expect(currentTime).toBeVisible();

    const totalTime = await window.locator('#totalTime');
    await expect(totalTime).toBeVisible();
  });

  test('should display prev/next track buttons', async () => {
    const prevBtn = await window.locator('#prevBtn');
    await expect(prevBtn).toBeVisible();

    const nextBtn = await window.locator('#nextBtn');
    await expect(nextBtn).toBeVisible();
  });

  test('should create new folder and then delete it', async () => {
    // Ensure no modals are blocking
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // Use unique folder name to avoid conflicts with previous test runs
    const uniqueFolderName = `Test Folder ${Date.now()}`;

    // Click the + button
    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);

    // Look for the dropdown menu
    const dropdown = await window.locator('.dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 1000 });

    // Click "New Folder" option
    const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();

    // Rename modal should appear
    const renameModal = await window.locator('.modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    // Fill in folder name
    const renameInput = await window.locator('#renameInput');
    await renameInput.fill(uniqueFolderName);

    // Click OK
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    // Verify folder was created
    const folderContent = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`);
    await expect(folderContent).toBeVisible({ timeout: 1000 });

    // Select the folder
    await folderContent.click();

    // Press Backspace to delete
    await window.keyboard.press('Backspace');

    // Confirm dialog should appear
    const confirmModal = await window.locator('.modal-overlay.visible');
    await expect(confirmModal).toBeVisible();

    // Click Yes
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);

    // Verify folder is gone
    const deletedFolder = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`).count();
    expect(deletedFolder).toBe(0);
  });

  test('should delete multiple items including folder and its contents without error', async () => {
    // This test reproduces the bug where deleting a folder AND its children
    // causes "Item not found" error because the folder deletion recursively
    // deletes children, then the child deletion tries to delete already-gone items
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const uniqueFolderName = `Multi-Delete Folder ${Date.now()}`;

    // Create a folder
    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);
    const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    const renameInput = await window.locator('#renameInput');
    await renameInput.fill(uniqueFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    // Find and expand the folder
    const folderContent = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${uniqueFolderName}")`);
    await expect(folderContent).toBeVisible({ timeout: 1000 });

    // Click the chevron to expand
    const chevron = folderContent.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

    // Add a nested folder inside
    await folderContent.click({ button: 'right' });
    await window.waitForTimeout(50);
    const addFolderInside = await window.locator('.context-menu-item').filter({ hasText: 'Add Folder Inside' });
    await addFolderInside.click();
    await window.waitForTimeout(100);

    const nestedFolderName = `Nested ${Date.now()}`;
    const nestedInput = await window.locator('#renameInput');
    await nestedInput.fill(nestedFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    // Click chevron again to see the nested folder
    await chevron.click();
    await window.waitForTimeout(50);
    await chevron.click();
    await window.waitForTimeout(100);

    // Find the nested folder
    const nestedFolder = await window.locator(`.tree-item-content:has-text("${nestedFolderName}")`);
    await expect(nestedFolder).toBeVisible({ timeout: 1000 });

    // Select the parent folder
    await folderContent.click();
    await window.waitForTimeout(50);

    // Cmd+click the nested folder to add to selection
    await nestedFolder.click({ modifiers: ['Meta'] });
    await window.waitForTimeout(50);

    // Clear console errors before delete
    await window.evaluate(() => {
      window.__deleteTestErrors = [];
      const origError = console.error;
      console.error = (...args) => {
        window.__deleteTestErrors.push(args.join(' '));
        origError.apply(console, args);
      };
    });

    // Press Backspace to delete both
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);

    // Confirm
    await window.click('#modalYesBtn');
    await window.waitForTimeout(200);

    // Verify no errors occurred during deletion
    const deleteErrors = await window.evaluate(() => window.__deleteTestErrors || []);
    const itemNotFoundErrors = deleteErrors.filter(e => e.includes('Item not found'));
    expect(itemNotFoundErrors).toEqual([]);

    // Verify both are deleted
    const remainingParent = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`).count();
    const remainingNested = await window.locator(`.tree-item-content:has-text("${nestedFolderName}")`).count();
    expect(remainingParent).toBe(0);
    expect(remainingNested).toBe(0);
  });

  test('should support drag and drop with draggable items', async () => {
    // Refresh UI first
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      // Verify items have draggable attribute
      const firstItem = treeItems.first();
      const draggable = await firstItem.getAttribute('draggable');
      expect(draggable).toBe('true');

      // Verify all tree items are draggable
      for (let i = 0; i < Math.min(count, 3); i++) {
        const item = treeItems.nth(i);
        const isDraggable = await item.getAttribute('draggable');
        expect(isDraggable).toBe('true');
      }
    }
  });

  test('should preserve scroll position when deleting items', async () => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // Create multiple folders so we have enough content to scroll
    const folderNames = [];
    for (let i = 0; i < 15; i++) {
      const name = `Scroll Test ${Date.now()}-${i}`;
      folderNames.push(name);

      const addBtn = await window.locator('#addLibraryBtn');
      await addBtn.click();
      await window.waitForTimeout(30);
      const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
      await newFolderOption.click();
      const renameInput = await window.locator('#renameInput');
      await renameInput.fill(name);
      await window.click('#renameOkBtn');
      await window.waitForTimeout(30);
    }

    // Force scroll down in the container
    const scrollInfo = await window.evaluate(() => {
      const container = document.getElementById('explorerContainer');
      if (!container) return { success: false };
      // Scroll to middle of content
      const scrollTarget = Math.min(200, container.scrollHeight - container.clientHeight);
      container.scrollTop = scrollTarget;
      return {
        success: true,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight
      };
    });
    await window.waitForTimeout(50);

    // Skip test if container isn't scrollable (not enough content)
    if (scrollInfo.scrollHeight <= scrollInfo.clientHeight) {
      // Clean up and skip
      for (const name of folderNames) {
        const folder = await window.locator(`.tree-item-content:has-text("${name}")`);
        if (await folder.count() > 0) {
          await folder.click();
          await window.keyboard.press('Backspace');
          await window.waitForTimeout(30);
          await window.click('#modalYesBtn');
          await window.waitForTimeout(30);
        }
      }
      return; // Container not scrollable, can't test scroll preservation
    }

    const scrollBefore = scrollInfo.scrollTop;
    expect(scrollBefore).toBeGreaterThan(0);

    // Delete a folder
    const lastFolder = await window.locator(`.tree-item-content:has-text("${folderNames[14]}")`);
    await lastFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(50);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(150);

    // Check scroll position is preserved
    const scrollAfter = await window.evaluate(() => {
      return document.getElementById('explorerContainer')?.scrollTop || 0;
    });
    // Scroll should be preserved (within small tolerance for deleted item height)
    expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore - 50);

    // Clean up remaining folders
    for (let i = 0; i < 14; i++) {
      const folder = await window.locator(`.tree-item-content:has-text("${folderNames[i]}")`);
      if (await folder.count() > 0) {
        await folder.click();
        await window.keyboard.press('Backspace');
        await window.waitForTimeout(30);
        await window.click('#modalYesBtn');
        await window.waitForTimeout(30);
      }
    }
  });

  test('should play song when Enter key is pressed', async () => {
    // Track errors during this test
    const playbackErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        playbackErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // Find a song item and select it
    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    // Press Enter to play
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    // Verify the play button shows "playing" state
    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    // Check for errors
    const relevantErrors = playbackErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    // Stop playback
    await playPauseBtn.click();
    await window.waitForTimeout(50);

    // Clean up
    window.off('console', errorHandler);
  });

  test('should seek without error when clicking seek bar during playback', async () => {
    // Track errors during this test
    const seekErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') {
        seekErrors.push(msg.text());
      }
    };
    window.on('console', errorHandler);

    // Refresh UI and find a song
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });

    // Double-click to start playback
    await songItem.dblclick();
    await window.waitForTimeout(500);

    // Verify playback started
    const playPauseBtn = await window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/);

    // Click on the seek bar to seek
    const seekBar = await window.locator('#seekBar');
    await expect(seekBar).toBeVisible();

    // Click at 50% position on the seek bar
    const seekBox = await seekBar.boundingBox();
    if (seekBox) {
      await window.mouse.click(seekBox.x + seekBox.width * 0.5, seekBox.y + seekBox.height / 2);
      await window.waitForTimeout(100);
    }

    // Check for errors (filter out Vite noise)
    const relevantErrors = seekErrors.filter(err =>
      !err.includes('[vite]') &&
      !err.includes('WebSocket')
    );
    expect(relevantErrors).toHaveLength(0);

    // Verify total time displays correctly (not "Infinity:NaN")
    const totalTime = await window.locator('#totalTime');
    const totalTimeText = await totalTime.textContent();
    expect(totalTimeText).not.toContain('Infinity');
    expect(totalTimeText).not.toContain('NaN');

    // Stop playback
    await playPauseBtn.click();
    await window.waitForTimeout(50);

    // Clean up
    window.off('console', errorHandler);
  });

  test('should have collapse all and expand all buttons', async () => {
    const collapseBtn = await window.locator('#collapseAllBtn');
    await expect(collapseBtn).toBeVisible();
    await expect(collapseBtn).toHaveText('Collapse All');

    const expandBtn = await window.locator('#expandAllBtn');
    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toHaveText('Expand All');
  });

  test('should add folder after song via context menu', async () => {
    // Use unique folder name to avoid conflicts with previous test runs
    const uniqueFolderName = `Context Menu Folder ${Date.now()}`;

    // Ensure we're on Main Library
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // Find a song item
    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    // Get initial folder count
    const initialFolderCount = await window.locator('.tree-item-content[data-is-folder="true"]').count();

    // Right-click to open context menu
    await songItem.click({ button: 'right' });
    await window.waitForTimeout(50);

    // Verify context menu is visible
    const contextMenu = await window.locator('.context-menu');
    await expect(contextMenu).toBeVisible();

    // Click "Add Folder After"
    const addFolderItem = await window.getByText('Add Folder After', { exact: true });
    await expect(addFolderItem).toBeVisible();
    await addFolderItem.click();
    await window.waitForTimeout(100);

    // Verify rename modal appears
    const renameModal = await window.locator('.modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    // Verify input has "New Folder" as default value
    const renameInput = await window.locator('#renameInput');
    await expect(renameInput).toBeVisible();
    const inputValue = await renameInput.inputValue();
    expect(inputValue).toBe('New Folder');

    // Enter a custom folder name
    await renameInput.fill(uniqueFolderName);

    // Click OK to create the folder
    const okBtn = await window.locator('#renameOkBtn');
    await okBtn.click();
    await window.waitForTimeout(200);

    // Verify the folder was created
    const newFolderCount = await window.locator('.tree-item-content[data-is-folder="true"]').count();
    expect(newFolderCount).toBe(initialFolderCount + 1);

    // Verify the folder exists with the correct name
    const newFolder = await window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: uniqueFolderName });
    await expect(newFolder).toBeVisible();

    // Clean up: delete the folder we just created
    await newFolder.click({ button: 'right' });
    await window.waitForTimeout(50);
    const deleteItem = await window.locator('.context-menu-item').filter({ hasText: 'Delete' });
    await deleteItem.click();
    await window.waitForTimeout(100);
    // Confirm deletion
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
