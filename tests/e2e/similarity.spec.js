const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * "Songs like this one", end to end: right-click a song, get a ranked list.
 *
 * The embeddings here are written straight into the database rather than
 * produced by the analyzer. Running the real model would add a couple of minutes
 * and prove something analysis.spec.js already proves; what this test is for is
 * the wiring above it -- context menu, IPC, ranking, and the view that renders
 * the result. Hand-built vectors also mean the expected order is known exactly,
 * which a real model's output never would be.
 *
 * The geometry matches tests/unit/similarity.test.js: three orthogonal blocks of
 * dimensions, a large constant added to every dimension (which mean-centering
 * has to remove), and a final balancing song that puts the library mean at zero
 * so each song's cosine to the seed is exactly the number it was built with.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

const EMBEDDING_DIMS = 200;
const BLOCK = 50;
const BLOCK_SCALE = 1 / Math.sqrt(BLOCK);
const COMMON = 8;

// One page of results is 25, so 28 rankable songs leaves exactly 3 for the
// "show more" button to fetch.
const RANKED_COUNT = 28;
const TOP_SIMILARITY = 0.97;
const SIMILARITY_STEP = 0.015;

/** A unit vector with the given (E0, E1, E2) coordinates, plus the common offset. */
function embedding([e0, e1, e2]) {
  const values = new Array(EMBEDDING_DIMS).fill(COMMON);
  for (let d = 0; d < BLOCK; d++) {
    values[d] += e0 * BLOCK_SCALE;
    values[BLOCK + d] += e1 * BLOCK_SCALE;
    values[2 * BLOCK + d] += e2 * BLOCK_SCALE;
  }
  return values;
}

/**
 * The fixture library, in the order it gets imported: the seed, an exact second
 * copy of it, 28 songs at known descending similarity, and a balancing song.
 */
function libraryCoords() {
  const coords = [[1, 0, 0], [1, 0, 0]];
  for (let i = 0; i < RANKED_COUNT; i++) {
    const cosine = TOP_SIMILARITY - i * SIMILARITY_STEP;
    coords.push([cosine, Math.sqrt(1 - cosine ** 2), 0]);
  }
  const total = coords.reduce(
    (sum, c) => [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]],
    [0, 0, 0]
  );
  coords.push(total.map(v => -v));
  return coords;
}

/** Copy the fixture audio under `count` unique names so each import is a new song. */
function makeAudioCopies(count, prefix) {
  const dir = path.join(os.tmpdir(), `ludi-similarity-${prefix}-${Date.now()}`);
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

/** Write embeddings directly, standing in for an analysis pass. */
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

/**
 * Delete the fixture songs without routing through the Trash -- 31 recoverable
 * files per test run is not a kindness. Removing the songs also removes their
 * analysis rows, which matters: leaving them behind would make every later
 * spec's import trigger a real analysis pass.
 */
async function deleteFixtureSongs(electronApp, itemIds) {
  await electronApp.evaluate(async (unused, { modulePath, ids }) => {
    const fsModule = process.mainModule.require('fs');
    const db = process.mainModule.require(modulePath);
    for (const itemId of ids) {
      for (const filePath of db.deleteItemWithFiles(itemId)) {
        fsModule.rmSync(filePath, { force: true });
      }
    }
  }, { modulePath: DATABASE_MODULE, ids: itemIds });
}

async function importFiles(window, filePaths) {
  return window.evaluate(
    (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }),
    filePaths
  );
}

/** Select a song row, right-click it, and choose "find similar" from the menu. */
async function findSimilarFrom(window, songId) {
  const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
  await expect(row).toBeVisible({ timeout: 3000 });
  await row.click();
  await row.click({ button: 'right' });
  await window.locator('.qa-find-similar').click();
  await expect(window.locator('.qa-similar-view')).toBeVisible({ timeout: 3000 });
}

const resultSongIds = (window) =>
  window.locator('.qa-similar-view .tree-item-content').evaluateAll(
    (rows) => rows.map((row) => Number(row.dataset.songId))
  );

