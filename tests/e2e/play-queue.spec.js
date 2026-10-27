const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();
const DIR = path.join(os.tmpdir(), `ludi-queue-${STAMP}`);

// A playlist holding a folder (two songs plus a collapsed subfolder with one)
// and a loose song after it. The tone has no ID3 title, so filenames are titles.
const A = `qa-${STAMP}`;
const B = `qb-inner-${STAMP}`;
const C = `qc-${STAMP}`;
const D = `qd-loose-${STAMP}`;
const PLAYLIST = `Queue ${STAMP}`;

const nowPlaying = (window) => window.locator('.player-info .song-title');
const songRow = (window, title) => window.locator('.tree-item-content').filter({ hasText: title });

async function next(window) {
  await window.locator('#nextBtn').click();
  await window.waitForTimeout(150);
}

test.describe('Play queue from the library tree', () => {
  let playlistId;
  let libraryItemIds;

  test.beforeAll(async ({ window }) => {
    fs.mkdirSync(path.join(DIR, 'inner'), { recursive: true });
    fs.copyFileSync(TONE, path.join(DIR, `${A}.m4a`));
    fs.copyFileSync(TONE, path.join(DIR, `${C}.m4a`));
    fs.copyFileSync(TONE, path.join(DIR, 'inner', `${B}.m4a`));
    const loose = path.join(os.tmpdir(), `${D}.m4a`);
    fs.copyFileSync(TONE, loose);

    libraryItemIds = await window.evaluate(async (paths) => {
      const imported = await window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 });
      return imported.itemIds;
    }, [DIR, loose]);
    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', PLAYLIST);
    await window.click('#renameOkBtn');
    const playlistRow = window.locator('.qa-playlist-item').filter({ hasText: PLAYLIST });
    playlistId = parseInt(await playlistRow.getAttribute('data-list-id'));
    await window.evaluate(({ itemIds, targetListId }) => (
      window.electronAPI.copyItemsToList({ itemIds, targetListId, skipSongIds: [] })
    ), { itemIds: libraryItemIds, targetListId: playlistId });
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.rmSync(loose, { force: true });

    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 1; });
    while (await window.evaluate(() => window.loopMode) !== 'off') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
  });

  test.afterAll(async ({ window }) => {
    if (await window.locator('#playPauseBtn.playing').count()) await window.locator('#playPauseBtn').click();
    await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click({ button: 'right' });
    await window.click('.qa-playlist-delete');
    await window.click('#modalYesBtn');
    await window.evaluate(async (ids) => {
      for (const id of ids) await window.electronAPI.deleteItemWithFiles(id);
    }, libraryItemIds);
    while (await window.evaluate(() => window.loopMode) !== 'all') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  async function openPlaylist(window) {
    await window.keyboard.press('Escape');
    await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();
    await expect(songRow(window, A)).toBeVisible();
  }

  test('double-clicking a song queues the whole playlist, songs in hidden folders included', async ({ window }) => {
    await openPlaylist(window);
    await expect(songRow(window, B)).toBeVisible(); // folders aren't shown; their songs are

    await songRow(window, A).dblclick();
    await expect(nowPlaying(window)).toHaveText(A);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(C);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(B);
    // ...and on past the folder to the loose song.
    await next(window);
    await expect(nowPlaying(window)).toHaveText(D);
    await expect(window.locator('#nextBtn')).toBeDisabled();
  });

  // DEPRECATED (folders): song lists no longer show folder rows. TODO: delete
  // with the rest of the folder code (see TASKS.md).
  test.skip('double-clicking a folder queues just that folder, subfolders included', async ({ window }) => {
    const outer = await openPlaylist(window);

    await outer.dblclick();
    await expect(nowPlaying(window)).toHaveText(A);
    await next(window);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(B);
    await expect(window.locator('#nextBtn')).toBeDisabled();
  });
});
