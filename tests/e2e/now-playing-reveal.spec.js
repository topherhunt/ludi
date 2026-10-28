const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Clicking the playing song's title or artist opens it in the Main Library.

const STAMP = Date.now();
const ALBUM = `Reveal Album ${STAMP}`;
const SONG_A = `reveal-a-${STAMP}`;
const SONG_B = `reveal-b-${STAMP}`;

const row = (window, title) => window.locator('.qa-song-row').filter({ hasText: title });
const groupRow = (window) => window.locator('.qa-group-row').filter({ hasText: ALBUM });
const caret = (window) => groupRow(window).locator('.tree-item-icon.chevron');

async function playSongAInCollapsedAlbum(window) {
  await window.evaluate(() => window.__ludiResetListViews({
    'list:0': { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] },
  }));
  await window.keyboard.press('Escape');
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  await caret(window).click();
  await row(window, SONG_A).dblclick();
  await expect(window.locator('.qa-now-playing-title')).toHaveText(SONG_A);
  await caret(window).click();
  await expect(row(window, SONG_A)).toHaveCount(0);
}

async function searchFor(window, query) {
  const input = window.locator('.search-input');
  await input.fill(query);
  await input.press('Enter');
  await expect(window.locator('.qa-song-row')).toHaveCount(1, { timeout: 2000 });
}

async function expectRevealed(window) {
  await expect(window.locator('.search-input')).toHaveValue('');
  await expect(row(window, SONG_A)).toHaveClass(/selected/);
  await expect(row(window, SONG_A)).toBeInViewport();
  await expect(window.locator('.qa-song-row.selected')).toHaveCount(1);
  await expect(window.locator('.qa-song-edit-panel')).toBeVisible();
}

test.describe('Revealing the playing song', () => {
  test.beforeAll(async ({ window }) => {
    const files = [SONG_A, SONG_B].map((name) => path.join(os.tmpdir(), `${name}.m4a`));
    files.forEach((p) => fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), p));
    await window.evaluate(async ({ filePaths, titles, album }) => {
      await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      const items = await window.electronAPI.getListItems(0);
      for (const title of titles) {
        const item = items.find((it) => it.song_title === title);
        await window.electronAPI.updateSong({ songId: item.song_id, fields: { album, artist: album } });
      }
    }, { filePaths: files, titles: [SONG_A, SONG_B], album: ALBUM });
    files.forEach((p) => fs.rmSync(p, { force: true }));
  });

  test.afterAll(async ({ window }) => {
    if (await window.locator('#playPauseBtn.playing').count()) await window.locator('#playPauseBtn').click();
    await window.evaluate(async (stamp) => {
      const items = await window.electronAPI.getAllListItems();
      for (const item of items.filter((i) => (i.song_title || '').includes(stamp))) await window.electronAPI.deleteItemWithFiles(item.id);
    }, String(STAMP));
  });

  test('clicking the title leaves a search for the Main Library, opening the album to select the song', async ({ window }) => {
    await playSongAInCollapsedAlbum(window);
    await searchFor(window, SONG_B);

    await window.locator('.qa-now-playing-title').click();
    await expectRevealed(window);
  });

  test('clicking the artist does the same', async ({ window }) => {
    await playSongAInCollapsedAlbum(window);
    await searchFor(window, SONG_B);

    await window.locator('.qa-now-playing-artist').click();
    await expectRevealed(window);
  });
});
