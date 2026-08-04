const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Auto-grouping (k-means clusters), end to end: regroup the library, browse a
 * group, rename it, freeze it into a playlist.
 *
 * As in similarity.spec.js the embeddings are written straight to the database
 * instead of being produced by the model -- running it for real would add
 * minutes and prove something analysis.spec.js already proves. Hand-built
 * vectors also mean the expected grouping is known exactly, which a real
 * model's output never would be.
 *
 * The fixture library is three blocks of dimensions that don't overlap, five
 * songs each: the only correct answer is three groups of five.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

const EMBEDDING_DIMS = 200;
const GROUPS = 3;
const PER_GROUP = 5;
const BLOCK = 60;

const PLAYLIST_NAME = 'Frozen Group';
const RENAMED = 'Late Night Blocks';

/**
 * A vector pointing along one block of dimensions, with a per-song nudge so no
 * two songs are identical (k-means++ picks distinct seeds more happily).
 */
function embedding(group, member) {
  const values = new Array(EMBEDDING_DIMS).fill(0);
  for (let d = 0; d < BLOCK; d++) values[group * BLOCK + d] = 1;
  values[group * BLOCK + member] += 0.05;
  return values;
}

function makeAudioCopies(count, prefix) {
  const dir = path.join(os.tmpdir(), `ludi-clusters-${prefix}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (unused, i) => {
    const file = path.join(dir, `${prefix}-${String(i).padStart(2, '0')}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, file);
    return file;
  });
}

// electronApp.evaluate runs in the main process but without a `require` of its
// own; process.mainModule.require resolves against main.js, so it hands back the
// very same module instances the running app is using.
async function seedEmbeddings(electronApp, records) {
  await electronApp.evaluate(async (unused, { modulePath, rows }) => {
    const db = process.mainModule.require(modulePath);
    for (const row of rows) {
      db.saveAnalysis(row.songId, {
        modelVersion: 'test-fixture',
        embedding: Buffer.from(new Float32Array(row.embedding).buffer),
        activations: Buffer.from(new Float32Array(50).buffer),
        axes: {},
      });
    }
  }, { modulePath: DATABASE_MODULE, rows: records });
}

/** The cluster each fixture song was assigned to, straight from the database. */
async function clusterIdsOf(electronApp, songIds) {
  return electronApp.evaluate((unused, { modulePath, ids }) => {
    const db = process.mainModule.require(modulePath);
    return ids.map((songId) => db.getAnalysis(songId).cluster_id);
  }, { modulePath: DATABASE_MODULE, ids: songIds });
}

/**
 * Drop the fixture songs, the playlist made from one of them and the cluster
 * rows, so later specs see the library they expect. Deleting the songs also
 * drops their analysis rows, which matters: leaving them would make every later
 * import trigger a real analysis pass.
 */
async function cleanUp(electronApp, itemIds, playlistName) {
  await electronApp.evaluate(async (unused, { modulePath, ids, listTitle }) => {
    const fsModule = process.mainModule.require('fs');
    const db = process.mainModule.require(modulePath);
    const playlist = db.getLists().find((list) => list.title === listTitle);
    if (playlist) db.deletePlaylist(playlist.id);
    for (const itemId of ids) {
      for (const filePath of db.deleteItemWithFiles(itemId)) {
        fsModule.rmSync(filePath, { force: true });
      }
    }
    db.replaceClusters([]);
  }, { modulePath: DATABASE_MODULE, ids: itemIds, listTitle: playlistName });
}

const clusterRow = (window, clusterId) =>
  window.locator(`.qa-cluster-item[data-cluster-id="${clusterId}"]`);

const viewedSongIds = (window) =>
  window.locator('.qa-cluster-view .tree-item-content').evaluateAll(
    (rows) => rows.map((row) => Number(row.dataset.songId))
  );

/** Dismiss the "Library Grouped" / "Playlist Created" acknowledgement. */
async function dismissAlert(window) {
  const ok = window.locator('.modal-overlay.visible .modal-btn', { hasText: 'OK' });
  await expect(ok).toBeVisible();
  await ok.click();
  await expect(window.locator('.modal-overlay.visible')).toHaveCount(0);
}

