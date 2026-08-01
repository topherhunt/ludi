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

// The folder these tests play, and the songs inside it in queue order.
let folder = null; // { listId, itemId }
let songIds = [];

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

    const result = await window.evaluate(async ({ filePaths, title }) => {
      const listId = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title });
      await window.electronAPI.importFiles({ filePaths, parentListId: listId, position: 0 });
      const placements = await window.electronAPI.getListItems(0);
      const items = await window.electronAPI.getListItems(listId);
      return {
        listId,
        itemId: placements.find((it) => it.list_id === listId).id,
        songIds: items.map((it) => it.song_id),
      };
    }, { filePaths: files, title: `Shuffle ${STAMP}` });

    files.forEach((p) => fs.unlinkSync(p));
    folder = { listId: result.listId, itemId: result.itemId };
    songIds = result.songIds;
    expect(songIds).toHaveLength(4);
  });

  test.afterAll(async ({ window }) => {
    if (folder) {
      await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), folder.itemId);
    }
  });

  test('shuffle keeps the current song and then plays the queue in shuffled order', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();

    const folderRow = window.locator(`.tree-item-content[data-folder-id="${folder.listId}"]`);
    await expect(folderRow).toBeVisible({ timeout: 2000 });
    await folderRow.locator('.tree-item-icon.chevron').click();
    await expect(rowOf(window, songIds[0])).toBeVisible({ timeout: 2000 });

    // Play the folder from its first song: the queue is the folder's 4 songs.
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
