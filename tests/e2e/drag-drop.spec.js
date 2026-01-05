const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Drag and Drop', () => {
  // Ensure we have items to work with
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

  test('should support drag and drop with draggable items', async ({ window }) => {
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      const firstItem = treeItems.first();
      const draggable = await firstItem.getAttribute('draggable');
      expect(draggable).toBe('true');

      for (let i = 0; i < Math.min(count, 3); i++) {
        const item = treeItems.nth(i);
        const isDraggable = await item.getAttribute('draggable');
        expect(isDraggable).toBe('true');
      }
    }
  });

  test('should preserve relative order when dragging multiple items DOWN', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const songMarkerName = `Song Marker ${Date.now()}`;
    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);
    let newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    let renameInput = await window.locator('#renameInput');
    await renameInput.fill(songMarkerName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const folderName = `Folder Below ${Date.now()}`;
    await addBtn.click();
    await window.waitForTimeout(50);
    newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    renameInput = await window.locator('#renameInput');
    await renameInput.fill(folderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const targetMarkerName = `Target Marker ${Date.now()}`;
    await addBtn.click();
    await window.waitForTimeout(50);
    newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    renameInput = await window.locator('#renameInput');
    await renameInput.fill(targetMarkerName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const songMarker = await window.locator(`.tree-item-content:has-text("${songMarkerName}")`);
    const folder = await window.locator(`.tree-item-content:has-text("${folderName}")`);
    const targetMarker = await window.locator(`.tree-item-content:has-text("${targetMarkerName}")`);

    await expect(songMarker).toBeVisible();
    await expect(folder).toBeVisible();
    await expect(targetMarker).toBeVisible();

    await songMarker.click();
    await window.waitForTimeout(50);
    await folder.click({ modifiers: ['Meta'] });
    await window.waitForTimeout(50);

    await expect(songMarker).toHaveClass(/selected/);
    await expect(folder).toHaveClass(/selected/);

    const songBox = await songMarker.boundingBox();
    const targetBox = await targetMarker.boundingBox();

    if (songBox && targetBox) {
      await window.mouse.move(songBox.x + songBox.width / 2, songBox.y + songBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.9, { steps: 5 });
      await window.waitForTimeout(50);
      await window.mouse.up();
      await window.waitForTimeout(200);
    }

    const allItems = await window.locator('.tree-item-content').all();
    const itemTexts = [];
    for (const item of allItems) {
      const text = await item.textContent();
      itemTexts.push(text);
    }

    const songMarkerIndex = itemTexts.findIndex(t => t.includes(songMarkerName));
    const folderIndex = itemTexts.findIndex(t => t.includes(folderName));
    const targetIndex = itemTexts.findIndex(t => t.includes(targetMarkerName));

    expect(songMarkerIndex).toBeLessThan(folderIndex);
    expect(songMarkerIndex).toBeGreaterThan(targetIndex);
    expect(folderIndex).toBeGreaterThan(targetIndex);

    // Clean up
    for (const name of [songMarkerName, folderName, targetMarkerName]) {
      const item = await window.locator(`.tree-item-content:has-text("${name}")`);
      if (await item.count() > 0) {
        await item.click();
        await window.keyboard.press('Backspace');
        await window.waitForTimeout(50);
        await window.click('#modalYesBtn');
        await window.waitForTimeout(50);
      }
    }
  });

  test('should preserve relative order when dragging multiple items UP', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const targetName = `Target ${Date.now()}`;
    const folderAName = `Folder A ${Date.now()}`;
    const folderBName = `Folder B ${Date.now()}`;
    const folderCName = `Folder C ${Date.now()}`;

    for (const name of [targetName, folderAName, folderBName, folderCName]) {
      const addBtn = await window.locator('#addLibraryBtn');
      await addBtn.click();
      await window.waitForTimeout(50);
      const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
      await newFolderOption.click();
      const renameInput = await window.locator('#renameInput');
      await renameInput.fill(name);
      await window.click('#renameOkBtn');
      await window.waitForTimeout(100);
    }

    const target = await window.locator(`.tree-item-content:has-text("${targetName}")`);
    const folderB = await window.locator(`.tree-item-content:has-text("${folderBName}")`);
    const folderC = await window.locator(`.tree-item-content:has-text("${folderCName}")`);

    await expect(target).toBeVisible();
    await expect(folderB).toBeVisible();
    await expect(folderC).toBeVisible();

    await folderB.click();
    await window.waitForTimeout(50);
    await folderC.click({ modifiers: ['Meta'] });
    await window.waitForTimeout(50);

    await expect(folderB).toHaveClass(/selected/);
    await expect(folderC).toHaveClass(/selected/);

    const folderBBox = await folderB.boundingBox();
    const targetBox = await target.boundingBox();

    if (folderBBox && targetBox) {
      await window.mouse.move(folderBBox.x + folderBBox.width / 2, folderBBox.y + folderBBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.1, { steps: 5 });
      await window.waitForTimeout(50);
      await window.mouse.up();
      await window.waitForTimeout(200);
    }

    const allItems = await window.locator('.tree-item-content').all();
    const itemTexts = [];
    for (const item of allItems) {
      const text = await item.textContent();
      itemTexts.push(text);
    }

    const folderBIndex = itemTexts.findIndex(t => t.includes(folderBName));
    const folderCIndex = itemTexts.findIndex(t => t.includes(folderCName));
    const targetIndex = itemTexts.findIndex(t => t.includes(targetName));

    expect(folderBIndex).toBeLessThan(folderCIndex);
    expect(folderBIndex).toBeLessThan(targetIndex);
    expect(folderCIndex).toBeLessThan(targetIndex);

    // Clean up
    for (const name of [targetName, folderAName, folderBName, folderCName]) {
      const item = await window.locator(`.tree-item-content:has-text("${name}")`);
      if (await item.count() > 0) {
        await item.click();
        await window.keyboard.press('Backspace');
        await window.waitForTimeout(50);
        await window.click('#modalYesBtn');
        await window.waitForTimeout(50);
      }
    }
  });

  test('should not reparent child items when dragging folder with selected children', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const parentFolderName = `Parent Folder ${Date.now()}`;
    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);
    const newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    const renameInput = await window.locator('#renameInput');
    await renameInput.fill(parentFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const parentFolder = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${parentFolderName}")`);
    await expect(parentFolder).toBeVisible({ timeout: 1000 });
    const chevron = parentFolder.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

    await parentFolder.click({ button: 'right' });
    await window.waitForTimeout(50);
    const addFolderInside = await window.locator('.context-menu-item').filter({ hasText: 'Add Folder Inside' });
    await addFolderInside.click();
    await window.waitForTimeout(100);
    const childFolderName = `Child Folder ${Date.now()}`;
    const childInput = await window.locator('#renameInput');
    await childInput.fill(childFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    await chevron.click();
    await window.waitForTimeout(50);
    await chevron.click();
    await window.waitForTimeout(100);

    const childFolder = await window.locator(`.tree-item-content:has-text("${childFolderName}")`);
    await expect(childFolder).toBeVisible({ timeout: 1000 });

    const parentListId = await parentFolder.getAttribute('data-folder-id');

    const childIsInsideParent = await window.evaluate(({ parentListId, childFolderName }) => {
      const parentChildren = document.querySelector(`[data-list-id="${parentListId}"]`);
      if (!parentChildren) return false;
      const child = parentChildren.querySelector(`.tree-item-content`);
      return child?.textContent?.includes(childFolderName) || false;
    }, { parentListId, childFolderName });
    expect(childIsInsideParent).toBe(true);

    await parentFolder.click();
    await window.waitForTimeout(50);

    await childFolder.click({ modifiers: ['Meta'] });
    await window.waitForTimeout(50);

    await expect(parentFolder).toHaveClass(/selected/);
    await expect(childFolder).toHaveClass(/selected/);

    const songItem = await window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songItem).toBeVisible({ timeout: 2000 });

    const parentBox = await parentFolder.boundingBox();
    const songBox = await songItem.boundingBox();

    if (parentBox && songBox) {
      await window.mouse.move(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(songBox.x + songBox.width / 2, songBox.y + songBox.height * 0.75, { steps: 5 });
      await window.waitForTimeout(50);
      await window.mouse.up();
      await window.waitForTimeout(200);
    }

    const movedParentFolder = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${parentFolderName}")`);
    await expect(movedParentFolder).toBeVisible({ timeout: 1000 });

    const movedChevron = movedParentFolder.locator('.tree-item-icon.chevron');
    await movedChevron.click();
    await window.waitForTimeout(100);

    const movedParentListId = await movedParentFolder.getAttribute('data-folder-id');

    const childStillInsideParent = await window.evaluate(({ parentListId, childFolderName }) => {
      const parentChildren = document.querySelector(`[data-list-id="${parentListId}"]`);
      if (!parentChildren) return false;
      const child = parentChildren.querySelector(`.tree-item-content`);
      return child?.textContent?.includes(childFolderName) || false;
    }, { parentListId: movedParentListId, childFolderName });

    expect(childStillInsideParent).toBe(true);

    // Clean up
    await movedParentFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });

  test('should insert as first child when dropping on bottom zone of expanded folder', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const parentFolderName = `Expanded Folder ${Date.now()}`;
    const addBtn = await window.locator('#addLibraryBtn');
    await addBtn.click();
    await window.waitForTimeout(50);
    let newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    let renameInput = await window.locator('#renameInput');
    await renameInput.fill(parentFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const parentFolder = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${parentFolderName}")`);
    await expect(parentFolder).toBeVisible({ timeout: 1000 });
    const chevron = parentFolder.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

    await parentFolder.click({ button: 'right' });
    await window.waitForTimeout(50);
    const addFolderInside = await window.locator('.context-menu-item').filter({ hasText: 'Add Folder Inside' });
    await addFolderInside.click();
    await window.waitForTimeout(100);
    const existingChildName = `Existing Child ${Date.now()}`;
    const childInput = await window.locator('#renameInput');
    await childInput.fill(existingChildName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    await chevron.click();
    await window.waitForTimeout(50);
    await chevron.click();
    await window.waitForTimeout(100);

    const dragFolderName = `Drag Me ${Date.now()}`;
    await addBtn.click();
    await window.waitForTimeout(50);
    newFolderOption = await window.locator('.dropdown-item').filter({ hasText: 'New Folder' });
    await newFolderOption.click();
    renameInput = await window.locator('#renameInput');
    await renameInput.fill(dragFolderName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(100);

    const dragFolder = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${dragFolderName}")`);
    await expect(dragFolder).toBeVisible();

    await dragFolder.click();
    await window.waitForTimeout(50);

    const dragBox = await dragFolder.boundingBox();
    const parentBox = await parentFolder.boundingBox();

    if (dragBox && parentBox) {
      await window.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height * 0.875, { steps: 5 });
      await window.waitForTimeout(50);
      await window.mouse.up();
      await window.waitForTimeout(200);
    }

    const parentListId = await parentFolder.getAttribute('data-folder-id');

    const children = await window.evaluate(async (listId) => {
      const items = await window.electronAPI.getListItems(parseInt(listId));
      return items.map(item => item.list_title || item.song_title);
    }, parentListId);

    expect(children[0]).toBe(dragFolderName);
    expect(children[1]).toBe(existingChildName);

    // Clean up
    const movedParentFolder = await window.locator(`.tree-item-content[data-is-folder="true"]:has-text("${parentFolderName}")`);
    await movedParentFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
