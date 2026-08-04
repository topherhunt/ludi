const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

/**
 * End-to-end proof that the analysis stack actually runs inside Electron:
 * hidden window -> Web Audio decode -> essentia.js mel-spectrogram -> ONNX
 * Runtime inference -> SQLite. Every one of those is a WASM or Chromium
 * integration that a unit test cannot exercise.
 *
 * This is the one test in the suite allowed to be slow. Each worker loads a
 * 13 MB WASM runtime plus 4 MB of model weights before it can analyze anything,
 * and analysis itself runs at roughly 80x realtime -- the 2.5-minute fixture
 * alone is a couple of seconds of honest computation. There is no way to make
 * that sub-second without mocking out the very thing being tested.
 */

const MP3 = '02 Jump Into My Mouth and Breathe in the Stardust.mp3';
const M4A = 'test-tone.m4a';

/** Poll the analysis queue until it drains. */
async function waitForAnalysis(window, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let progress;
  do {
    progress = await window.evaluate(() => window.electronAPI.getAnalysisProgress());
    if (progress.pending === 0 && !progress.running) return progress;
    await window.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(`analysis did not finish in ${timeoutMs}ms: ${JSON.stringify(progress)}`);
}

test.describe('Audio analysis', () => {
  test.describe.configure({ timeout: 180000 });

  let songIds = [];
  let itemIds = [];

  test.afterAll(async () => {
    // Leave the shared test library as we found it -- later specs count songs.
    const { setupElectronApp } = require('./fixtures');
    const { window } = await setupElectronApp();
    for (const itemId of itemIds) {
      await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), itemId);
    }
  });

  test('analyzes imported songs into embeddings, activations and mood axes', async ({ window }) => {
    const filePaths = [path.join(testAudioDir, MP3), path.join(testAudioDir, M4A)];

    const imported = await window.evaluate(
      (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }),
      filePaths
    );
    expect(imported.errors).toEqual([]);
    expect(imported.imported).toHaveLength(2);
    itemIds = imported.itemIds;

    songIds = imported.imported.map((entry) => entry.songId);
    expect(songIds).toHaveLength(2);

    const started = await window.evaluate(() => window.electronAPI.startAnalysis());
    expect(started.pending).toBeGreaterThanOrEqual(2);

    const done = await waitForAnalysis(window, 150000);

    // A song that failed analysis stays in the queue as 'failed' with its error
    // message; surface that rather than a bare count mismatch.
    const failed = await window.evaluate(() => window.electronAPI.getFailedAnalyses());
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(done.analyzed).toBeGreaterThanOrEqual(2);

    // ---- What the model actually produced ----
    const analyses = await window.evaluate(async (ids) => {
      const out = [];
      for (const id of ids) {
        const row = await window.electronAPI.getSongAnalysis(id);
        // Blobs arrive as Uint8Array over IPC; decode to the floats they hold.
        const toFloats = (bytes) =>
          Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
        out.push({
          modelVersion: row.model_version,
          embedding: toFloats(row.embedding),
          activations: toFloats(row.activations),
          axes: row.axes,
        });
      }
      return out;
    }, songIds);

    for (const analysis of analyses) {
      expect(analysis.modelVersion).toBe('msd-musicnn-1+heads-v1');
      expect(analysis.embedding).toHaveLength(200);
      expect(analysis.activations).toHaveLength(50);
      expect(analysis.embedding.every(Number.isFinite)).toBe(true);

      // MusiCNN's outputs are sigmoids, so they're probabilities by construction.
      // A value outside 0..1 means we read the wrong output tensor.
      expect(Math.min(...analysis.activations)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...analysis.activations)).toBeLessThanOrEqual(1);

      // An all-zero embedding is what a silently-failed inference looks like.
      expect(analysis.embedding.some((v) => v !== 0)).toBe(true);
    }

    // ---- The classification heads ----
    const axes = analyses[0].axes;
    for (const key of ['danceability', 'acoustic', 'happy', 'sad', 'vocal', 'valence', 'arousal']) {
      expect(axes, `missing axis ${key}`).toHaveProperty(key);
      expect(axes[key], `${key} = ${axes[key]}`).toBeGreaterThanOrEqual(0);
      expect(axes[key]).toBeLessThanOrEqual(1);
    }
    // Five MIREX mood clusters, as a probability distribution.
    expect(axes.mirex).toHaveLength(5);
    expect(axes.mirex.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);

    // ---- The embedding describes the audio, not the pipeline ----
    // A 2.5-minute song and a 10-second test tone must not land in the same
    // place. If they do, we're fingerprinting something other than the music.
    const [a, b] = analyses.map((x) => x.embedding);
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    const cosine = dot / (norm(a) * norm(b));
    expect(cosine).toBeLessThan(0.99);
  });

  test('declines to auto-tag a library too small to calibrate against', async ({ window }) => {
    // Thresholds are percentiles of the library's own score distribution. With a
    // handful of songs those percentiles are noise, so the tagger refuses rather
    // than labelling two songs "the top 25% of your collection".
    const result = await window.evaluate(() => window.electronAPI.recalculateAutoTags());
    expect(result.skipped).toMatch(/at least 20 analyzed songs/);
    expect(result.assignments).toBe(0);
  });
});
