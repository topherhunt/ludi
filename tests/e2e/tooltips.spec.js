const { test, expect } = require('./fixtures');

test.describe('Tooltips', () => {
  test('buttons use CSS data-tooltip instead of the slow native title', async ({ window }) => {
    // A representative player button and a sidebar button.
    for (const [selector, label] of [
      ['#shuffleBtn', 'Shuffle'],
      ['#muteBtn', 'Mute'],
      ['.qa-expand-all', 'Expand All'],
    ]) {
      const btn = window.locator(selector);
      await expect(btn).toHaveAttribute('data-tooltip', label);
      const hasNativeTitle = await btn.evaluate((el) => el.hasAttribute('title'));
      expect(hasNativeTitle).toBe(false);
    }
  });

  test('sidebar does not clip header tooltips (scroll lives on the playlist list)', async ({ window }) => {
    // overflow:visible on the sidebar lets the header button tooltips escape;
    // the playlist list scrolls instead.
    const sidebarOverflowX = await window.locator('.sidebar').evaluate((el) => getComputedStyle(el).overflowX);
    expect(sidebarOverflowX).toBe('visible');
    const listOverflowY = await window.locator('.playlist-list').evaluate((el) => getComputedStyle(el).overflowY);
    expect(listOverflowY).toBe('auto');
  });
});
