const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const STAMP = Date.now();

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

  // A file deleted or renamed behind the app's back used to be undeletable: the
  // failed load left the watchdog running, so every few seconds the recovery
  // retried the dead track and threw another "File Not Found" alert on screen --
  // and alerts and confirms share one modal, so each retry wiped out the delete
  // confirmation before it could be answered.
  test('a song whose file vanished from disk can still be deleted', async ({ window }) => {
    const src = path.join(os.tmpdir(), `ludi-missing-${STAMP}.m4a`);
    fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), src);
    const { absPath, itemId } = await window.evaluate(async (filePath) => {
      const result = await window.electronAPI.importFiles({ filePaths: [filePath], parentListId: 0, position: 0 });
      const { songId, itemId } = result.imported[0];
      const song = await window.electronAPI.getSong(songId);
      return { absPath: song.file_path, itemId };
    }, src);
    fs.unlinkSync(src);

    // The user renames or deletes the file in the Finder.
    fs.unlinkSync(absPath);

    // Shorten the stall window so a retry, if one comes, comes inside the test.
    await window.evaluate(() => { window.__ludiStallTimeoutMs = 250; });

    await window.locator('.playlist-item').first().click();
    const row = window.locator(`.tree-item-content[data-item-id="${itemId}"]`);
    await expect(row).toBeVisible({ timeout: 2000 });

    const overlay = window.locator('.modal-overlay.visible');
    await row.dblclick();
    await expect(overlay.locator('.modal-title')).toContainText('File Not Found', { timeout: 3000 });
    await overlay.locator('.modal-btn', { hasText: 'OK' }).click();

    // Nothing retries a file that is definitively gone, so no second alert.
    await window.waitForTimeout(800);
    await expect(overlay).toHaveCount(0);

    await row.click();
    await window.keyboard.press('Backspace');
    await expect(overlay.locator('.modal-title')).toContainText('Confirm Delete', { timeout: 2000 });
    await window.click('#modalYesBtn');
    await expect(row).toHaveCount(0, { timeout: 2000 });

    await window.evaluate(() => { delete window.__ludiStallTimeoutMs; });
  });
});