test.describe('Song groups', () => {
  test.describe.configure({ timeout: 90000 });

  let itemIds = [];
  let songIds = [];
  let tempDir = null;
  // Filled in by the first test: which cluster the app put each planted group in.
  let clusterOfGroup = [];

  const groupSongIds = (group) => songIds.slice(group * PER_GROUP, (group + 1) * PER_GROUP);

  test.beforeAll(async ({ window, electronApp }) => {
    const files = makeAudioCopies(GROUPS * PER_GROUP, 'grp');
    tempDir = path.dirname(files[0]);

    const imported = await window.evaluate(
      (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }),
      files
    );
    expect(imported.errors).toEqual([]);
    itemIds = imported.itemIds;
    songIds = imported.imported.map((entry) => entry.songId);

    await seedEmbeddings(electronApp, songIds.map((songId, i) => ({
      songId,
      embedding: embedding(Math.floor(i / PER_GROUP), i % PER_GROUP),
    })));
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { electronApp } = await setupElectronApp();
    await cleanUp(electronApp, itemIds, PLAYLIST_NAME);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('keeps songs that sound alike together and songs that do not apart', async ({ window, electronApp }) => {
    await window.locator('.qa-recluster').click();
    await dismissAlert(window);

    const assigned = await clusterIdsOf(electronApp, songIds);
    clusterOfGroup = Array.from({ length: GROUPS }, (unused, group) => {
      const ids = new Set(assigned.slice(group * PER_GROUP, (group + 1) * PER_GROUP));
      expect(Array.from(ids)).toHaveLength(1); // the five never got split
      return Array.from(ids)[0];
    });

    // Three blocks that share no dimensions must not land in one group.
    expect(new Set(clusterOfGroup).size).toBe(GROUPS);
  });

  test('lists each group in the sidebar with the number of songs in it', async ({ window }) => {
    for (const clusterId of clusterOfGroup) {
      const row = clusterRow(window, clusterId);
      await expect(row).toBeVisible();
      await expect(row.locator('.qa-cluster-size')).toHaveText(String(PER_GROUP));
    }
  });

  test('clicking a group shows exactly the songs in it', async ({ window }) => {
    await clusterRow(window, clusterOfGroup[1]).click();

    await expect(window.locator('.qa-cluster-view')).toBeVisible();
    expect((await viewedSongIds(window)).sort()).toEqual(groupSongIds(1).sort());
    await expect(window.locator('.qa-cluster-title')).toContainText(`(${PER_GROUP})`);
  });

  test('renaming a group renames it in the sidebar and in the header', async ({ window }) => {
    const row = clusterRow(window, clusterOfGroup[1]);
    await row.click({ button: 'right' });
    await window.locator('.qa-cluster-rename').click();
    await window.fill('#renameInput', RENAMED);
    await window.click('#renameOkBtn');

    await expect(row).toContainText(RENAMED);
    await expect(window.locator('.qa-cluster-title')).toHaveText(`${RENAMED} (${PER_GROUP})`);
    expect((await viewedSongIds(window)).sort()).toEqual(groupSongIds(1).sort());
  });

  test('saving a group as a playlist puts its songs in a real playlist', async ({ window }) => {
    await window.locator('.qa-cluster-save-playlist').click();
    await expect(window.locator('#renameInput')).toHaveValue(RENAMED);
    await window.fill('#renameInput', PLAYLIST_NAME);
    await window.click('#renameOkBtn');
    await dismissAlert(window);

    const playlist = window.locator('.qa-playlist-item', { hasText: PLAYLIST_NAME });
    await expect(playlist).toHaveCount(1);

    // Opening it leaves the group view and shows the same five songs.
    await playlist.click();
    await expect(window.locator('.qa-cluster-view')).toHaveCount(0);
    const rows = window.locator('#explorerTree .tree-item-content');
    await expect(rows).toHaveCount(PER_GROUP);
    expect((await rows.evaluateAll((els) => els.map((el) => Number(el.dataset.songId)))).sort())
      .toEqual(groupSongIds(1).sort());
  });
});
