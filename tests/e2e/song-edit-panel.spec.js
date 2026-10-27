const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// The edit panel shows how long a multi-song selection would take to play.

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

let folder = null;  // { listId, itemId }
let songIds = [];
let toneSeconds = 0;

const rowOf = (window, songId) =>
  window.locator(`.tree-item-content[data-song-id="${songId}"]`);

const playtime = (window) => window.locator('.qa-song-edit-playtime');

const formatTime = (seconds) => {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return h === 0 ? `${m}:${s}` : `${h}:${m.toString().padStart(2, '0')}:${s}`;
};

test.describe('Song edit panel', () => {
  test.beforeAll(async ({ window }) => {
    const files = [];
    for (let i = 0; i < 3; i++) {
      const p = path.join(os.tmpdir(), `ludi-editpanel-${STAMP}-${i}.m4a`);
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
        durations: items.map((it) => it.duration_seconds),
      };
    }, { filePaths: files, title: `EditPanel ${STAMP}` });

    files.forEach((p) => fs.unlinkSync(p));
    folder = { listId: result.listId, itemId: result.itemId };
    songIds = result.songIds;
    toneSeconds = result.durations[0];
    expect(songIds).toHaveLength(3);
    expect(toneSeconds).toBeGreaterThan(0);

    await window.keyboard.press('Escape');
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await expect(rowOf(window, songIds[0])).toBeVisible({ timeout: 2000 });
  });

  test.afterAll(async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), folder.itemId);
  });

  test('a single song shows no playtime line', async ({ window }) => {
    await rowOf(window, songIds[0]).click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();
    await expect(playtime(window)).toHaveCount(0);
  });

  test('a multi-song selection totals its playtime under the heading', async ({ window }) => {
    await rowOf(window, songIds[0]).click();
    await rowOf(window, songIds[1]).click({ modifiers: ['Meta'] });
    await rowOf(window, songIds[2]).click({ modifiers: ['Meta'] });

    await expect(window.locator('.qa-song-edit-heading')).toHaveText('Edit 3 songs');
    await expect(playtime(window)).toHaveText(`${formatTime(toneSeconds * 3)} total`);
  });

  // DEPRECATED (folders): song lists no longer show folder rows. TODO: delete
  // with the rest of the folder code (see TASKS.md).
  test.skip('selecting the folder totals every song inside it', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator(`.tree-item-content[data-folder-id="${folder.listId}"]`).click();

    await expect(window.locator('.qa-song-edit-heading')).toHaveText('Edit 3 songs');
    await expect(playtime(window)).toHaveText(`${formatTime(toneSeconds * 3)} total`);
  });
});
