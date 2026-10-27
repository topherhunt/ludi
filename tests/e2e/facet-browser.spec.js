const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The facet browser: browse the tags on a list, drill into combinations, and
 * hand the result to the search box.
 *
 * The fixture lives in its own playlist, and the view is scoped to the list
 * being browsed, so the numbers below are exact rather than "whatever other
 * specs left in the library". Five songs:
 *
 *   fx-deep  s0 s1 s4      fx-wide  s2 s3 s4      fx-rare  s0 s1
 *
 * which makes fx-rare the interesting one: it is on 2 of 5 songs overall but 2
 * of the 3 fx-deep ones, so drilling into fx-deep should surface it above
 * fx-wide even though fx-wide is the bigger tag.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

const PLAYLIST_NAME = 'Facet Lab';
const TAG_NAMES = ['fx-deep', 'fx-wide', 'fx-rare'];

function makeAudioCopies(count) {
  const dir = path.join(os.tmpdir(), `ludi-facet-browser-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (unused, i) => {
    const file = path.join(dir, `fb-${i}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, file);
    return file;
  });
}

/**
 * Select the given songs in the tree and create-and-apply a tag through the edit
 * panel -- the path that loads the tag into the renderer's store, which is what
 * everything else renders from.
 */
async function applyTag(window, songIds, name) {
  for (const [i, songId] of songIds.entries()) {
    const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    await row.click(i === 0 ? {} : { modifiers: ['Meta'] });
  }
  await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

  // Enter rather than a click on the autocomplete's "Create" row: the panel
  // re-renders as the selection resolves, so the dropdown is a moving target.
  // Both go through the same createAndApply path.
  const input = window.locator('.qa-tag-input');
  await input.click();
  await input.fill(name);
  await input.press('Enter');
  await expect(window.locator(`.qa-tags-section [data-tag-name="${name}"]`)).toBeVisible();
}

/** Every facet row on screen: tag name, count, and lift badge (null if absent). */
const rowsOnScreen = (window) =>
  window.locator('.qa-facet-row').evaluateAll((rows) => rows.map((row) => {
    const lift = row.querySelector('.qa-facet-lift');
    return {
      name: row.querySelector('.tag-pill').dataset.tagName,
      count: row.querySelector('.qa-facet-count').textContent,
      lift: lift ? lift.textContent.trim() : null,
    };
  }));

const facetRow = (window, name) =>
  window.locator('.qa-facet-row').filter({ has: window.locator(`[data-tag-name="${name}"]`) });

/** Open the facet browser and back all the way out of any earlier drill-down. */
async function openAtRoot(window) {
  await window.locator('.qa-open-facets').click();
  await expect(window.locator('.qa-facets-view')).toBeVisible();
  await window.locator('.qa-facet-crumb-root').click();
  await expect(window.locator('.qa-facet-crumb')).toHaveCount(0);
}

