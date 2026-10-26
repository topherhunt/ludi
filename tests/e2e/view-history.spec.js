const { test, expect } = require('./fixtures');

// Back/forward across explorer screens. The app is shared with other specs, so
// each test starts from a screen it opens and only looks at history it made.
const back = (window) => window.locator('.qa-nav-back');
const forward = (window) => window.locator('.qa-nav-forward');
const title = (window) => window.locator('#currentListTitle');
const mainLibrary = (window) => window.locator('.qa-playlist-item[data-list-id="0"]');

test.describe('Back and forward', () => {
  test.beforeEach(async ({ window }) => {
    await window.keyboard.press('Escape');
    await mainLibrary(window).click();
    await expect(title(window)).toHaveText('Main Library');
  });

  test('sidebar clicks are recorded and Back/Forward walk them', async ({ window }) => {
    await window.locator('.qa-open-map').click();
    await window.locator('.qa-open-facets').click();
    await expect(window.locator('.qa-facets-view')).toBeVisible();

    await back(window).click();
    await expect(window.locator('.qa-map-title')).toBeVisible();
    await back(window).click();
    await expect(title(window)).toHaveText('Main Library');

    await forward(window).click();
    await expect(window.locator('.qa-map-title')).toBeVisible();
    await forward(window).click();
    await expect(window.locator('.qa-facets-view')).toBeVisible();
    await expect(forward(window)).toBeDisabled();
  });

  test('the tooltips name the screen each button goes to', async ({ window }) => {
    await window.locator('.qa-open-groups').click();
    await window.locator('.qa-open-map').click();
    await back(window).click();

    await expect(back(window)).toHaveAttribute('data-tooltip', 'Back to Main Library');
    await expect(forward(window)).toHaveAttribute('data-tooltip', 'Forward to Music Map');
  });

  test('Back returns to a search with its query', async ({ window }) => {
    await window.fill('.search-input', 'zzz-no-such-song');
    await window.press('.search-input', 'Enter');
    await expect(title(window)).toHaveText('Search Results in Main Library');
    await window.locator('.qa-open-map').click();

    await expect(back(window)).toHaveAttribute('data-tooltip', 'Back to Search "zzz-no-such-song" in Main Library');
    await back(window).click();
    await expect(title(window)).toHaveText('Search Results in Main Library');
    await expect(window.locator('.search-input')).toHaveValue('zzz-no-such-song');
  });

  test('going somewhere new drops the forward entries', async ({ window }) => {
    await window.locator('.qa-open-map').click();
    await back(window).click();
    await expect(forward(window)).toBeEnabled();

    await window.locator('.qa-open-facets').click();
    await expect(forward(window)).toBeDisabled();
    await back(window).click();
    await expect(title(window)).toHaveText('Main Library');
  });

  // Clicked in-page with a tick between clicks: history records once per
  // microtask, so back-to-back synchronous clicks would collapse into one entry.
  test('history keeps only the last 20 screens', async ({ window }) => {
    const steps = await window.evaluate(async () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve));
      const click = async (selector) => { document.querySelector(selector).click(); await tick(); };
      for (let i = 0; i < 12; i++) {
        await click('.qa-open-groups');
        await click('.qa-open-facets');
      }
      let count = 0;
      while (!document.querySelector('.qa-nav-back').disabled) {
        await click('.qa-nav-back');
        count++;
      }
      return count;
    });
    expect(steps).toBe(19);
  });
});

test.describe('Switching playlists from the sidebar', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { testAudioDir } = require('./fixtures');
  const TERM = `ludiswitch${Date.now()}`;
  const PLAYLIST = `Switch target ${TERM}`;
  const SONGS = 40;
  let itemIds = [];
  let playlistId = null;

  const scrollTop = (window) => window.locator('.explorer-container').evaluate((el) => el.scrollTop);
  const playlist = (window) => window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`);

  test.beforeAll(async ({ window }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludi-switch-'));
    const files = Array.from({ length: SONGS }, (unused, i) => {
      const file = path.join(dir, `${TERM}-${String(i).padStart(2, '0')}.m4a`);
      fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), file);
      return file;
    });
    itemIds = await window.evaluate(async (paths) =>
      (await window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 })).itemIds, files);
    fs.rmSync(dir, { recursive: true, force: true });

    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', PLAYLIST);
    await window.click('#renameOkBtn');
    const row = window.locator('.qa-playlist-item', { hasText: PLAYLIST });
    playlistId = parseInt(await row.getAttribute('data-list-id'), 10);
  });

  test.afterAll(async ({ window }) => {
    await window.evaluate(async ({ ids, listId }) => {
      for (const id of ids) await window.electronAPI.deleteItemWithFiles(id);
      await window.electronAPI.deletePlaylist(listId);
    }, { ids: itemIds, listId: playlistId });
  });

  test('switching away clears a search, and switching back restores it and the scroll', async ({ window }) => {
    await mainLibrary(window).click();
    await window.fill('.search-input', TERM);
    await window.press('.search-input', 'Enter');
    await expect(window.locator('.qa-search-song')).toHaveCount(SONGS);
    await window.locator('.explorer-container').evaluate((el) => { el.scrollTop = 300; });

    await playlist(window).click();
    await expect(title(window)).toHaveText(PLAYLIST);
    await expect(window.locator('.search-input')).toHaveValue('');

    await mainLibrary(window).click();
    await expect(title(window)).toHaveText('Search Results in Main Library');
    await expect(window.locator('.search-input')).toHaveValue(TERM);
    await expect.poll(() => scrollTop(window)).toBe(300);

    // Clicking the list you're already on resets it.
    await mainLibrary(window).click();
    await expect(title(window)).toHaveText('Main Library');
  });
});