test.describe('Similar songs', () => {
  test.describe.configure({ timeout: 90000 });

  let cleanupItemIds = [];
  let tempDirs = [];

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { electronApp } = await setupElectronApp();
    await deleteFixtureSongs(electronApp, cleanupItemIds);
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  // Runs first on purpose: an import only triggers a background analysis pass
  // once the library has been analyzed at least once, and this test needs a
  // song that stays unanalyzed.
  test('says the song has not been analyzed instead of showing an empty list', async ({ window }) => {
    const [file] = makeAudioCopies(1, 'unanalyzed');
    tempDirs.push(path.dirname(file));

    const imported = await importFiles(window, [file]);
    expect(imported.errors).toEqual([]);
    cleanupItemIds.push(...imported.itemIds);

    await window.locator('.playlist-item').first().click();
    await findSimilarFrom(window, imported.imported[0].songId);

    await expect(window.locator('.qa-similar-notice')).toContainText('has not been analyzed');
    await expect(window.locator('.qa-similar-view .tree-item-content')).toHaveCount(0);
    await window.locator('.qa-exit-similar').click();
  });

  test('ranks the library by similarity, best match first, hiding a duplicate', async ({ window, electronApp }) => {
    const coords = libraryCoords();
    const files = makeAudioCopies(coords.length, 'ranked');
    tempDirs.push(path.dirname(files[0]));

    const imported = await importFiles(window, files);
    expect(imported.errors).toEqual([]);
    expect(imported.imported).toHaveLength(coords.length);
    cleanupItemIds.push(...imported.itemIds);

    const songIds = imported.imported.map((entry) => entry.songId);
    await seedEmbeddings(electronApp, songIds.map((songId, i) => ({
      songId,
      embedding: embedding(coords[i]),
    })));

    // The balancing song is imported last and never ranks, so it is not part of
    // the expected order.
    const [seedId, duplicateId] = songIds;
    const rankedIds = songIds.slice(2, 2 + RANKED_COUNT);

    await window.locator('.playlist-item').first().click();
    await findSimilarFrom(window, seedId);

    // 28 songs clear the quality floor; the exact copy of the seed is not one of
    // them, and neither is the balancing song pointing away from everything.
    await expect(window.locator('.qa-similar-title')).toContainText(`(${RANKED_COUNT})`);

    const firstPage = await resultSongIds(window);
    expect(firstPage).toHaveLength(25);
    expect(firstPage).toEqual(rankedIds.slice(0, 25));
    expect(firstPage).not.toContain(seedId);
    expect(firstPage).not.toContain(duplicateId);

    // Similarity is shown per row, rounded, so 0.97 reads as 97%.
    const badges = window.locator('.qa-similar-view .qa-similarity');
    await expect(badges.first()).toHaveText('97%');
    await expect(badges.nth(1)).toHaveText('96%');

    // "Show more" continues the same ranking rather than re-querying.
    const showMore = window.locator('.qa-similar-show-more');
    await expect(showMore).toHaveText('Show 3 more');
    await showMore.click();
    await expect(window.locator('.qa-similar-view .tree-item-content')).toHaveCount(RANKED_COUNT);
    expect(await resultSongIds(window)).toEqual(rankedIds);
    await expect(showMore).toHaveCount(0);
  });

  test('seeds from the whole selection when several songs are picked', async ({ window }) => {
    // Reuses the library the previous test built and seeded.
    await window.locator('.qa-exit-similar').click();
    await window.locator('.playlist-item').first().click();

    const songIds = (await resultSongIdsFromTree(window)).slice(0, 2);
    const [first, second] = songIds;

    await window.locator(`.tree-item-content[data-song-id="${first}"]`).click();
    await window.locator(`.tree-item-content[data-song-id="${second}"]`).click({
      modifiers: ['Meta'],
    });

    const secondRow = window.locator(`.tree-item-content[data-song-id="${second}"]`);
    await secondRow.click({ button: 'right' });

    // The label states which songs it will use, so the result is never a surprise.
    await expect(window.locator('.qa-find-similar')).toHaveText('Find songs like these 2');
    await window.locator('.qa-find-similar').click();

    await expect(window.locator('.qa-similar-title')).toContainText('Songs like 2 selected songs');
    const results = await resultSongIds(window);
    expect(results.length).toBeGreaterThan(0);
    expect(results).not.toContain(first);
    expect(results).not.toContain(second);
    await window.locator('.qa-exit-similar').click();
  });
});

/** Song ids of the rows currently rendered in the library tree, in view order. */
const resultSongIdsFromTree = (window) =>
  window.locator('#explorerTree .tree-item-content[data-song-id]').evaluateAll(
    (rows) => rows.map((row) => Number(row.dataset.songId))
  );
