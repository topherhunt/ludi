const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// The tone carries no ID3 title, so each copy's filename becomes its title.
// One album holds two hits with a non-match between them; a third hit has no
// album. Grouped by album, the search shows the album (two hits) plus the loose one.
const TERM = `ludiplay${STAMP}`;
const ALBUM = `Album ${STAMP}`;
const HIT_A = `a-${TERM}`;
const SKIP = `b-skip-${STAMP}`;
const HIT_C = `c-${TERM}`;
const HIT_D = `d-${TERM}`;
const SEARCH_GROUP = '.qa-group-row';

const nowPlaying = (window) => window.locator('.player-info .song-title');
const row = (window, title) => window.locator('.qa-song-row').filter({ hasText: title });

async function search(window, query, expectedRows) {
  await window.evaluate(() => window.__ludiResetListViews({
    'list:0': { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] },
  }));
  await window.keyboard.press('Escape');
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  await window.waitForTimeout(150);
  const input = window.locator('.search-input');
  await input.fill(query);
  await input.press('Enter');
  await expect(window.locator('.qa-song-row')).toHaveCount(expectedRows, { timeout: 2000 });
}

async function next(window) {
  await window.locator('#nextBtn').click();
  await window.waitForTimeout(150);
}

test.describe('Playing from search results', () => {
  test.beforeAll(async ({ window }) => {
    const files = [HIT_A, SKIP, HIT_C, HIT_D].map((name) => path.join(os.tmpdir(), `${name}.m4a`));
    files.forEach((p) => fs.copyFileSync(TONE, p));

    await window.evaluate(async ({ filePaths, titles, album }) => {
      await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      const items = await window.electronAPI.getListItems(0);
      for (const title of titles) {
        const item = items.find((it) => it.song_title === title);
        await window.electronAPI.updateSong({ songId: item.song_id, fields: { album } });
      }
    }, { filePaths: files, titles: [HIT_A, SKIP, HIT_C], album: ALBUM });
    files.forEach((p) => fs.rmSync(p, { force: true }));

    // Loop off, so running off the end of the queue shows where the queue ends.
    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 1; });
    while (await window.evaluate(() => window.loopMode) !== 'off') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
  });

  test.afterAll(async ({ window }) => {
    if (await window.locator('#playPauseBtn.playing').count()) await window.locator('#playPauseBtn').click();
    await window.evaluate(async (stamp) => {
      const items = await window.electronAPI.getAllListItems();
      const ours = items.filter((i) => (i.song_title || '').includes(stamp));
      for (const item of ours) await window.electronAPI.deleteItemWithFiles(item.id);
    }, String(STAMP));
    while (await window.evaluate(() => window.loopMode) !== 'all') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  test('double-clicking a hit queues the search results, not the album it is on', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_A).dblclick();
    await expect(nowPlaying(window)).toHaveText(HIT_A);

    // The non-match between them on the album is skipped...
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
    // ...and the loose hit outside the album comes next.
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_D);
    await expect(window.locator('#nextBtn')).toBeDisabled();
  });

  test('Enter on a selected hit plays through the same search queue', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_A).click();
    await window.keyboard.press('Enter');
    await expect(nowPlaying(window)).toHaveText(HIT_A);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
  });

  test('the queue keeps the results it started from when the search changes', async ({ window }) => {
    await search(window, TERM, 3);
    await row(window, HIT_A).dblclick();
    await expect(nowPlaying(window)).toHaveText(HIT_A);

    await search(window, HIT_A, 1);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
  });

  test('double-clicking an album group plays its hits, then on through the rest of the results', async ({ window }) => {
    await search(window, TERM, 3);

    await window.locator(SEARCH_GROUP).filter({ hasText: ALBUM }).dblclick();
    await expect(nowPlaying(window)).toHaveText(HIT_A);

    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_D);
    await expect(window.locator('#nextBtn')).toBeDisabled();
  });

  test('right-clicking a hit opens the song menu without folder-placement actions', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_A).click({ button: 'right' });
    const menu = window.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.qa-find-similar')).toBeVisible();
    await expect(menu.locator('.qa-rate-menu')).toBeVisible();
    await expect(menu.locator('.qa-copy-files-to')).toBeVisible();
    await expect(menu.locator('.qa-add-folder-after')).toHaveCount(0);

    await window.locator('.search-input').click();
    await expect(menu).toHaveCount(0);
  });

  test('right-clicking an album group plays from its hits on through the results', async ({ window }) => {
    await search(window, TERM, 3);

    await window.locator(SEARCH_GROUP).filter({ hasText: ALBUM }).click({ button: 'right' });
    await window.locator('.context-menu .qa-play-group').click();
    await expect(nowPlaying(window)).toHaveText(HIT_A);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_D);
  });

  test('rating a hit redraws its stars, and a collapsed group stays collapsed', async ({ window }) => {
    await search(window, TERM, 3);
    const stars = row(window, HIT_D).locator('.qa-star-rating');

    await stars.locator('[data-star="4"]').click();
    await expect(stars).toHaveAttribute('data-rating', '4');
    await row(window, HIT_D).click({ button: 'right' });
    await window.locator('.qa-rate-menu').hover();
    await window.locator('.qa-rate-clear').click();
    await expect(stars).toHaveAttribute('data-rating', '');

    // The results refresh in place rather than being rebuilt from scratch.
    await window.locator(`${SEARCH_GROUP} .chevron`).click();
    await expect(row(window, HIT_A)).toHaveCount(0);
    await stars.locator('[data-star="2"]').click();
    await expect(stars).toHaveAttribute('data-rating', '2');
    await expect(row(window, HIT_A)).toHaveCount(0);
  });

  test('a hit rated out of the query stays until the search is run again', async ({ window }) => {
    await search(window, `${TERM} rating=none`, 2);
    const stars = row(window, HIT_A).locator('.qa-star-rating');

    await stars.locator('[data-star="5"]').click();
    await expect(stars).toHaveAttribute('data-rating', '5');
    await expect(window.locator('.qa-song-row')).toHaveCount(2);

    await window.locator('.search-input').press('Enter');
    await expect(window.locator('.qa-song-row')).toHaveCount(1);
    await expect(row(window, HIT_A)).toHaveCount(0);
  });

  test('deleting a hit from the search menu drops it from the results', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_D).click({ button: 'right' });
    await window.locator('.context-menu-item').filter({ hasText: 'Delete' }).click();
    await window.click('#modalYesBtn');

    await expect(window.locator('.qa-song-row')).toHaveCount(2);
    await expect(row(window, HIT_D)).toHaveCount(0);
  });
});
