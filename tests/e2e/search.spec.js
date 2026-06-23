const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

test.describe('Search', () => {
  test.beforeAll(async ({ window }) => {
    // Import a test song so we have data to search against
    const filePath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    await window.evaluate(async (fp) => {
      try {
        await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
      } catch (e) {
        // May already exist from another test
      }
    }, filePath);

    // Navigate to Main Library
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);
  });

  test('search input is visible in the explorer header', async ({ window }) => {
    const searchInput = await window.locator('.search-input');
    await expect(searchInput).toBeVisible();
  });

  test('advanced search gear button is visible', async ({ window }) => {
    const gearBtn = await window.locator('.search-advanced-btn');
    await expect(gearBtn).toBeVisible();
  });

  test('Enter in search input shows Search Results title and view toggle', async ({ window }) => {
    const searchInput = await window.locator('.search-input');
    await searchInput.click();
    await searchInput.fill('jump');
    await searchInput.press('Enter');
    await window.waitForTimeout(200);

    const title = await window.locator('#currentListTitle');
    await expect(title).toHaveText('Search Results');

    const viewToggle = await window.locator('.search-view-toggle');
    await expect(viewToggle).toBeVisible();
  });

  test('matching songs are shown as search results', async ({ window }) => {
    // Already searching "jump" from previous test
    const songRows = await window.locator('.qa-search-song');
    await expect(songRows.first()).toBeVisible({ timeout: 1000 });
  });

  test('X clear button appears while searching and clears on click', async ({ window }) => {
    const clearBtn = await window.locator('.search-clear-btn');
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    await window.waitForTimeout(100);

    const title = await window.locator('#currentListTitle');
    await expect(title).toHaveText('Main Library');

    await expect(clearBtn).not.toBeVisible();
  });

  test('Escape key clears search and restores Main Library title', async ({ window }) => {
    const searchInput = await window.locator('.search-input');
    await searchInput.click();
    await searchInput.fill('jump');
    await searchInput.press('Enter');
    await window.waitForTimeout(200);

    await expect(window.locator('#currentListTitle')).toHaveText('Search Results');

    await searchInput.press('Escape');
    await window.waitForTimeout(100);

    await expect(window.locator('#currentListTitle')).toHaveText('Main Library');
  });

  test('no-match search shows empty state', async ({ window }) => {
    const searchInput = await window.locator('.search-input');
    await searchInput.click();
    await searchInput.fill('xyzzy_no_match_9999');
    await searchInput.press('Enter');
    await window.waitForTimeout(200);

    const emptyState = await window.locator('.search-empty-state');
    await expect(emptyState).toBeVisible();

    // Clean up
    await searchInput.press('Escape');
    await window.waitForTimeout(50);
  });

  test('flat view toggle shows songs without folder grouping', async ({ window }) => {
    const searchInput = await window.locator('.search-input');
    await searchInput.click();
    await searchInput.fill('jump');
    await searchInput.press('Enter');
    await window.waitForTimeout(200);

    const flatBtn = await window.locator('.search-toggle-btn').nth(1);
    await flatBtn.click();
    await window.waitForTimeout(100);

    await expect(flatBtn).toHaveClass(/active/);
    const songRows = await window.locator('.qa-search-song');
    await expect(songRows.first()).toBeVisible();

    // Switch back to nested
    const nestedBtn = await window.locator('.search-toggle-btn').first();
    await nestedBtn.click();
    await window.waitForTimeout(50);
  });

  test('advanced search modal opens on gear button click', async ({ window }) => {
    // Clear any active search first
    await window.keyboard.press('Escape');
    await window.waitForTimeout(50);

    const gearBtn = await window.locator('.search-advanced-btn');
    await gearBtn.click();
    await window.waitForTimeout(100);

    const modal = await window.locator('.advanced-search-dialog');
    await expect(modal).toBeVisible();

    // Check it has the expected structure
    await expect(window.locator('.advsearch-mode-select')).toBeVisible();
    await expect(window.locator('.advsearch-condition-row')).toBeVisible();
    await expect(window.locator('.advsearch-action-btn').first()).toBeVisible();
  });

  test('advanced search modal cancel button closes it', async ({ window }) => {
    const cancelBtn = await window.locator('.modal-btn-secondary').filter({ hasText: 'Cancel' });
    await cancelBtn.click();
    await window.waitForTimeout(100);

    const modal = await window.locator('.advanced-search-dialog');
    await expect(modal).not.toBeVisible();
  });

  test('advanced search modal submits a query and shows results', async ({ window }) => {
    const gearBtn = await window.locator('.search-advanced-btn');
    await gearBtn.click();
    await window.waitForTimeout(100);

    // Fill in artist condition
    const fieldSelect = await window.locator('.advsearch-field-select').first();
    await fieldSelect.selectOption('title');

    const valueInput = await window.locator('.advsearch-value-input').first();
    await valueInput.fill('jump');

    const searchBtn = await window.locator('.modal-btn').filter({ hasText: 'Search' });
    await searchBtn.click();
    await window.waitForTimeout(200);

    const title = await window.locator('#currentListTitle');
    await expect(title).toHaveText('Search Results');

    // Clean up
    await window.locator('.search-clear-btn').click();
    await window.waitForTimeout(50);
  });
});
