const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// Shuffle is random, so the test pins the randomness instead of guessing: with
// Math.random() stubbed to 0, Fisher-Yates over a 4-song queue with the playing
// song held at the front yields this queue order. Playback that ignores the
// shuffle order walks 0,1,2,3 instead -- which is exactly the bug guarded here.
const SHUFFLED_ORDER = [0, 2, 3, 1];

// The playlist these tests play, the songs in it in queue order, and their
// Main Library placements (deleting those removes the songs and their files).
let playlistId = null;
let songIds = [];
let libraryItemIds = [];

const rowOf = (window, songId) =>
  window.locator(`.tree-item-content[data-song-id="${songId}"]`);

// Deterministic shuffle for the duration of one toggle, then hand Math.random
// back so nothing else in the app inherits the stub.
async function enableShuffleDeterministically(window) {
  await window.evaluate(() => {
    window.__realRandom = Math.random;
    Math.random = () => 0;
  });
  await window.locator('#shuffleBtn').click();
  await window.evaluate(() => {
    Math.random = window.__realRandom;
    delete window.__realRandom;
  });
  expect(await window.evaluate(() => window.shuffleEnabled)).toBe(true);
}

test.describe('Shuffle', () => {
  test.beforeAll(async ({ window }) => {
    const files = [];
    for (let i = 0; i < 4; i++) {
      const p = path.join(os.tmpdir(), `ludi-shuffle-${STAMP}-${i}.m4a`);
      fs.copyFileSync(TONE, p);
      files.push(p);
    }

    // Through the UI, so the sidebar shows it.
    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', `Shuffle ${STAMP}`);
    await window.click('#renameOkBtn');
    const playlist = window.locator('.qa-playlist-item').filter({ hasText: `Shuffle ${STAMP}` });
    await expect(playlist).toBeVisible({ timeout: 2000 });
    playlistId = parseInt(await playlist.getAttribute('data-list-id'));

    const result = await window.evaluate(async ({ filePaths, listId }) => {
      const imported = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      await window.electronAPI.copyItemsToList({ itemIds: imported.itemIds, targetListId: listId, skipSongIds: [] });
      const items = await window.electronAPI.getListItems(listId);
      return { libraryItemIds: imported.itemIds, songIds: items.map((it) => it.song_id) };
    }, { filePaths: files, listId: playlistId });

    files.forEach((p) => fs.unlinkSync(p));
    libraryItemIds = result.libraryItemIds;
    songIds = result.songIds;
    expect(songIds).toHaveLength(4);
  });

  test.afterAll(async ({ window }) => {
    const playlist = window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`);
    await playlist.click({ button: 'right' });
    await window.click('.qa-playlist-delete');
    await window.click('#modalYesBtn');
    await expect(playlist).toHaveCount(0, { timeout: 2000 });
    await window.evaluate(async (itemIds) => {
      for (const id of itemIds) await window.electronAPI.deleteItemWithFiles(id);
    }, libraryItemIds);
  });

  test('shuffle keeps the current song and then plays the queue in shuffled order', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();

    // Playing from the playlist queues just its 4 songs.
    await rowOf(window, songIds[0]).dblclick();
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);
    await expect(rowOf(window, songIds[0])).toHaveClass(/current-song/);

    // Turning shuffle on mid-song must not cut the current song off.
    await enableShuffleDeterministically(window);
    await expect(rowOf(window, songIds[0])).toHaveClass(/current-song/);

    for (const position of SHUFFLED_ORDER.slice(1)) {
      await window.locator('#nextBtn').click();
      await expect(rowOf(window, songIds[position])).toHaveClass(/current-song/);
    }

    // Turning shuffle back off leaves us on the song that was playing.
    const last = songIds[SHUFFLED_ORDER[SHUFFLED_ORDER.length - 1]];
    await window.locator('#shuffleBtn').click();
    expect(await window.evaluate(() => window.shuffleEnabled)).toBe(false);
    await expect(rowOf(window, last)).toHaveClass(/current-song/);

    // ...and linear playback resumes from there, not from wherever the shuffled
    // position happened to point.
    await window.locator('#nextBtn').click();
    await expect(rowOf(window, songIds[2])).toHaveClass(/current-song/);

    await window.locator('#playPauseBtn').click();
  });
});
