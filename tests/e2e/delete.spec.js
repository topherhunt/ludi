const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');

test.describe('Delete', () => {
  test('moves the audio file out of the library (to Trash) when a song is deleted', async ({ window }) => {
    const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

    // Import a song so this test owns its data; importing copies it into the library.
    const importResult = await window.evaluate((filePath) => {
      return window.electronAPI.importFiles({ filePaths: [filePath], parentListId: 0, position: 0 });
    }, testAudioPath);
    const songId = importResult.imported[0].songId;

    // Resolve the song's on-disk path and its list_item id (for selecting the row).
    const { absPath, itemId } = await window.evaluate(async (sid) => {
      const song = await window.electronAPI.getSong(sid);
      const items = await window.electronAPI.getListItems(0);
      const item = items.find((i) => i.song_id === sid);
      return { absPath: song.file_path, itemId: item.id };
    }, songId);

    // The audio file is present in the library before deleting.
    expect(fs.existsSync(absPath)).toBe(true);

    // Delete through the real UI flow: select the row, press Backspace, confirm.
    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(150);

    const row = window.locator(`.tree-item-content[data-item-id="${itemId}"]`);
    await expect(row).toBeVisible({ timeout: 2000 });
    await row.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(300);

    // The file has been moved to the Trash, so it is no longer in the library folder.
    expect(fs.existsSync(absPath)).toBe(false);
  });
});