test.describe('Facet browser', () => {
  let itemIds = [];
  let songIds = [];
  let playlistId = null;
  let tempDir = null;

  test.beforeAll(async ({ window }) => {
    const files = makeAudioCopies(5);
    tempDir = path.dirname(files[0]);

    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', PLAYLIST_NAME);
    await window.click('#renameOkBtn');
    const playlistRow = window.locator('.qa-playlist-item', { hasText: PLAYLIST_NAME });
    await expect(playlistRow).toBeVisible();
    playlistId = parseInt(await playlistRow.getAttribute('data-list-id'), 10);

    const setup = await window.evaluate(async ({ paths, listId }) => {
      const imported = await window.electronAPI.importFiles({
        filePaths: paths, parentListId: 0, position: 0,
      });
      const ids = imported.imported.map((entry) => entry.songId);
      for (const [position, songId] of ids.entries()) {
        await window.electronAPI.addSongToList({ songId, parentListId: listId, position });
      }
      return { itemIds: imported.itemIds, songIds: ids };
    }, { paths: files, listId: playlistId });

    itemIds = setup.itemIds;
    songIds = setup.songIds;

    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await applyTag(window, [songIds[0], songIds[1], songIds[4]], 'fx-deep');
    await applyTag(window, [songIds[2], songIds[3], songIds[4]], 'fx-wide');
    await applyTag(window, [songIds[0], songIds[1]], 'fx-rare');
    await window.keyboard.press('Escape');

    // Everything below browses the fixture playlist, not the whole library.
    await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { window, electronApp } = await setupElectronApp();
    await window.evaluate((listId) => window.electronAPI.deletePlaylist(listId), playlistId);
    await electronApp.evaluate(async (unused, { modulePath, items, names }) => {
      const fsModule = process.mainModule.require('fs');
      const db = process.mainModule.require(modulePath);
      for (const tag of db.getAllTags()) {
        if (names.includes(tag.name)) db.deleteTag(tag.id);
      }
      for (const itemId of items) {
        for (const filePath of db.deleteItemWithFiles(itemId)) {
          fsModule.rmSync(filePath, { force: true });
        }
      }
    }, { modulePath: DATABASE_MODULE, items: itemIds, names: TAG_NAMES });
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('lists every tag on the list with how many songs carry it, commonest first', async ({ window }) => {
    await openAtRoot(window);

    await expect(window.locator('.qa-facet-matches')).toHaveText('5 songs');
    await expect(window.locator('.qa-facet-row')).toHaveCount(3);
    expect(await rowsOnScreen(window)).toEqual([
      { name: 'fx-deep', count: '3', lift: null },
      { name: 'fx-wide', count: '3', lift: null },
      { name: 'fx-rare', count: '2', lift: null },
    ]);
  });

  test('drilling into a tag counts only the songs carrying it', async ({ window }) => {
    await openAtRoot(window);
    await facetRow(window, 'fx-deep').click();

    await expect(window.locator('.qa-facet-crumb')).toHaveCount(1);
    await expect(window.locator('.qa-facet-crumb')).toContainText('fx-deep');
    await expect(window.locator('.qa-facet-matches')).toHaveText('3 songs');

    // fx-deep is gone (it is the drill-down), fx-rare now outranks fx-wide.
    await expect(window.locator('.qa-facet-row')).toHaveCount(2);
    const rows = await rowsOnScreen(window);
    expect(rows.map(row => [row.name, row.count])).toEqual([['fx-rare', '2'], ['fx-wide', '1']]);
  });

  test('marks the tag that is concentrated here and leaves the ordinary one alone', async ({ window }) => {
    await openAtRoot(window);
    await facetRow(window, 'fx-deep').click();
    await expect(window.locator('.qa-facet-row')).toHaveCount(2);

    // fx-rare: 2/5 of the playlist but 2/3 of the fx-deep songs -> 1.7x.
    // fx-wide: 3/5 of the playlist and only 1/3 here, so no badge at all.
    const rows = Object.fromEntries((await rowsOnScreen(window)).map(row => [row.name, row.lift]));
    expect(rows['fx-rare']).toBe('1.7x');
    expect(rows['fx-wide']).toBe(null);
  });

  test('a breadcrumb click backs out of the drill-down', async ({ window }) => {
    await openAtRoot(window);
    await facetRow(window, 'fx-deep').click();
    await facetRow(window, 'fx-rare').click();
    await expect(window.locator('.qa-facet-crumb')).toHaveCount(2);
    await expect(window.locator('.qa-facet-matches')).toHaveText('2 songs');

    // Click the first crumb: back to just fx-deep.
    await window.locator('.qa-facet-crumb').first().click();
    await expect(window.locator('.qa-facet-crumb')).toHaveCount(1);
    await expect(window.locator('.qa-facet-matches')).toHaveText('3 songs');

    await window.locator('.qa-facet-crumb-root').click();
    await expect(window.locator('.qa-facet-matches')).toHaveText('5 songs');
  });

  test('"Show these songs" turns the drill-down into a saveable search', async ({ window }) => {
    await openAtRoot(window);
    await facetRow(window, 'fx-deep').click();
    await facetRow(window, 'fx-rare').click();

    await window.locator('.qa-facet-show-songs').click();

    await expect(window.locator('.search-input')).toHaveValue('tag=fx-deep tag=fx-rare');
    await expect(window.locator('.qa-facets-view')).toHaveCount(0);
    await expect(window.locator('.qa-song-row')).toHaveCount(2);
    await expect(window.locator('.qa-save-search')).toBeVisible();

    await window.locator('.search-clear-btn').click();
  });
});
