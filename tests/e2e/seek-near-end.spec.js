const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

// Regression coverage for audio seeking over the ludi-audio:// custom protocol.
//
// The bug: the scheme was registered without `standard: true`, so Chromium's media
// stack capped the forward buffer (~3MB) and could not range-fetch beyond it on a
// seek -- the <audio> element fired MEDIA_ERR_NETWORK (code 2) and froze. Seeking
// toward the end of a song stopped playback; a botched earlier fix (capping the
// protocol response to 1MB) instead truncated the *reported duration* so a 2:33
// song looked like 0:32 and skipped after ~43s. Both are guarded below:
//   - duration must reflect the WHOLE file (this clip is ~2:33, not 0:32)
//   - a near-end seek must land near the end AND keep playing (no error, no freeze)
test.describe('Seek near end', () => {
  // This clip is ~153s. The truncation bug reported it as ~33s, so anything well
  // above a minute proves the full file is being served / duration is correct.
  const CLIP_MIN_SECONDS = 120;

  const toSec = (s) => { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; };

  async function startSong(window) {
    const testFilePath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    await window.evaluate(async (filePath) => {
      await window.electronAPI.importFiles({ filePaths: [filePath], parentListId: 0, position: 0 });
    }, testFilePath);

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(100);
    // Target THIS song by title -- other tests leave songs (incl. a deliberately
    // missing-file one) in the shared library, so "first row" is not reliable.
    const songItem = window
      .locator('.tree-item-content[data-is-folder="false"]', { hasText: 'Jump Into My Mouth' })
      .first();
    await expect(songItem).toBeVisible({ timeout: 2000 });
    await songItem.dblclick();
    await window.locator('#playPauseBtn.playing').waitFor({ timeout: 6000 }).catch(() => {});
  }

  const seekTo = (window, pct) => window.evaluate((p) => {
    const bar = document.getElementById('seekBar');
    bar.value = String(p);
    bar.dispatchEvent(new Event('input', { bubbles: true }));
  }, pct);

  // Force loop "one" (off->all->one->off) so reaching the end replays THIS valid
  // song instead of auto-advancing into a foreign/broken song other tests added.
  async function setLoop(window, target) {
    for (let i = 0; i < 4; i++) {
      if (await window.evaluate(() => window.loopMode) === target) return;
      await window.locator('#loopBtn').click();
    }
  }

  function collectErrors(window) {
    const errors = [];
    const handler = msg => {
      if (msg.type() === 'error' && !msg.text().includes('[vite]') && !msg.text().includes('WebSocket')) errors.push(msg.text());
    };
    window.on('console', handler);
    return { errors, stop: () => window.off('console', handler) };
  }

  test('reports the full song duration (not a truncated chunk)', async ({ window }) => {
    await startSong(window);
    await window.waitForTimeout(800); // let Howler settle the real duration
    const dur = toSec(await window.locator('#totalTime').textContent());
    expect(dur).toBeGreaterThan(CLIP_MIN_SECONDS);
  });

  test('seeking near the end lands near the end and keeps playing', async ({ window }) => {
    const { errors, stop } = collectErrors(window);
    await startSong(window);
    await setLoop(window, 'one');
    await window.waitForTimeout(800);

    const dur = toSec(await window.locator('#totalTime').textContent());
    expect(dur).toBeGreaterThan(CLIP_MIN_SECONDS);

    // Seek to 90% -- well past Chromium's forward buffer, the case that froze before.
    await seekTo(window, 90);
    await window.waitForTimeout(800);
    const cur1 = toSec(await window.locator('#currentTime').textContent());
    // Landed near the 90% mark (not clamped to a truncated duration, not reset to 0).
    expect(cur1).toBeGreaterThan(dur * 0.8);

    // ...and playback actually CONTINUES past the seek point (does not freeze).
    await window.waitForTimeout(1500);
    const cur2 = toSec(await window.locator('#currentTime').textContent());
    expect(cur2).toBeGreaterThan(cur1);

    stop();
    await setLoop(window, 'all');
    expect(errors).toEqual([]);
  });

  test('immediate near-end seek (racing the initial load) does not error', async ({ window }) => {
    const { errors, stop } = collectErrors(window);
    await startSong(window);
    await setLoop(window, 'one');
    for (const pct of [90, 90, 90]) {
      await seekTo(window, pct);
      await window.waitForTimeout(20);
    }
    await window.waitForTimeout(700);
    stop();
    await setLoop(window, 'all');
    expect(errors).toEqual([]);
  });
});
