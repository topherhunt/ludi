const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Saved searches: a query pinned to the sidebar under a name of your choosing.
 *
 * What has to hold is that the saved thing is the *question*, not its answer --
 * clicking a saved search re-runs the query, a rename leaves that query alone,
 * and deleting one takes nothing else with it.
 *
 * Three songs, each with a title only it matches, so "did the right query run"
 * is answerable by counting rows.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

function makeAudioCopies(count) {
  const dir = path.join(os.tmpdir(), `ludi-saved-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (unused, i) => {
    const file = path.join(dir, `savedtone${i}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, file);
    return file;
  });
}

const savedRow = (window, name) => window.locator('.qa-saved-search', { hasText: name });

/** Type a query into the search box and wait for its results. */
async function search(window, query, expectedCount) {
  await window.locator('.search-input').fill(query);
  await window.keyboard.press('Enter');
  await expect(window.locator('.qa-song-row')).toHaveCount(expectedCount);
}

/** Pin the search that's currently running to the sidebar. */
async function saveCurrentSearch(window, name) {
  await window.locator('.qa-save-search').click();
  await window.fill('#renameInput', name);
  await window.click('#renameOkBtn');
  await expect(savedRow(window, name)).toBeVisible();
}

async function deleteSavedSearch(window, name) {
  await savedRow(window, name).click({ button: 'right' });
  await window.locator('.qa-saved-search-delete').click();
  await window.click('#modalYesBtn');
  await expect(savedRow(window, name)).toHaveCount(0);
}

test.describe('Saved searches', () => {
  test.describe.configure({ timeout: 60000 });

  let itemIds = [];
  let tempDir = null;

  test.beforeAll(async ({ window }) => {
    const files = makeAudioCopies(3);
    tempDir = path.dirname(files[0]);

    await window.keyboard.press('Escape');
    itemIds = await window.evaluate(async (paths) => {
      const imported = await window.electronAPI.importFiles({
        filePaths: paths, parentListId: 0, position: 0,
      });
      return imported.itemIds;
    }, files);
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { electronApp } = await setupElectronApp();
    await electronApp.evaluate(async (unused, { modulePath, items }) => {
      const fsModule = process.mainModule.require('fs');
      const db = process.mainModule.require(modulePath);
      // Anything a failing test left pinned, so the next spec file gets a clean
      // sidebar.
      for (const saved of db.getSavedSearches()) db.deleteSavedSearch(saved.id);
      for (const itemId of items) {
        for (const filePath of db.deleteItemWithFiles(itemId)) {
          fsModule.rmSync(filePath, { force: true });
        }
      }
    }, { modulePath: DATABASE_MODULE, items: itemIds });
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('pins the running search to the sidebar, and clicking it runs that query again', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await search(window, 'savedtone0', 1);

    // The query is offered as the name, since a facet combination already reads
    // as a title.
    await window.locator('.qa-save-search').click();
    await expect(window.locator('#renameInput')).toHaveValue('savedtone0');
    await window.fill('#renameInput', 'First tone');
    await window.click('#renameOkBtn');
    await expect(savedRow(window, 'First tone')).toBeVisible();

    await window.locator('.search-clear-btn').click();
    await expect(window.locator('#explorerTree')).toBeVisible();

    await savedRow(window, 'First tone').click();
    await expect(window.locator('.search-input')).toHaveValue('savedtone0');
    await expect(window.locator('.qa-song-row')).toHaveCount(1);
    await expect(savedRow(window, 'First tone')).toHaveClass(/active/);

    await deleteSavedSearch(window, 'First tone');
    await window.locator('.search-clear-btn').click();
  });

  test('renaming a saved search leaves the query it runs untouched', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await search(window, 'savedtone1', 1);
    await saveCurrentSearch(window, 'Second tone');
    await window.locator('.search-clear-btn').click();

    await savedRow(window, 'Second tone').click({ button: 'right' });
    await window.locator('.qa-saved-search-rename').click();
    await window.fill('#renameInput', 'Renamed tone');
    await window.click('#renameOkBtn');
    await expect(savedRow(window, 'Second tone')).toHaveCount(0);

    await savedRow(window, 'Renamed tone').click();
    await expect(window.locator('.search-input')).toHaveValue('savedtone1');
    await expect(window.locator('.qa-song-row')).toHaveCount(1);

    await deleteSavedSearch(window, 'Renamed tone');
    await window.locator('.search-clear-btn').click();
  });

  test('deleting a saved search drops it from the sidebar and keeps the songs it matched', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await search(window, 'savedtone2', 1);
    await saveCurrentSearch(window, 'Third tone');
    await window.locator('.search-clear-btn').click();

    await deleteSavedSearch(window, 'Third tone');

    // Nothing pinned any more, so the whole section goes away -- and the song
    // that search was about is still there to be found by hand.
    await expect(window.locator('.qa-saved-searches')).toHaveCount(0);
    await search(window, 'savedtone2', 1);
    await window.locator('.search-clear-btn').click();
  });
});
