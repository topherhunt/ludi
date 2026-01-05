const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Selection', () => {
  // Import test files at the start to ensure we have items to select
  test.beforeAll(async ({ window }) => {
    const testFile1 = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    const testFile2 = path.join(testAudioDir, '01 Bring Tequila.mp3');

    await window.evaluate(async (files) => {
      for (const filePath of files) {
        try {
          await window.electronAPI.importFiles({
            filePaths: [filePath],
            parentListId: 0,
            position: 0
          });
        } catch (e) {
          // May already exist
        }
      }
    }, [testFile1, testFile2]);

    // Refresh UI
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);
  });

  test('should select a single item when clicked', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      const firstItem = treeItems.first();
      await firstItem.click();

      await expect(firstItem).toHaveClass(/selected/);

      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(1);
    }
  });

  test('should deselect previous item when clicking a different item', async ({ window }) => {
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      const firstItem = treeItems.nth(0);
      const secondItem = treeItems.nth(1);

      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      await secondItem.click();
      await expect(secondItem).toHaveClass(/selected/);

      const firstHasSelected = await firstItem.evaluate(el => el.classList.contains('selected'));
      expect(firstHasSelected).toBe(false);

      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(1);
    }
  });

  test('should toggle selection with CMD+click', async ({ window }) => {
    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      const firstItem = treeItems.nth(0);
      const secondItem = treeItems.nth(1);

      await firstItem.click();

      await secondItem.click({ modifiers: ['Meta'] });

      await expect(firstItem).toHaveClass(/selected/);
      await expect(secondItem).toHaveClass(/selected/);

      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(2);

      await secondItem.click({ modifiers: ['Meta'] });

      const secondHasSelected = await secondItem.evaluate(el => el.classList.contains('selected'));
      expect(secondHasSelected).toBe(false);
      await expect(firstItem).toHaveClass(/selected/);
    }
  });

  test('should navigate with arrow keys', async ({ window }) => {
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 1) {
      const firstItem = treeItems.first();
      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      await window.keyboard.press('ArrowDown');

      const secondItem = treeItems.nth(1);
      await expect(secondItem).toHaveClass(/selected/);

      const firstStillSelected = await firstItem.evaluate(el => el.classList.contains('selected'));
      expect(firstStillSelected).toBe(false);

      await window.keyboard.press('ArrowUp');

      await expect(firstItem).toHaveClass(/selected/);
    }
  });

  test('should clear selection with Escape key', async ({ window }) => {
    const treeItems = await window.locator('.tree-item-content');
    const count = await treeItems.count();

    if (count > 0) {
      const firstItem = treeItems.first();
      await firstItem.click();
      await expect(firstItem).toHaveClass(/selected/);

      await window.keyboard.press('Escape');

      const selectedCount = await window.evaluate(() => {
        return document.querySelectorAll('.tree-item-content.selected').length;
      });
      expect(selectedCount).toBe(0);
    }
  });
});
