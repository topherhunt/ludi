const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The music map, end to end: build it, hover it, play from it, lasso part of it.
 *
 * As in clusters.spec.js the embeddings are written straight to the database
 * rather than produced by the model -- analysis.spec.js is what proves the model
 * works, and hand-built vectors mean the map has a shape we know in advance.
 *
 * The map is a canvas, so there is nothing to click by selector. Every
 * interaction here turns a song's world coordinates into a pixel using the same
 * arithmetic the view uses, which is exactly what a user's mouse does.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

const EMBEDDING_DIMS = 200;
const GROUPS = 3;
const PER_GROUP = 5;
const LIBRARY_SIZE = GROUPS * PER_GROUP;
const BLOCK = 60;

// Mirrors MAP_EXTENT in src/main/map-projection.js: the map's world is [-1, 1].
const MAP_EXTENT = 1;

const PLAYLIST_NAME = 'Lassoed Songs';

function embedding(group, member) {
  const values = new Array(EMBEDDING_DIMS).fill(0);
  for (let d = 0; d < BLOCK; d++) values[group * BLOCK + d] = 1;
  values[group * BLOCK + member] += 0.05;
  return values;
}

function makeAudioCopies(count, prefix) {
  const dir = path.join(os.tmpdir(), `ludi-map-${prefix}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (unused, i) => {
    const file = path.join(dir, `${prefix}-${String(i).padStart(2, '0')}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, file);
    return file;
  });
}

/**
 * Seed the analysis rows, and give every fixture song its own title -- the
 * copies all carry the same embedded metadata, and a tooltip test proves nothing
 * if every song is called the same thing.
 */
async function seedLibrary(electronApp, records) {
  await electronApp.evaluate(async (unused, { modulePath, rows }) => {
    const db = process.mainModule.require(modulePath);
    for (const row of rows) {
      db.updateSong(row.songId, { title: row.title });
      db.saveAnalysis(row.songId, {
        modelVersion: 'test-fixture',
        embedding: Buffer.from(new Float32Array(row.embedding).buffer),
        activations: Buffer.from(new Float32Array(50).buffer),
        axes: {},
      });
    }
  }, { modulePath: DATABASE_MODULE, rows: records });
}

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
  }, { modulePath: DATABASE_MODULE, ids: itemIds, listTitle: playlistName });
}

const mapPoints = (window) => window.evaluate(() => window.electronAPI.getMapPoints());

/** Where every dot sits on screen at the map's starting view. */
async function dotPositions(window, points) {
  const box = await window.locator('.qa-map-canvas').boundingBox();
  const scale = Math.min(box.width, box.height) / 2 / MAP_EXTENT;
  return points.map((point) => ({
    point,
    x: box.x + box.width / 2 + point.x * scale,
    y: box.y + box.height / 2 - point.y * scale,
  }));
}

/**
 * The dot with the most empty space around it. A test that means to point at one
 * song has to point at one that isn't sitting exactly on top of another.
 */
function loneliestDot(dots) {
  const nearestDistance = (dot) => Math.min(...dots
    .filter(other => other.point.songId !== dot.point.songId)
    .map(other => Math.hypot(other.x - dot.x, other.y - dot.y)));
  return dots.reduce((best, dot) => (nearestDistance(dot) > nearestDistance(best) ? dot : best), dots[0]);
}

/** Dismiss a "Map Built" / "Playlist Created" acknowledgement. */
async function dismissAlert(window) {
  const ok = window.locator('.modal-overlay.visible .modal-btn', { hasText: 'OK' });
  await expect(ok).toBeVisible();
  await ok.click();
  await expect(window.locator('.modal-overlay.visible')).toHaveCount(0);
}

