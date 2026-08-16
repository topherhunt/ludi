const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// A track can stop without ever ending: a Bluetooth speaker dropping out, the
// output device changing, or a stream that stops delivering leaves the <audio>
// element paused or waiting forever. The queue only advances on 'ended', so
// nothing picked those up and a long unattended playlist just went silent.

const SONG = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// Short enough that a simulated stall resolves inside one test. Tests that
// trigger failures explicitly use a long window instead, so a load that takes
// longer than the window isn't itself reported as a stall.
const STALL_MS = 150;
const NO_STALL_MS = 5000;

const setStallTimeout = (window, ms) =>
  window.evaluate((value) => { window.__ludiStallTimeoutMs = value; }, ms);

// How long the app waits, after playback stops, before letting macOS suspend it.
// `null` restores the real ten seconds, which is what the gap between two tracks
// has to fit inside.
const setPlaybackGap = (window, ms) =>
  window.evaluate((value) => {
    if (value === null) delete window.__ludiPlaybackGapMs;
    else window.__ludiPlaybackGapMs = value;
  }, ms);

const blockingSuspension = (window) =>
  window.evaluate(() => window.electronAPI.isPlaybackPreventingSuspension());

let folder = null;  // { listId, itemId }
let songIds = [];

const rowOf = (window, songId) =>
  window.locator(`.tree-item-content[data-song-id="${songId}"]`);

// The live <audio> element behind Howler, or null between loads.
const audioState = (window) =>
  window.evaluate(() => {
    const node = window.__ludiAudioNode();
    return node ? { paused: node.paused, currentTime: node.currentTime } : null;
  });

const waitForPlayingNode = (window) =>
  expect
    .poll(async () => (await audioState(window))?.paused === false, { timeout: 3000 })
    .toBe(true);

async function playFirstSong(window) {
  await window.keyboard.press('Escape');
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  const folderRow = window.locator(`.tree-item-content[data-folder-id="${folder.listId}"]`);
  await expect(folderRow).toBeVisible({ timeout: 2000 });
  if (!(await rowOf(window, songIds[0]).isVisible())) {
    await folderRow.locator('.tree-item-icon.chevron').click();
  }
  await rowOf(window, songIds[0]).dblclick();
  await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);
  await waitForPlayingNode(window);
}

test.describe('Playback recovery', () => {
  test.beforeAll(async ({ window }) => {
    const files = [];
    for (const [i, src] of [SONG, TONE].entries()) {
      const p = path.join(os.tmpdir(), `ludi-recovery-${STAMP}-${i}${path.extname(src)}`);
      fs.copyFileSync(src, p);
      files.push(p);
    }

    const result = await window.evaluate(async ({ filePaths, title }) => {
      const listId = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title });
      await window.electronAPI.importFiles({ filePaths, parentListId: listId, position: 0 });
      const placements = await window.electronAPI.getListItems(0);
      const items = await window.electronAPI.getListItems(listId);
      return {
        listId,
        itemId: placements.find((it) => it.list_id === listId).id,
        songIds: items.map((it) => it.song_id),
        firstDuration: items[0].duration_seconds,
      };
    }, { filePaths: files, title: `Recovery ${STAMP}` });

    files.forEach((p) => fs.unlinkSync(p));
    folder = { listId: result.listId, itemId: result.itemId };
    songIds = result.songIds;
    expect(songIds).toHaveLength(2);
    // The first song has to be long enough to stall partway through.
    expect(result.firstDuration).toBeGreaterThan(60);
  });

  test.afterAll(async ({ window }) => {
    await window.evaluate(() => {
      delete window.__ludiStallTimeoutMs;
      delete window.__ludiPlaybackGapMs;
    });
    if (folder) {
      await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), folder.itemId);
    }
  });

  test('a track that goes silent without ending is resumed where it died', async ({ window }) => {
    await setStallTimeout(window, STALL_MS);
    await playFirstSong(window);

    // Jump most of a minute in, then kill playback the way a dropped output
    // device does: the element stops, but Howler still believes it is playing,
    // so no 'ended' and no 'error' ever arrive.
    await window.evaluate(() => {
      const node = window.__ludiAudioNode();
      node.currentTime = 45;
      node.pause();
    });

    await waitForPlayingNode(window);
    const resumed = await audioState(window);
    expect(resumed.currentTime).toBeGreaterThan(40);

    // Same song, still playing -- the queue did not skip or stop.
    await expect(rowOf(window, songIds[0])).toHaveClass(/current-song/);
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);

    await window.locator('#playPauseBtn').click();
  });

  test('a track that keeps failing is skipped so the rest of the queue plays', async ({ window }) => {
    await setStallTimeout(window, NO_STALL_MS);
    await playFirstSong(window);

    // A media error on a file that is still on disk used to be swallowed
    // entirely, which is what left the player dead until a restart.
    const failNow = () =>
      window.evaluate(() => window.__ludiAudioNode().dispatchEvent(new Event('error')));

    await failNow();                  // first failure: retried
    await waitForPlayingNode(window);
    await expect(rowOf(window, songIds[0])).toHaveClass(/current-song/);

    await failNow();                  // second failure on the same track: moved past
    await expect(rowOf(window, songIds[1])).toHaveClass(/current-song/, { timeout: 3000 });
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);

    await window.locator('#playPauseBtn').click();
  });

  test('playing holds a power-save block so an idle Mac cannot suspend the app', async ({ window }) => {
    const blocked = () => blockingSuspension(window);

    await setStallTimeout(window, NO_STALL_MS);
    await setPlaybackGap(window, 50);
    await playFirstSong(window);
    await expect.poll(blocked, { timeout: 2000 }).toBe(true);

    await window.locator('#playPauseBtn').click();
    await expect(window.locator('#playPauseBtn')).not.toHaveClass(/playing/);
    await expect.poll(blocked, { timeout: 2000 }).toBe(false);
  });

  test('the power-save block is held across a track change, not dropped between songs', async ({ window }) => {
    // The bug that stopped a party mix three or four songs in: playback stops
    // for as long as the next track takes to load, and the block used to be
    // released for exactly that window -- once per song, all evening. An idle
    // Mac whose sleep timer had already expired took the first one it was
    // offered, so the music died mid-playlist while the app sat there healthy.
    await setStallTimeout(window, NO_STALL_MS);
    await setPlaybackGap(window, null);
    await playFirstSong(window);
    await expect.poll(() => blockingSuspension(window), { timeout: 2000 }).toBe(true);

    // Run the track off its own end -- Howler refuses a synthetic 'ended' while
    // the element is still playing -- and watch the block continuously until the
    // next song is playing. A single check afterwards would pass even if the
    // block had been dropped and re-taken in between.
    const { samples, sawGap } = await window.evaluate(async () => {
      const btn = document.querySelector('#playPauseBtn');
      const node = window.__ludiAudioNode();
      node.currentTime = node.duration - 0.3;

      const samples = [];
      let sawGap = false;
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const playing = btn.classList.contains('playing');
        if (sawGap && playing) break;
        if (!playing) sawGap = true;
        samples.push(await window.electronAPI.isPlaybackPreventingSuspension());
      }
      return { samples, sawGap };
    });

    await expect(rowOf(window, songIds[1])).toHaveClass(/current-song/, { timeout: 3000 });
    expect(sawGap).toBe(true);                   // the gap was actually observed
    expect(samples.every(Boolean)).toBe(true);

    await window.locator('#playPauseBtn').click();
  });
});
