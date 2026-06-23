const { test, expect } = require('./fixtures');

const readVar = () =>
  getComputedStyle(document.querySelector('.app-container')).getPropertyValue('--sidebar-width').trim();

test.describe('Sidebar resize', () => {
  test('drags the sidebar wider and persists the width', async ({ window }) => {
    const resizer = window.locator('.qa-sidebar-resizer');
    await expect(resizer).toBeVisible();

    const before = parseInt(await window.evaluate(readVar), 10);

    // Drag the divider 80px to the right.
    const box = await resizer.boundingBox();
    const y = box.y + 120;
    await window.mouse.move(box.x + box.width / 2, y);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2 + 80, y, { steps: 8 });
    await window.mouse.up();
    await window.waitForTimeout(50);

    const after = parseInt(await window.evaluate(readVar), 10);
    expect(after).toBeGreaterThan(before);

    // Width was persisted to localStorage (survives restarts).
    const stored = parseInt(await window.evaluate(() => localStorage.getItem('ludi-sidebar-width')), 10);
    expect(stored).toBe(after);
  });
});