test.describe('Music map', () => {
  test.describe.configure({ timeout: 90000 });

  let itemIds = [];
  let songIds = [];
  let tempDir = null;
  // Filled in by the lasso test: the songs the lasso should have caught.
  let lassoedSongIds = [];

  test.beforeAll(async ({ window, electronApp }) => {
    const files = makeAudioCopies(LIBRARY_SIZE, 'pt');
    tempDir = path.dirname(files[0]);

    const imported = await window.evaluate(
      (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }),
      files
    );
    expect(imported.errors).toEqual([]);
    itemIds = imported.itemIds;
    songIds = imported.imported.map((entry) => entry.songId);

    await seedLibrary(electronApp, songIds.map((songId, i) => ({
      songId,
      title: `Map Point ${String(i).padStart(2, '0')}`,
      embedding: embedding(Math.floor(i / PER_GROUP), i % PER_GROUP),
    })));
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { electronApp } = await setupElectronApp();
    await cleanUp(electronApp, itemIds, PLAYLIST_NAME);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('offers to build the map when the library has never been mapped', async ({ window }) => {
    await window.locator('.qa-open-map').click();

    await expect(window.locator('.qa-map-view')).toBeVisible();
    await expect(window.locator('.qa-map-title')).toContainText('Music Map');
    await expect(window.locator('.qa-map-empty')).toBeVisible();
    await expect(window.locator('.qa-map-count')).toHaveText('0 songs');
  });

  test('building the map places every analyzed song on it', async ({ window }) => {
    await window.locator('.qa-map-build').click();
    await dismissAlert(window);

    await expect(window.locator('.qa-map-empty')).toHaveCount(0);
    const { points } = await mapPoints(window);
    expect(points.length).toBeGreaterThanOrEqual(LIBRARY_SIZE);
    expect(points.map(point => point.songId)).toEqual(expect.arrayContaining(songIds));
    await expect(window.locator('.qa-map-count')).toHaveText(`${points.length} songs`);
  });

  test('hovering a dot names the song it stands for', async ({ window }) => {
    const { points } = await mapPoints(window);
    const target = loneliestDot(await dotPositions(window, points));

    await window.mouse.move(target.x, target.y);

    await expect(window.locator('.qa-map-tooltip')).toContainText(target.point.title);
  });

  test('double-clicking a dot plays that song, then the nearest one', async ({ window }) => {
    const { points } = await mapPoints(window);
    const target = loneliestDot(await dotPositions(window, points));
    const distance = (point) => Math.hypot(point.x - target.point.x, point.y - target.point.y);
    const others = points.filter((point) => point.songId !== target.point.songId);
    const nearest = Math.min(...others.map(distance));
    const nearestTitles = others.filter((point) => distance(point) - nearest < 1e-9).map((point) => point.title);

    await window.mouse.dblclick(target.x, target.y);

    const playPauseBtn = window.locator('#playPauseBtn');
    const nowPlaying = window.locator('.player-info .song-title');
    await expect(playPauseBtn).toHaveClass(/playing/);
    await expect(nowPlaying).toHaveText(target.point.title);
    await window.locator('#nextBtn').click();
    await expect(nowPlaying).not.toHaveText(target.point.title);
    expect(nearestTitles).toContain(await nowPlaying.textContent());
    await playPauseBtn.click();
  });

  test('right-clicking a dot offers the song menu for it', async ({ window }) => {
    const { points } = await mapPoints(window);
    const target = loneliestDot(await dotPositions(window, points));

    await window.mouse.click(target.x, target.y, { button: 'right' });

    await expect(window.locator('.qa-find-similar')).toBeVisible();
    await expect(window.locator('.qa-add-folder-after')).toHaveClass(/disabled/);
    await window.locator('.qa-find-similar').click();
    await expect(window.locator('.qa-similar-title')).toHaveText(new RegExp(`^Songs like "${target.point.title}"`));
    await window.locator('.qa-nav-back').click();
    await expect(window.locator('.qa-map-view')).toBeVisible();
  });

  test('shift-dragging a lasso selects the songs inside it and leaves the rest', async ({ window }) => {
    const box = await window.locator('.qa-map-canvas').boundingBox();
    const { points } = await mapPoints(window);
    const dots = await dotPositions(window, points);

    // Split the map down the widest vertical gap between dots, so no dot sits
    // near the boundary and the expected answer can't come down to rounding.
    const xs = [...new Set(dots.map(dot => dot.x))].sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => ({ mid: (x + xs[i]) / 2, width: x - xs[i] }));
    const splitX = gaps.reduce((widest, gap) => (gap.width > widest.width ? gap : widest)).mid;

    const expected = dots.filter(dot => dot.x < splitX);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(dots.length);
    lassoedSongIds = expected.map(dot => dot.point.songId).sort();

    // Everything left of splitX. The drag starts inside the canvas and the rest
    // of the path runs outside it, which the pointer capture keeps delivering --
    // that way the lasso's only real edge is the split, and dots sitting exactly
    // on the canvas border are still enclosed.
    await window.keyboard.down('Shift');
    await window.mouse.move(splitX, box.y + 1);
    await window.mouse.down();
    await window.mouse.move(splitX, box.y + box.height + 40);
    await window.mouse.move(box.x - 40, box.y + box.height + 40);
    await window.mouse.move(box.x - 40, box.y - 40);
    await window.mouse.move(splitX, box.y - 40);
    await window.mouse.up();
    await window.keyboard.up('Shift');

    await expect(window.locator('.qa-map-selection')).toHaveText(`${expected.length} selected`);
  });

  test('a lasso selection can be saved as a playlist', async ({ window }) => {
    await window.locator('.qa-map-save-selection').click();
    await window.fill('#renameInput', PLAYLIST_NAME);
    await window.click('#renameOkBtn');
    await dismissAlert(window);

    const playlist = window.locator('.qa-playlist-item', { hasText: PLAYLIST_NAME });
    await expect(playlist).toHaveCount(1);

    // Opening it leaves the map and shows exactly the songs the lasso caught.
    await playlist.click();
    await expect(window.locator('.qa-map-view')).toHaveCount(0);
    const rows = window.locator('#explorerTree .tree-item-content');
    await expect(rows).toHaveCount(lassoedSongIds.length);
    expect((await rows.evaluateAll((els) => els.map((el) => Number(el.dataset.songId)))).sort())
      .toEqual(lassoedSongIds);
  });

  test('scrolling zooms the map in, and never back out past a full view', async ({ window }) => {
    await window.locator('.qa-open-map').click();
    const wrap = window.locator('.map-canvas-wrap');
    await expect(wrap).toHaveAttribute('data-zoom', '1.000');

    const box = await window.locator('.qa-map-canvas').boundingBox();
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.wheel(0, -400);

    expect(Number(await wrap.getAttribute('data-zoom'))).toBeGreaterThan(1);

    await window.mouse.wheel(0, 4000);
    await expect(wrap).toHaveAttribute('data-zoom', '1.000');
  });
});
