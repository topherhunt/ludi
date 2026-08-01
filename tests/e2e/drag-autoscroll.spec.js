const { test, expect } = require('./fixtures');

// Chromium's built-in drag autoscroll only fires in a couple of pixels right at
// the container edge and runs at one fixed speed. The explorer replaces it with a
// 4em band whose speed ramps up toward the edge. These tests drive it with
// synthetic dragover events, which is exactly how the real handler sees a drag.
test.describe('Drag autoscroll', () => {
  // Long enough to be measurable, short enough to keep each test well under 1s.
  const SAMPLE_MS = 150;

  // Force the tree taller than the viewport so there is somewhere to scroll,
  // without importing dozens of songs just to overflow the container.
  async function makeScrollable(window) {
    await window.keyboard.press('Escape');
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await window.waitForTimeout(150);
    await window.evaluate(() => {
      document.getElementById('explorerTree').style.minHeight = '3000px';
      document.getElementById('explorerContainer').scrollTop = 0;
    });
  }

  async function restore(window) {
    await window.evaluate(() => {
      document.getElementById('explorerTree').style.minHeight = '';
      document.getElementById('explorerContainer').scrollTop = 0;
    });
  }

  // `bandFraction` is the pointer's distance from the edge as a fraction of the
  // 4em band: 0 is the edge itself, 1 is the far side of the band.
  const dragoverInBand = (window, edge, bandFraction) =>
    window.evaluate(({ edge, bandFraction }) => {
      const c = document.getElementById('explorerContainer');
      const r = c.getBoundingClientRect();
      const band = 4 * parseFloat(getComputedStyle(c).fontSize);
      const y =
        edge === 'top' ? r.top + band * bandFraction
        : edge === 'bottom' ? r.bottom - band * bandFraction
        : r.top + r.height / 2;
      c.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 20,
        clientY: y,
        dataTransfer: new DataTransfer(),
      }));
    }, { edge, bandFraction });

  const endDrag = (window) =>
    window.evaluate(() => {
      document.getElementById('explorerContainer').dispatchEvent(
        new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() })
      );
    });

  const scrollTop = (window) =>
    window.evaluate(() => document.getElementById('explorerContainer').scrollTop);

  async function scrollDistance(window, edge, bandFraction) {
    await window.evaluate(() => { document.getElementById('explorerContainer').scrollTop = 500; });
    const before = await scrollTop(window);
    await dragoverInBand(window, edge, bandFraction);
    await window.waitForTimeout(SAMPLE_MS);
    const after = await scrollTop(window);
    await endDrag(window);
    return after - before;
  }

  test('scrolls down inside the bottom band, faster nearer the edge, and not mid-list', async ({ window }) => {
    await makeScrollable(window);

    // Just inside the band: a slow, controllable crawl.
    const slow = await scrollDistance(window, 'bottom', 0.9);
    expect(slow).toBeGreaterThan(2);
    expect(slow).toBeLessThan(60);

    // At the edge: much faster, which is what "speed accelerates" means.
    const fast = await scrollDistance(window, 'bottom', 0.02);
    expect(fast).toBeGreaterThan(slow * 3);

    // Outside the band there is no autoscroll at all.
    const middle = await scrollDistance(window, 'middle', 0);
    expect(middle).toBe(0);

    await restore(window);
  });

  test('scrolls up inside the top band and stops as soon as the drag leaves', async ({ window }) => {
    await makeScrollable(window);

    const up = await scrollDistance(window, 'top', 0.02);
    expect(up).toBeLessThan(-50);

    // scrollDistance already ended the drag; scrolling must not coast on.
    const settled = await scrollTop(window);
    await window.waitForTimeout(SAMPLE_MS);
    expect(await scrollTop(window)).toBe(settled);

    await restore(window);
  });
});
