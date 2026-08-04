const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The sidebar tag list as a description of what you're looking at.
 *
 * Three properties, all of which need the real store wiring to check:
 *   - the chips are scoped to the current view, with a count of how much of it
 *     carries each tag;
 *   - clicking chips accumulates filters rather than replacing them; and
 *   - clicking a lit chip takes its filter back off.
 *
 * The fixture is three songs tagged so every combination is distinguishable:
 * song A is (alpha, beta), song B is (alpha), song C is (gamma), and only A and
 * B are in the playlist.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');
const TAG_NAMES = ['alpha', 'beta', 'gamma'];

function makeAudioCopies(count) {
  const dir = path.join(os.tmpdir(), `ludi-facets-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (unused, i) => {
    const file = path.join(dir, `facet-${i}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, file);
    return file;
  });
}

/** Select the given songs and create-and-apply a tag through the edit panel. */
async function applyTag(window, songIds, name) {
  for (const [i, songId] of songIds.entries()) {
    const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    await row.click(i === 0 ? {} : { modifiers: ['Meta'] });
  }
  await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

  const input = window.locator('.qa-tag-input');
  await input.click();
  await input.fill(name);
  await window.locator('.qa-tag-create').click();
  await expect(window.locator('.qa-tags-section [data-tag-name="' + name + '"]')).toBeVisible();
}

const sidebarChip = (window, name) =>
  window.locator(`.qa-tags-section [data-tag-name="${name}"]`);

/** The names of every tag chip currently in the sidebar. */
const chipNames = (window) =>
  window.locator('.qa-tags-section .tag-pill').evaluateAll(
    (pills) => pills.map((pill) => pill.dataset.tagName)
  );

/** name -> count, as rendered on the sidebar chips. */
const chipCounts = (window) =>
  window.locator('.qa-tags-section .tag-pill').evaluateAll(
    (pills) => Object.fromEntries(pills.map((pill) => [
      pill.dataset.tagName,
      pill.querySelector('.qa-tag-count').textContent,
    ]))
  );

test.describe('Sidebar tag facets', () => {
  test.describe.configure({ timeout: 60000 });

  let itemIds = [];
  let songIds = [];
  let playlistId = null;
  let tempDir = null;

  test.beforeAll(async ({ window }) => {
    const files = makeAudioCopies(3);
    tempDir = path.dirname(files[0]);

    // Created through the UI so the sidebar's list resource picks it up.
    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', 'Facet Playlist');
    await window.click('#renameOkBtn');
    const playlistRow = window.locator('.qa-playlist-item', { hasText: 'Facet Playlist' });
    await expect(playlistRow).toBeVisible();
    playlistId = parseInt(await playlistRow.getAttribute('data-list-id'), 10);

    const setup = await window.evaluate(async ({ paths, listId }) => {
      const imported = await window.electronAPI.importFiles({
        filePaths: paths, parentListId: 0, position: 0,
      });
      const ids = imported.imported.map((entry) => entry.songId);
      await window.electronAPI.addSongToList({ songId: ids[0], parentListId: listId, position: 0 });
      await window.electronAPI.addSongToList({ songId: ids[1], parentListId: listId, position: 1 });
      return { itemIds: imported.itemIds, songIds: ids };
    }, { paths: files, listId: playlistId });

    itemIds = setup.itemIds;
    songIds = setup.songIds;

    // Tags go on through the edit panel rather than straight into the database:
    // that is the path that loads them into the renderer's tag store, which is
    // what the sidebar renders from.
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await applyTag(window, [songIds[0], songIds[1]], 'alpha');
    await applyTag(window, [songIds[0]], 'beta');
    await applyTag(window, [songIds[2]], 'gamma');
    await window.keyboard.press('Escape');
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

  test('counts how many songs in the current view carry each tag', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await expect(sidebarChip(window, 'alpha')).toBeVisible();

    const counts = await chipCounts(window);
    expect(counts.alpha).toBe('2');
    expect(counts.beta).toBe('1');
    expect(counts.gamma).toBe('1');
  });

  test('shows only the tags present in the playlist being viewed', async ({ window }) => {
    await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();
    await expect(sidebarChip(window, 'gamma')).toHaveCount(0);

    const counts = await chipCounts(window);
    expect(counts.alpha).toBe('2');
    expect(counts.beta).toBe('1');
    expect(await chipNames(window)).not.toContain('gamma');
  });

  test('narrows the counts further when the view is searched', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await window.locator('.search-input').fill('facet-0');
    await window.keyboard.press('Enter');
    await expect(window.locator('.qa-search-song')).toHaveCount(1);

    // Only song A is on screen, so alpha drops from 2 to 1 and gamma is gone.
    const counts = await chipCounts(window);
    expect(counts.alpha).toBe('1');
    expect(counts.beta).toBe('1');
    expect(await chipNames(window)).not.toContain('gamma');

    await window.locator('.search-clear-btn').click();
  });

  test('adds a second tag as an extra filter instead of replacing the first', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();

    await sidebarChip(window, 'alpha').click();
    await expect(window.locator('.search-input')).toHaveValue('tag=alpha');
    await expect(window.locator('.qa-search-song')).toHaveCount(2);

    await sidebarChip(window, 'beta').click();
    await expect(window.locator('.search-input')).toHaveValue('tag=alpha tag=beta');

    // Only song A carries both.
    await expect(window.locator('.qa-search-song')).toHaveCount(1);
    await expect(sidebarChip(window, 'alpha')).toHaveClass(/tag-pill-active/);
    await expect(sidebarChip(window, 'beta')).toHaveClass(/tag-pill-active/);

    await window.locator('.search-clear-btn').click();
  });

  test('clicking a lit chip removes just that filter', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await sidebarChip(window, 'alpha').click();
    await sidebarChip(window, 'beta').click();
    await expect(window.locator('.search-input')).toHaveValue('tag=alpha tag=beta');

    // Take beta off: alpha stays applied, and both of its songs come back.
    await sidebarChip(window, 'beta').click();
    await expect(window.locator('.search-input')).toHaveValue('tag=alpha');
    await expect(window.locator('.qa-search-song')).toHaveCount(2);
    await expect(sidebarChip(window, 'beta')).not.toHaveClass(/tag-pill-active/);

    // Taking the last one off leaves the search entirely.
    await sidebarChip(window, 'alpha').click();
    await expect(window.locator('.search-input')).toHaveValue('');
    await expect(window.locator('#explorerTree')).toBeVisible();
  });
});
