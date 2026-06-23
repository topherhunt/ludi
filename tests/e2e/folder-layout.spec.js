const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

test.describe('Folder layout', () => {
  test('folder rows omit the song columns (name spans full width); song rows keep them', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-folder-layout-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(testAudioPath, path.join(tempDir, 'inside-song.mp3'));

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);
    await window.evaluate((fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }), tempDir);
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const folderName = path.basename(tempDir);
    const folderRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: folderName });
    await expect(folderRow).toBeVisible({ timeout: 2000 });

    // The folder row renders only the title -- none of the song-only columns.
    await expect(folderRow.locator('.col-duration')).toHaveCount(0);
    await expect(folderRow.locator('.col-album')).toHaveCount(0);

    // Expand the folder; its child song row keeps the columns.
    const childItemId = await window.evaluate(async (name) => {
      const items = await window.electronAPI.getListItems(0);
      const folder = items.find((i) => i.list_id !== null && i.list_title === name);
      const children = await window.electronAPI.getListItems(folder.list_id);
      return children[0].id;
    }, folderName);

    await folderRow.locator('.tree-item-icon.chevron').click();
    const childRow = window.locator(`.tree-item-content[data-item-id="${childItemId}"]`);
    await expect(childRow).toBeVisible({ timeout: 1000 });
    await expect(childRow.locator('.col-duration')).toHaveCount(1);
    await expect(childRow.locator('.col-album')).toHaveCount(1);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    await folderRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
