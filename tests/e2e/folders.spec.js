const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Folder Operations', () => {
  // Ensure we have a song to test context menu actions
  test.beforeAll(async ({ window }) => {
    const testFilePath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    await window.evaluate(async (filePath) => {
      try {
        await window.electronAPI.importFiles({
          filePaths: [filePath],
          parentListId: 0,
          position: 0
        });
      } catch (e) {
        // May already exist
      }
    }, testFilePath);
  });

  test('should show rename modal when moving selection into new folder', async ({ window }) => {
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    await songItem.click({ button: 'right' });
    await window.waitForTimeout(50);

    const contextMenu = await window.locator('.context-menu');
    await expect(contextMenu).toBeVisible();

    const moveIntoFolderItem = await window.locator('.context-menu-item').filter({ hasText: 'Move into New Folder' });
    await expect(moveIntoFolderItem).toBeVisible();
    await moveIntoFolderItem.click();

    const renameModal = await window.locator('.modal-overlay.visible, .rename-modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    const renameInput = await window.locator('#renameInput');
    await expect(renameInput).toBeVisible();
    const inputValue = await renameInput.inputValue();
    expect(inputValue).toBe('New Folder');
    await expect(window.locator('#renameModalTitle')).toHaveText('Move Into New Folder');

    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);
  });

  test('both Add Folder dialogs are titled "Add Folder In Playlist"', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(100);

    // From the sidebar's + menu...
    await window.click('#addLibraryBtn');
    await window.click('#newFolderMenuItem');
    await expect(window.locator('#renameModalTitle')).toHaveText('Add Folder In Playlist');
    await window.locator('#renameCancelBtn').click();

    // ...and from a song's context menu.
    const songItem = window.locator('.tree-item-content[data-is-folder="false"]').first();
    await songItem.click({ button: 'right' });
    await window.getByText('Add Folder After', { exact: true }).click();
    await expect(window.locator('#renameModalTitle')).toHaveText('Add Folder In Playlist');
    await window.locator('#renameCancelBtn').click();
  });

  test('should create new folder and then delete it', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const uniqueFolderName = `Test Folder ${Date.now()}`;

    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);

    const dropdown = await window.locator('.dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 1000 });

    const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();

    const renameModal = await window.locator('.modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    const renameInput = await window.locator('#renameInput');
    await renameInput.fill(uniqueFolderName);

    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const folderContent = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`);
    await expect(folderContent).toBeVisible({ timeout: 1000 });

    await folderContent.click();

    await window.keyboard.press('Backspace');

    const confirmModal = await window.locator('.modal-overlay.visible');
    await expect(confirmModal).toBeVisible();

    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);

    const deletedFolder = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`).count();
    expect(deletedFolder).toBe(0);
  });

  test('should delete multiple items including folder and its contents without error', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const uniqueFolderName = `Multi-Delete Folder ${Date.now()}`;

    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);
    const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    const renameInput = await window.locator('#renameInput');
    await renameInput.fill(uniqueFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const folderContent = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${uniqueFolderName}")`);
    await expect(folderContent).toBeVisible({ timeout: 1000 });

    const chevron = folderContent.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

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

    await chevron.click();
    await window.waitForTimeout(50);
    await chevron.click();
    await window.waitForTimeout(100);

    const nestedFolder = await window.locator(`.tree-item-content:has-text("${nestedFolderName}")`);
    await expect(nestedFolder).toBeVisible({ timeout: 1000 });

    await folderContent.click();
    await window.waitForTimeout(50);

    await nestedFolder.click({ modifiers: ['Meta'] });
    await window.waitForTimeout(50);

    await window.evaluate(() => {
      window.__deleteTestErrors = [];
      const origError = console.error;
      console.error = (...args) => {
        window.__deleteTestErrors.push(args.join(' '));
        origError.apply(console, args);
      };
    });

    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);

    await window.click('#modalYesBtn');
    await window.waitForTimeout(200);

    const deleteErrors = await window.evaluate(() => window.__deleteTestErrors || []);
    const itemNotFoundErrors = deleteErrors.filter(e => e.includes('Item not found'));
    expect(itemNotFoundErrors).toEqual([]);

    const remainingParent = await window.locator(`.tree-item-content:has-text("${uniqueFolderName}")`).count();
    const remainingNested = await window.locator(`.tree-item-content:has-text("${nestedFolderName}")`).count();
    expect(remainingParent).toBe(0);
    expect(remainingNested).toBe(0);
  });

  test('should add folder after song via context menu', async ({ window }) => {
    const uniqueFolderName = `Context Menu Folder ${Date.now()}`;

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.click();

    const initialFolderCount = await window.locator('.tree-item-content[data-is-folder="true"]').count();

    await songItem.click({ button: 'right' });
    await window.waitForTimeout(50);

    const contextMenu = await window.locator('.context-menu');
    await expect(contextMenu).toBeVisible();

    const addFolderItem = await window.getByText('Add Folder After', { exact: true });
    await expect(addFolderItem).toBeVisible();
    await addFolderItem.click();
    await window.waitForTimeout(100);

    const renameModal = await window.locator('.modal-overlay.visible');
    await expect(renameModal).toBeVisible({ timeout: 1000 });

    const renameInput = await window.locator('#renameInput');
    await expect(renameInput).toBeVisible();
    const inputValue = await renameInput.inputValue();
    expect(inputValue).toBe('New Folder');

    await renameInput.fill(uniqueFolderName);

    const okBtn = await window.locator('#renameOkBtn');
    await okBtn.click();
    await window.waitForTimeout(200);

    const newFolderCount = await window.locator('.tree-item-content[data-is-folder="true"]').count();
    expect(newFolderCount).toBe(initialFolderCount + 1);

    const newFolder = await window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: uniqueFolderName });
    await expect(newFolder).toBeVisible();

    // Clean up
    await newFolder.click({ button: 'right' });
    await window.waitForTimeout(50);
    const deleteItem = await window.locator('.context-menu-item').filter({ hasText: 'Delete' });
    await deleteItem.click();
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });

  test('should preserve scroll position when deleting items', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

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

    const scrollInfo = await window.evaluate(() => {
      const container = document.getElementById('explorerContainer');
      if (!container) return { success: false };
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
      return;
    }

    const scrollBefore = scrollInfo.scrollTop;
    expect(scrollBefore).toBeGreaterThan(0);

    const lastFolder = await window.locator(`.tree-item-content:has-text("${folderNames[14]}")`);
    await lastFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(50);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(150);

    const scrollAfter = await window.evaluate(() => {
      return document.getElementById('explorerContainer')?.scrollTop || 0;
    });
    expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore - 50);

    // Clean up
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
});
