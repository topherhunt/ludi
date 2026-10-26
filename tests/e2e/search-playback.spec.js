const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// The tone carries no ID3 title, so each copy's filename becomes its title.
// One folder holds two hits with a non-match between them; a third hit sits
// outside the folder. The search shows the folder (two hits) plus the loose one.
const TERM = `ludiplay${STAMP}`;
const DIR = path.join(os.tmpdir(), `ludi-search-play-${STAMP}`);
const HIT_A = `a-${TERM}`;
const SKIP = `b-skip-${STAMP}`;
const HIT_C = `c-${TERM}`;
const HIT_D = `d-${TERM}`;

const nowPlaying = (window) => window.locator('.player-info .song-title');
const row = (window, title) => window.locator('.qa-search-song').filter({ hasText: title });

async function search(window, query, expectedRows) {
  await window.keyboard.press('Escape');
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  await window.waitForTimeout(150);
  const input = window.locator('.search-input');
  await input.fill(query);
  await input.press('Enter');
  await expect(window.locator('.qa-search-song')).toHaveCount(expectedRows, { timeout: 2000 });
}

async function next(window) {
  await window.locator('#nextBtn').click();
  await window.waitForTimeout(150);
}

test.describe('Playing from search results', () => {
  test.beforeAll(async ({ window }) => {
    fs.mkdirSync(DIR, { recursive: true });
    for (const name of [HIT_A, SKIP, HIT_C]) fs.copyFileSync(TONE, path.join(DIR, `${name}.m4a`));
    const loose = path.join(os.tmpdir(), `${HIT_D}.m4a`);
    fs.copyFileSync(TONE, loose);

    await window.evaluate(async (paths) => {
      await window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 });
    }, [DIR, loose]);
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.rmSync(loose, { force: true });

    // Loop off, so running off the end of the queue shows where the queue ends.
    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 1; });
    while (await window.evaluate(() => window.loopMode) !== 'off') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
  });

  test.afterAll(async ({ window }) => {
    if (await window.locator('#playPauseBtn.playing').count()) await window.locator('#playPauseBtn').click();
    await window.evaluate(async ({ stamp, dirName }) => {
      const items = await window.electronAPI.getAllListItems();
      const ours = items.filter((i) => (i.song_title || '').includes(stamp) || i.list_title === dirName);
      for (const item of ours) await window.electronAPI.deleteItemWithFiles(item.id);
    }, { stamp: String(STAMP), dirName: path.basename(DIR) });
    while (await window.evaluate(() => window.loopMode) !== 'all') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  test('double-clicking a hit queues the search results, not the folder it lives in', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_A).dblclick();
    await expect(nowPlaying(window)).toHaveText(HIT_A);

    // The non-match between them in the folder is skipped...
    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
    // ...and the loose hit outside the folder comes next.
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

  test('double-clicking a search folder plays just the hits inside it', async ({ window }) => {
    await search(window, TERM, 3);

    const folder = window.locator('.qa-search-folder').filter({ hasText: path.basename(DIR) });
    await folder.dblclick();
    await expect(nowPlaying(window)).toHaveText(HIT_A);
    await expect(row(window, HIT_C)).toBeVisible(); // two toggles leave it expanded

    await next(window);
    await expect(nowPlaying(window)).toHaveText(HIT_C);
    // The loose hit is outside the folder, so the queue ends here.
    await expect(window.locator('#nextBtn')).toBeDisabled();
  });

  test('right-clicking a hit opens the song menu with folder-placement actions grayed out', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_A).click({ button: 'right' });
    const menu = window.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.qa-find-similar')).toBeVisible();
    await expect(menu.locator('.qa-rate-menu')).toBeVisible();
    await expect(menu.locator('.qa-copy-files-to')).toBeVisible();
    await expect(menu.locator('.qa-add-folder-after')).toHaveClass(/disabled/);

    // A grayed-out item does nothing, not even close the menu.
    await menu.locator('.qa-add-folder-after').click();
    await expect(menu).toBeVisible();

    await window.locator('.search-input').click();
    await expect(menu).toHaveCount(0);
  });

  test('deleting a hit from the search menu drops it from the results', async ({ window }) => {
    await search(window, TERM, 3);

    await row(window, HIT_D).click({ button: 'right' });
    await window.locator('.context-menu-item').filter({ hasText: 'Delete' }).click();
    await window.click('#modalYesBtn');

    await expect(window.locator('.qa-search-song')).toHaveCount(2);
    await expect(row(window, HIT_D)).toHaveCount(0);
  });
});
