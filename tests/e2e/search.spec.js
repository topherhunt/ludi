const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
    await expect(title).toHaveText('Search Results in Main Library');

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

    await expect(window.locator('#currentListTitle')).toHaveText('Search Results in Main Library');

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
    await expect(title).toHaveText('Search Results in Main Library');

    // Clean up
    await window.locator('.search-clear-btn').click();
    await window.waitForTimeout(50);
  });
});

test.describe('Search scoping', () => {
  test('a search run inside a playlist only matches that playlist', async ({ window }) => {
    const stamp = Date.now();
    const playlistName = `Search Scope ${stamp}`;
    const src = path.join(os.tmpdir(), `ludi-scope-${stamp}.m4a`);
    fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), src);

    // The song has no ID3 title, so the unique filename becomes the title --
    // the search term matches exactly this song and nothing else.
    const term = `ludi-scope-${stamp}`;
    const imported = await window.evaluate(async (fp) => {
      const result = await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
      return result.imported[0];
    }, src);
    fs.unlinkSync(src);

    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', playlistName);
    await window.click('#renameOkBtn');
    const playlistRow = window.locator('.qa-playlist-item').filter({ hasText: playlistName });
    await expect(playlistRow).toBeVisible({ timeout: 2000 });
    const listId = parseInt(await playlistRow.getAttribute('data-list-id'));

    // Put a copy of the song in the playlist (the drag itself is covered in
    // playlists.spec.js -- this test is about where search looks).
    const playlistItemId = await window.evaluate(async ({ itemId, targetListId }) => {
      await window.electronAPI.copyItemsToList({ itemIds: [itemId], targetListId, skipSongIds: [] });
      const items = await window.electronAPI.getListItems(targetListId);
      return items[0].id;
    }, { itemId: imported.itemId, targetListId: listId });

    const searchInput = window.locator('.search-input');
    const results = window.locator('.qa-search-song');

    // In the Main Library: one hit, the Main Library placement.
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await window.waitForTimeout(150);
    await searchInput.fill(term);
    await searchInput.press('Enter');
    await expect(window.locator('#currentListTitle')).toHaveText('Search Results in Main Library', { timeout: 2000 });
    await expect(results).toHaveCount(1);
    await expect(results).toHaveAttribute('data-item-id', String(imported.itemId));

    // Switching lists clears the search, so run it again from the playlist.
    await playlistRow.click();
    await window.waitForTimeout(150);
    await searchInput.fill(term);
    await searchInput.press('Enter');
    await expect(window.locator('#currentListTitle'))
      .toHaveText(`Search Results in ${playlistName}`, { timeout: 2000 });

    // One hit, and it is the playlist's placement -- not the Main Library one,
    // and not both.
    await expect(results).toHaveCount(1);
    await expect(results).toHaveAttribute('data-item-id', String(playlistItemId));
    // The tree is rooted at the playlist, so no "Main Library" wrapper folder.
    await expect(window.locator('.qa-search-folder')).toHaveCount(0);

    // Clean up: drop the playlist, then the song and its file.
    await window.locator('.search-clear-btn').click();
    await playlistRow.click({ button: 'right' });
    await window.click('.qa-playlist-delete');
    await window.click('#modalYesBtn');
    await expect(playlistRow).toHaveCount(0, { timeout: 2000 });
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), imported.itemId);
  });
});
