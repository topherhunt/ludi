const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Auto tags, end to end: analysis scores in, tag pills on song rows out.
 *
 * As in similarity.spec.js the analyses are written straight to the database
 * rather than produced by the model -- running it for real would take minutes
 * and prove something analysis.spec.js already proves. What this covers is
 * everything above it: calibration against a whole library, tag creation,
 * assignment, and the gear that marks a machine-made tag in the UI.
 *
 * The library is deliberately flat (every song scoring the same on everything)
 * with two songs pushed out on one label each, so the expected tags are known.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');
const ACTIVATION_DIMS = 50;
const EMBEDDING_DIMS = 200;
const BASELINE = 0.1;

// The tagger refuses to calibrate below 20 analyzed songs, so the fixture
// library has to clear that bar.
const LIBRARY_SIZE = 20;

const MSD_CLASSES = require('../../src/shared/audio-model.json').msdClasses;

/** Flat axes: every head at 0.5 and the mood softmax at chance, so none fire. */
function flatAxes() {
  return {
    danceability: 0.5, acoustic: 0.5, aggressive: 0.5, electronic: 0.5,
    happy: 0.5, party: 0.5, relaxed: 0.5, sad: 0.5, tonal: 0.5,
    vocal: 0.5, valence: 0.5, arousal: 0.5,
    mirex: [0.2, 0.2, 0.2, 0.2, 0.2],
  };
}

/** Activation scores: BASELINE on all 50 labels, with the named ones raised. */
function activations(overrides) {
  const values = new Array(ACTIVATION_DIMS).fill(BASELINE);
  for (const [className, score] of Object.entries(overrides)) {
    const column = MSD_CLASSES.indexOf(className);
    if (column === -1) throw new Error(`unknown MSD class: ${className}`);
    values[column] = score;
  }
  return values;
}

function makeAudioCopies(count, prefix) {
  const dir = path.join(os.tmpdir(), `ludi-autotags-${prefix}-${Date.now()}`);
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
async function seedAnalyses(electronApp, records) {
  await electronApp.evaluate(async (unused, { modulePath, rows }) => {
    const db = process.mainModule.require(modulePath);
    for (const row of rows) {
      db.saveAnalysis(row.songId, {
        modelVersion: 'test-fixture',
        embedding: Buffer.from(new Float32Array(row.embedding).buffer),
        activations: Buffer.from(new Float32Array(row.activations).buffer),
        axes: row.axes,
      });
    }
  }, { modulePath: DATABASE_MODULE, rows: records });
}

/** Delete fixture songs without filling the user's Trash with 20 test tones. */
async function deleteFixtureSongs(electronApp, itemIds) {
  await electronApp.evaluate(async (unused, { modulePath, ids }) => {
    const fsModule = process.mainModule.require('fs');
    const db = process.mainModule.require(modulePath);
    db.clearAutoTags();
    for (const itemId of ids) {
      for (const filePath of db.deleteItemWithFiles(itemId)) {
        fsModule.rmSync(filePath, { force: true });
      }
    }
  }, { modulePath: DATABASE_MODULE, ids: itemIds });
}

/** The pills on one song's row, as [name, isAuto] pairs. */
const pillsOnRow = (window, songId) =>
  window.locator(`.tree-item-content[data-song-id="${songId}"] .col-tags .tag-pill`)
    .evaluateAll((pills) => pills.map((pill) => [
      pill.dataset.tagName,
      pill.querySelector('.qa-tag-auto') !== null,
    ]));

test.describe('Auto tags', () => {
  test.describe.configure({ timeout: 90000 });

  let itemIds = [];
  let songIds = [];
  let tempDir = null;

  test.beforeAll(async ({ window, electronApp }) => {
    const files = makeAudioCopies(LIBRARY_SIZE, 'lib');
    tempDir = path.dirname(files[0]);

    const imported = await window.evaluate(
      (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }),
      files
    );
    expect(imported.errors).toEqual([]);
    itemIds = imported.itemIds;
    songIds = imported.imported.map((entry) => entry.songId);

    // Song 0 is the library's jazz record and its one acoustic recording; song 1
    // is its only instrumental. Everything else is deliberately unremarkable.
    const standouts = {
      0: { activations: { jazz: 0.4 }, axes: { acoustic: 0.95 } },
      1: { activations: {}, axes: { vocal: 0.05 } },
    };
    await seedAnalyses(electronApp, songIds.map((songId, i) => ({
      songId,
      embedding: new Array(EMBEDDING_DIMS).fill(0.1),
      activations: activations(standouts[i] ? standouts[i].activations : {}),
      axes: { ...flatAxes(), ...(standouts[i] ? standouts[i].axes : {}) },
    })));
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { electronApp } = await setupElectronApp();
    await deleteFixtureSongs(electronApp, itemIds);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('tags only the songs that stand out, and marks each tag as machine-made', async ({ window }) => {
    const result = await window.evaluate(() => window.electronAPI.recalculateAutoTags());
    expect(result.skipped).toBeUndefined();
    expect(result.songs).toBeGreaterThanOrEqual(LIBRARY_SIZE);
    expect(result.assignments).toBe(3);

    await window.locator('.playlist-item').first().click();
    await expect(window.locator(`.tree-item-content[data-song-id="${songIds[0]}"]`)).toBeVisible();

    // Every pill the analyzer put there carries the gear.
    expect(await pillsOnRow(window, songIds[0])).toEqual(
      expect.arrayContaining([['jazz', true], ['acoustic', true]])
    );
    expect(await pillsOnRow(window, songIds[1])).toEqual([['instrumental', true]]);

    // The other 18 are indistinguishable from each other, so they get nothing.
    for (const songId of songIds.slice(2)) {
      expect(await pillsOnRow(window, songId)).toEqual([]);
    }
  });

  test('leaves a hand-applied tag on the same song unmarked', async ({ window }) => {
    await window.locator('.playlist-item').first().click();
    const row = window.locator(`.tree-item-content[data-song-id="${songIds[0]}"]`);
    await row.click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

    const input = window.locator('.qa-tag-input');
    await input.click();
    await input.fill('favourite');
    await window.locator('.qa-tag-create').click();

    const pills = window.locator(`.tree-item-content[data-song-id="${songIds[0]}"] .col-tags .tag-pill`);
    await expect(pills.filter({ hasText: 'favourite' })).toHaveCount(1);

    // The gear says "a machine made this tag", so it must not appear on a tag
    // the user typed -- otherwise it means nothing.
    expect(await pillsOnRow(window, songIds[0])).toEqual(
      expect.arrayContaining([['jazz', true], ['acoustic', true], ['favourite', false]])
    );
  });

  test('re-running the analysis leaves hand-applied tags alone', async ({ window }) => {
    await window.evaluate(() => window.electronAPI.recalculateAutoTags());
    await window.locator('.playlist-item').first().click();

    const pills = await pillsOnRow(window, songIds[0]);
    expect(pills).toContainEqual(['favourite', false]);
    expect(pills).toContainEqual(['jazz', true]);
  });
});
