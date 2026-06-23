const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

// Import a temp folder (with one song) into Main Library and return its name.
async function importFolderWithSong(window, prefix) {
  const tempDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.copyFileSync(testAudioPath, path.join(tempDir, 'inside-song.mp3'));

  const mainLibraryItem = window.locator('.playlist-item').first();
  await mainLibraryItem.click();
  await window.waitForTimeout(100);

  await window.evaluate((folderPath) => {
    return window.electronAPI.importFiles({ filePaths: [folderPath], parentListId: 0, position: 0 });
  }, tempDir);

  await mainLibraryItem.click();
  await window.waitForTimeout(200);

  return { tempDir, folderName: path.basename(tempDir) };
}

test.describe('Folder keyboard shortcuts', () => {
  test('renames a selected folder when Enter is pressed', async ({ window }) => {
    const { tempDir, folderName } = await importFolderWithSong(window, 'ludi-enter-rename');

    const folderRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: folderName });
    await expect(folderRow).toBeVisible({ timeout: 2000 });

    // Select the folder and press Enter -> rename modal opens, prefilled with its name.
    await folderRow.click();
    await window.waitForTimeout(50);
    await window.keyboard.press('Enter');

    const renameInput = window.locator('#renameInput');
    await expect(renameInput).toBeVisible({ timeout: 1000 });
    await expect(renameInput).toHaveValue(folderName);

    const newName = `Renamed ${Date.now()}`;
    await renameInput.fill(newName);
    await window.click('#renameOkBtn');
    await window.waitForTimeout(150);

    const renamedRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: newName });
    await expect(renamedRow).toBeVisible({ timeout: 1000 });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    await renamedRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });

  test('expands and collapses a folder with the right/left arrow keys', async ({ window }) => {
    const { tempDir, folderName } = await importFolderWithSong(window, 'ludi-arrow-toggle');

    const folderRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: folderName });
    await expect(folderRow).toBeVisible({ timeout: 2000 });
    const chevron = folderRow.locator('.tree-item-icon.chevron');

    // Resolve the child song row's item id.
    const childItemId = await window.evaluate(async (name) => {
      const items = await window.electronAPI.getListItems(0);
      const folder = items.find((i) => i.list_id !== null && i.list_title === name);
      const children = await window.electronAPI.getListItems(folder.list_id);
      return children[0].id;
    }, folderName);
    const childRow = window.locator(`.tree-item-content[data-item-id="${childItemId}"]`);

    // Starts collapsed: chevron not expanded, child not rendered.
    await expect(chevron).not.toHaveClass(/expanded/);
    await expect(childRow).toHaveCount(0);

    // Select the folder, expand with ArrowRight -> child becomes visible.
    await folderRow.click();
    await window.waitForTimeout(50);
    await window.keyboard.press('ArrowRight');
    await expect(chevron).toHaveClass(/expanded/);
    await expect(childRow).toBeVisible({ timeout: 1000 });

    // Collapse with ArrowLeft.
    await window.keyboard.press('ArrowLeft');
    await expect(chevron).not.toHaveClass(/expanded/);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    await folderRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
