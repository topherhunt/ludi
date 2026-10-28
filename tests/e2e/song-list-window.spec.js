const { test, expect } = require('./fixtures');
const path = require('path');

// The song list renders only the rows in and near view. These run on a playlist
// of 300 songs, seeded straight into the database (the files never play).

const DATABASE_MODULE = path.join(__dirname, '../../src/main/database.js');
const COUNT = 300;
const PLAYLIST = `Long List ${Date.now()}`;
const title = (i) => `Long ${String(i).padStart(3, '0')}`;

let playlistId = null;

const container = (window) => window.locator('#explorerContainer');
const songRows = (window) => window.locator('.qa-song-row');
const songRow = (window, i) => songRows(window).filter({ hasText: title(i) });
const scrollTo = (window, top) => container(window).evaluate((el, top) => { el.scrollTop = top; }, top);

async function openPlaylist(window) {
  await window.keyboard.press('Escape');
  await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();
  await expect(songRows(window).first()).toBeVisible({ timeout: 2000 });
  // Coming back to a list restores where it was scrolled to.
  await scrollTo(window, 0);
  await expect(songRow(window, 0)).toBeVisible();
}

test.describe('Long song lists', () => {
  test.beforeAll(async ({ window, electronApp }) => {
    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', PLAYLIST);
    await window.click('#renameOkBtn');
    const playlist = window.locator('.qa-playlist-item').filter({ hasText: PLAYLIST });
    await expect(playlist).toBeVisible({ timeout: 2000 });
    playlistId = parseInt(await playlist.getAttribute('data-list-id'));

    await electronApp.evaluate((unused, { modulePath, listId, titles }) => {
      const db = process.mainModule.require(modulePath);
      titles.forEach((songTitle, i) => {
        const songId = db.addSong(`/nonexistent/${songTitle}.m4a`, songTitle, 'Long Artist', 'Long Album', 200, i + 1);
        db.addSongToList(songId, listId, i);
      });
    }, { modulePath: DATABASE_MODULE, listId: playlistId, titles: Array.from({ length: COUNT }, (_, i) => title(i)) });
  });

  test('renders only the rows near the view, and scrolling to the end brings the last ones in', async ({ window }) => {
    await openPlaylist(window);
    expect(await songRows(window).count()).toBeLessThan(COUNT / 2);
    await expect(songRow(window, COUNT - 1)).toHaveCount(0);

    await scrollTo(window, 1e6);
    await expect(songRow(window, COUNT - 1)).toBeVisible();
    await expect(songRow(window, 0)).toHaveCount(0);
    expect(await songRows(window).count()).toBeLessThan(COUNT / 2);
  });

  test('every row is one fixed height, so the list is as tall as all its rows', async ({ window }) => {
    await openPlaylist(window);
    const heights = await songRows(window).evaluateAll((els) => [...new Set(els.map((el) => el.getBoundingClientRect().height))]);
    expect(heights).toEqual([28]);
    const listHeight = await window.locator('#explorerTree').evaluate((el) => el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) * 2);
    expect(listHeight).toBe(COUNT * 28);
  });

  test('shift-click selects a range through rows scrolled out of view', async ({ window }) => {
    await openPlaylist(window);
    await songRow(window, 0).click();
    await scrollTo(window, 1e6);
    await songRow(window, COUNT - 1).click({ modifiers: ['Shift'] });

    await scrollTo(window, (COUNT / 2) * 28);
    await expect(songRow(window, COUNT / 2)).toHaveClass(/selected/);
    expect(await window.locator('.qa-song-row:not(.selected)').count()).toBe(0);
  });

  test('arrow keys walk past the rendered rows and keep the selection in view', async ({ window }) => {
    await openPlaylist(window);
    await songRow(window, 0).click();
    for (let i = 0; i < 60; i++) await window.keyboard.press('ArrowDown');

    await expect(songRow(window, 60)).toHaveClass(/selected/);
    await expect(songRow(window, 60)).toBeInViewport();
    await expect(songRow(window, 0)).toHaveCount(0);
  });

  test('a drag that autoscrolls its own row out of the list still ends cleanly', async ({ window }) => {
    await openPlaylist(window);
    const source = await songRow(window, 0).boundingBox();
    const box = await container(window).boundingBox();
    await window.mouse.move(source.x + 40, source.y + source.height / 2);
    await window.mouse.down();
    await window.mouse.move(source.x + 40, box.y + box.height - 2, { steps: 5 });
    await expect(songRow(window, 0)).toHaveCount(0, { timeout: 2000 });
    await window.mouse.move(source.x + 40, box.y + box.height / 2, { steps: 2 });
    await window.mouse.up();

    await scrollTo(window, 0);
    await expect(window.locator('.qa-song-row').first()).toBeVisible();
    await expect(window.locator('.qa-song-row.dragging')).toHaveCount(0);
  });
});
