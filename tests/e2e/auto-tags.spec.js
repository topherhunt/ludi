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
 * assignment, and where the analyzer's tags are (and aren't) shown.
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

// Pills as [name, hasGear] pairs. Read without auto-waiting, so poll them.
const pillsIn = (locator) => locator.evaluateAll((pills) => pills.map((pill) => [
  pill.dataset.tagName,
  pill.querySelector('.qa-tag-auto') !== null,
]));
const rowPills = (window, songId) =>
  pillsIn(window.locator(`.tree-item-content[data-song-id="${songId}"] .col-tags .tag-pill`));
const panelPills = (window) => pillsIn(window.locator('.qa-tag-editor-pills .tag-pill'));
const sidebarChip = (window, name) => window.locator(`.qa-tags-section .tag-pill[data-tag-name="${name}"]`);

async function selectSong(window, songId) {
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  await window.locator(`.tree-item-content[data-song-id="${songId}"]`).click();
  await expect(window.locator('.qa-song-edit-panel')).toBeVisible();
}

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

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => localStorage.removeItem('ludi-show-ai-tags'));
  });

  test('tags only the songs that stand out, and keeps them off song rows', async ({ window }) => {
    const result = await window.evaluate(() => window.electronAPI.recalculateAutoTags());
    expect(result.skipped).toBeUndefined();
    expect(result.songs).toBeGreaterThanOrEqual(LIBRARY_SIZE);
    expect(result.assignments).toBe(3);

    await selectSong(window, songIds[0]);
    for (const songId of songIds) expect(await rowPills(window, songId)).toEqual([]);

    // The panel hides them too until asked, then marks each with the gear.
    expect(await panelPills(window)).toEqual([]);
    const toggle = window.locator('.qa-song-edit-panel .qa-toggle-ai-tags');
    await toggle.click();
    await expect.poll(() => panelPills(window)).toEqual(expect.arrayContaining([['jazz', true], ['acoustic', true]]));
    await expect(toggle).toHaveText('Hide AI tags');

    await selectSong(window, songIds[1]);
    await expect.poll(() => panelPills(window)).toEqual([['instrumental', true]]);
    // A song the analyzer left alone has no AI tags to show, so no link.
    await selectSong(window, songIds[2]);
    await expect(window.locator('.qa-song-edit-panel .qa-toggle-ai-tags')).toHaveCount(0);
    await selectSong(window, songIds[0]);
    await toggle.click();
  });

  test('a hand-applied tag shows on the row and in the panel, without a gear', async ({ window }) => {
    await selectSong(window, songIds[0]);
    const input = window.locator('.qa-tag-input');
    await input.click();
    await input.fill('favourite');
    await window.locator('.qa-tag-create').click();

    await expect.poll(() => rowPills(window, songIds[0])).toEqual([['favourite', false]]);
    await expect.poll(() => panelPills(window)).toEqual([['favourite', false]]);
  });

  test('the sidebar lists your tags with hand-tagged counts until AI tags are shown', async ({ window }) => {
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await expect(sidebarChip(window, 'favourite').locator('.qa-tag-count')).toHaveText('1');
    await expect(sidebarChip(window, 'jazz')).toHaveCount(0);

    const toggle = window.locator('.qa-tags-section .qa-toggle-ai-tags');
    await toggle.click();
    await expect(sidebarChip(window, 'jazz').locator('.qa-tag-auto')).toHaveCount(1);
    await expect(sidebarChip(window, 'favourite').locator('.qa-tag-auto')).toHaveCount(0);
    expect(await window.evaluate(() => localStorage.getItem('ludi-show-ai-tags'))).toBe('true');

    await toggle.click();
    await expect(sidebarChip(window, 'jazz')).toHaveCount(0);
  });

  test('suggestions offer only your tags; typing an AI tag\'s name applies it by hand', async ({ window }) => {
    await selectSong(window, songIds[1]);
    const input = window.locator('.qa-tag-input');
    await input.click();
    const options = window.locator('.qa-tag-option');
    await expect(options.filter({ hasText: 'favourite' })).toHaveCount(1);
    await expect(options.filter({ hasText: 'jazz' })).toHaveCount(0);

    await input.fill('jazz');
    await expect(options).toHaveText(['jazz']);
    await expect(window.locator('.qa-tag-create')).toHaveCount(0);
    await input.press('Enter');

    await expect.poll(() => rowPills(window, songIds[1])).toEqual([['jazz', false]]);
    const jazzTags = await window.evaluate(async () =>
      (await window.electronAPI.getAllTags()).filter((tag) => tag.name === 'jazz').length);
    expect(jazzTags).toBe(1);
    // Now yours, but only song 1 carries it by hand: song 0's is still the analyzer's.
    await expect(sidebarChip(window, 'jazz').locator('.qa-tag-count')).toHaveText('1');
    await expect(sidebarChip(window, 'jazz').locator('.qa-tag-auto')).toHaveCount(0);
    await selectSong(window, songIds[0]);
    await expect.poll(() => panelPills(window)).toEqual([['favourite', false]]);
  });

  test('re-running the analysis leaves hand-applied tags alone', async ({ window }) => {
    await window.evaluate(() => window.electronAPI.recalculateAutoTags());
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();

    await expect.poll(() => rowPills(window, songIds[0])).toEqual([['favourite', false]]);
    await expect.poll(() => rowPills(window, songIds[1])).toEqual([['jazz', false]]);
  });

  test('the edit panel finds songs like the ones being edited', async ({ window }) => {
    await selectSong(window, songIds[2]);
    const title = await window.locator(`.tree-item-content[data-song-id="${songIds[2]}"] .tree-item-label`).textContent();
    await window.locator('.qa-panel-find-similar').click();
    await expect(window.locator('.qa-similar-title')).toContainText(title);
    await window.locator('.qa-exit-similar').click();
  });
});
