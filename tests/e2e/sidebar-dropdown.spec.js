const { test, expect } = require('./fixtures');

test.describe('Sidebar + dropdown', () => {
  test('closes on Escape and on an outside click', async ({ window }) => {
    const addBtn = window.locator('#addLibraryBtn');
    const dropdown = window.locator('#addLibraryDropdown');

    // Escape closes it.
    await addBtn.click();
    await expect(dropdown).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(dropdown).toHaveCount(0);

    // A click outside the dropdown closes it.
    await addBtn.click();
    await expect(dropdown).toBeVisible();
    await window.locator('.explorer-container').click({ position: { x: 60, y: 60 } });
    await expect(dropdown).toHaveCount(0);
  });
});
