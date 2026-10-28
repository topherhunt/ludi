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

  test('deleting songs that live inside imported (hidden) folders removes their files', async ({ window }) => {
    const outer = path.join(os.tmpdir(), `ludi-nested-delete-${STAMP}`);
    fs.mkdirSync(path.join(outer, 'inner'), { recursive: true });
    fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), path.join(outer, `top-${STAMP}.m4a`));
    fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), path.join(outer, 'inner', `deep-${STAMP}.m4a`));
    await window.evaluate((fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }), outer);
    fs.rmSync(outer, { recursive: true, force: true });

    const absPaths = await window.evaluate(async (stamp) => {
      const items = await window.electronAPI.getAllListItems();
      const songs = items.filter((i) => (i.song_title || '').includes(stamp));
      return Promise.all(songs.map((i) => window.electronAPI.getSong(i.song_id).then((s) => s.file_path)));
    }, String(STAMP));
    expect(absPaths).toHaveLength(2);
    absPaths.forEach((p) => expect(fs.existsSync(p)).toBe(true));

    // The folders aren't shown; the songs inside them are listed directly.
    await window.locator('.playlist-item').first().click();
    const top = window.locator('.qa-song-row').filter({ hasText: `top-${STAMP}` });
    const deep = window.locator('.qa-song-row').filter({ hasText: `deep-${STAMP}` });
    await top.click();
    await deep.click({ modifiers: ['Meta'] });
    await expect(window.locator('.tree-item-content.selected')).toHaveCount(2);

    await window.keyboard.press('Backspace');
    await window.click('#modalYesBtn');
    await expect(top).toHaveCount(0, { timeout: 2000 });
    await expect(deep).toHaveCount(0);
    await expect.poll(() => absPaths.filter((p) => fs.existsSync(p))).toEqual([]);
  });

  test('Delete from the context menu of a selected song deletes the whole selection, listing every song', async ({ window }) => {
    const names = ['one', 'two', 'three'].map((n) => `multi-${n}-${STAMP}`);
    const files = names.map((name) => path.join(os.tmpdir(), `${name}.m4a`));
    files.forEach((p) => fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), p));
    await window.evaluate((filePaths) => window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 }), files);
    files.forEach((p) => fs.rmSync(p, { force: true }));

    await window.locator('.playlist-item').first().click();
    const rows = names.map((name) => window.locator('.qa-song-row').filter({ hasText: name }));
    await rows[0].click();
    await rows[1].click({ modifiers: ['Meta'] });
    await rows[2].click({ modifiers: ['Meta'] });

    await rows[1].click({ button: 'right' });
    await window.locator('.context-menu-item').filter({ hasText: 'Delete' }).click();
    await expect(window.locator('.qa-delete-list li')).toHaveText(names);
    await window.click('#modalYesBtn');
    for (const row of rows) await expect(row).toHaveCount(0, { timeout: 2000 });
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
