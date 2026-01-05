const { test, expect } = require('./fixtures');

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
      return window.loopMode || 'off';
    });
    expect(initialMode).toBe('off');

    await loopBtn.click();

    let loopMode = await window.evaluate(() => {
      return window.loopMode;
    });
    expect(loopMode).toBe('all');
    await expect(loopBtn).toHaveClass(/active/);

    await loopBtn.click();

    loopMode = await window.evaluate(() => {
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
});
