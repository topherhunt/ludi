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

  test('a single click toggles loop off/all and never lands on repeat-one', async ({ window }) => {
    const loopBtn = window.locator('#loopBtn');
    // A real cold click is 5s after the last one; the app reads the window from
    // this override so the test doesn't have to wait it out.
    const coldClick = async () => {
      await window.waitForTimeout(60);
      await loopBtn.click();
    };
    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 50; });

    expect(await window.evaluate(() => window.loopMode)).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    await coldClick();
    expect(await window.evaluate(() => window.loopMode)).toBe('off');
    await expect(loopBtn.locator('i.bi-repeat')).toBeVisible();

    await coldClick();
    expect(await window.evaluate(() => window.loopMode)).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  test('two clicks inside the window enter repeat-one, and one click leaves it', async ({ window }) => {
    const loopBtn = window.locator('#loopBtn');
    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 300; });
    await window.waitForTimeout(350); // start cold, so click one isn't click two

    // Whatever mode we start in, two quick clicks land on repeat-one.
    await loopBtn.click();
    await loopBtn.click();
    expect(await window.evaluate(() => window.loopMode)).toBe('one');
    await expect(loopBtn.locator('i.bi-repeat-1')).toBeVisible();
    await expect(loopBtn).toHaveClass(/active/);

    await loopBtn.click();
    expect(await window.evaluate(() => window.loopMode)).toBe('off');

    // Leave the app in its default loop mode for the specs that follow. Still a
    // cold click, so drop the override only once it's done.
    await window.waitForTimeout(350);
    await loopBtn.click();
    expect(await window.evaluate(() => window.loopMode)).toBe('all');
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  test('clicking steadily walks all three loop modes, at the real 5s window', async ({ window }) => {
    // No override here on purpose: back-to-back clicks are all well inside the
    // real window, which is exactly how the button used to get stuck flipping
    // off <-> repeat-one and never showing loop-all again.
    const loopBtn = window.locator('#loopBtn');

    // Start from repeat-one, which is the one mode that leaves no half-finished
    // double-click armed, so the walk below starts from a known state.
    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 50; });
    await window.waitForTimeout(60);
    await loopBtn.click();
    await loopBtn.click();
    expect(await window.evaluate(() => window.loopMode)).toBe('one');
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });

    const modes = [];
    for (let i = 0; i < 6; i++) {
      await loopBtn.click();
      modes.push(await window.evaluate(() => window.loopMode));
    }
    expect(modes).toEqual(['off', 'all', 'one', 'off', 'all', 'one']);

    // Back to the default mode for the specs that follow.
    await loopBtn.click();
    await loopBtn.click();
    expect(await window.evaluate(() => window.loopMode)).toBe('all');
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
