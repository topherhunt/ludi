const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Player Controls', () => {
  test('should have shuffle and loop control buttons', async ({ window }) => {
    const shuffleBtn = await window.locator('#shuffleBtn');
    await expect(shuffleBtn).toBeVisible();
    await expect(shuffleBtn).toHaveClass(/toggle-btn/);

    const loopBtn = await window.locator('#loopBtn');
    await expect(loopBtn).toBeVisible();
    await expect(loopBtn).toHaveClass(/toggle-btn/);
  });

  test('should toggle shuffle mode when shuffle button is clicked', async ({ window }) => {
    const shuffleBtn = await window.locator('#shuffleBtn');

    const initialState = await window.evaluate(() => {
      return window.shuffleEnabled || false;
    });
    expect(initialState).toBe(false);

    await shuffleBtn.click();

    const enabledState = await window.evaluate(() => {
      return window.shuffleEnabled;
    });
    expect(enabledState).toBe(true);

    await expect(shuffleBtn).toHaveClass(/active/);

    await shuffleBtn.click();

    const disabledState = await window.evaluate(() => {
      return window.shuffleEnabled;
    });
    expect(disabledState).toBe(false);
  });

  test('should cycle through loop modes when loop button is clicked', async ({ window }) => {
    const loopBtn = await window.locator('#loopBtn');

    const initialMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(initialMode).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    await loopBtn.click();

    let loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('one');
    await expect(loopBtn).toHaveClass(/active/);

    const loopOneIcon = loopBtn.locator('i.bi-repeat-1');
    await expect(loopOneIcon).toBeVisible();

    await loopBtn.click();

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('off');

    const loopOffIcon = loopBtn.locator('i.bi-repeat');
    await expect(loopOffIcon).toBeVisible();

    await loopBtn.click();

    loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('all');
  });

  test('should have volume controls', async ({ window }) => {
    const volumeSlider = await window.locator('#volumeSlider');
    await expect(volumeSlider).toBeVisible();

    const muteBtn = await window.locator('#muteBtn');
    await expect(muteBtn).toBeVisible();
  });

  test('should have seek bar and time displays', async ({ window }) => {
    const seekBar = await window.locator('#seekBar');
    await expect(seekBar).toBeVisible();

    const currentTime = await window.locator('#currentTime');
    await expect(currentTime).toBeVisible();

    const totalTime = await window.locator('#totalTime');
    await expect(totalTime).toBeVisible();
  });

  test('should display prev/next track buttons', async ({ window }) => {
    const prevBtn = await window.locator('#prevBtn');
    await expect(prevBtn).toBeVisible();

    const nextBtn = await window.locator('#nextBtn');
    await expect(nextBtn).toBeVisible();
  });

  // Regression: #seekBar is a 0-100 range input, so once it had focus Chromium's
  // native arrow-key step took over and moved 1% of the song per press -- 1.5s in
  // this ~2:33 clip, and minutes in a long one. Arrows must always seek 5s.
  test('arrow keys on the focused seek bar seek 5s per press, not 1% of the song', async ({ window }) => {
    const toSec = (s) => { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; };

    await window.evaluate(async (fp) => {
      await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
    }, path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3'));

    await window.locator('.playlist-item').first().click();
    const row = window
      .locator('.tree-item-content[data-is-folder="false"]', { hasText: 'Jump Into My Mouth' })
      .first();
    await expect(row).toBeVisible({ timeout: 2000 });
    await row.dblclick();
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);
    await window.waitForTimeout(400); // let Howler report a real duration to seek against

    // Pause so the only thing moving currentTime is the arrow keys.
    await window.locator('#playPauseBtn').click();
    await window.waitForTimeout(100);

    // The clip must be long enough that 1%-per-press is clearly distinguishable
    // from 5s-per-press (~1.5s vs 5s here).
    expect(toSec(await window.locator('#totalTime').textContent())).toBeGreaterThan(120);

    // Start from the middle, so neither direction clamps at an end.
    await window.evaluate(() => {
      const bar = document.getElementById('seekBar');
      bar.value = '50';
      bar.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await window.waitForTimeout(100);

    // Four presses: 20s if the fix holds, ~6s if the native 1% step is back.
    // #currentTime has 1s resolution, so the two are unambiguous over 4 presses.
    const seekBar = window.locator('#seekBar');
    await seekBar.focus();
    const start = toSec(await window.locator('#currentTime').textContent());

    for (let i = 0; i < 4; i++) await seekBar.press('ArrowRight');
    await window.waitForTimeout(100);
    expect(toSec(await window.locator('#currentTime').textContent()) - start).toBeGreaterThanOrEqual(19);
    expect(toSec(await window.locator('#currentTime').textContent()) - start).toBeLessThanOrEqual(21);

    for (let i = 0; i < 4; i++) await seekBar.press('ArrowLeft');
    await window.waitForTimeout(100);
    expect(toSec(await window.locator('#currentTime').textContent()) - start).toBeLessThanOrEqual(1);
  });
});
