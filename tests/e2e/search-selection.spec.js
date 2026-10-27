const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// The tone carries no ID3 title, so each copy's filename becomes its title.
// This term therefore matches exactly the three songs imported below and nothing
// else other specs have left in the shared test library.
const TERM = `ludisel${STAMP}`;

let imported = []; // [{ songId, itemId }] in import order

async function runSearch(window) {
  await window.keyboard.press('Escape');
  await window.locator('.qa-playlist-item[data-list-id="0"]').click();
  await window.waitForTimeout(150);
  const input = window.locator('.search-input');
  await input.fill(TERM);
  await input.press('Enter');
  await expect(window.locator('.qa-song-row')).toHaveCount(3, { timeout: 2000 });
}

async function dragOnto(window, source, target) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  await window.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await window.mouse.down();
  await window.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await window.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await window.waitForTimeout(100);
  await window.mouse.up();
  await window.waitForTimeout(250);
}

test.describe('Search result selection', () => {
  test.beforeAll(async ({ window }) => {
    const sources = ['a', 'b', 'c'].map((suffix) => {
      const src = path.join(os.tmpdir(), `${TERM}-${suffix}.m4a`);
      fs.copyFileSync(TONE, src);
      return src;
    });

    imported = await window.evaluate(async (filePaths) => {
      const result = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      return result.imported;
    }, sources);

    sources.forEach((src) => fs.unlinkSync(src));
    expect(imported).toHaveLength(3);
  });

  test.afterAll(async ({ window }) => {
    for (const item of imported) {
      await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), item.itemId);
    }
  });

  test('click, CMD-click and SHIFT-click select rows in the search results', async ({ window }) => {
    await runSearch(window);
    const rows = window.locator('.qa-song-row');
    const selected = window.locator('.qa-song-row.selected');

    await rows.nth(0).click();
    await expect(selected).toHaveCount(1);
    await expect(rows.nth(0)).toHaveClass(/selected/);

    // CMD adds a non-adjacent row without touching the one between them.
    await rows.nth(2).click({ modifiers: ['Meta'] });
    await expect(selected).toHaveCount(2);
    await expect(rows.nth(1)).not.toHaveClass(/selected/);

    // ...and CMD-clicking it again toggles it back off.
    await rows.nth(2).click({ modifiers: ['Meta'] });
    await expect(selected).toHaveCount(1);

    // SHIFT extends from the last click through the clicked row.
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await expect(selected).toHaveCount(3);

    // Clicking empty space below the results clears the selection. (Just below
    // the last row: the container's bottom edge can be a horizontal scrollbar,
    // and pressing a scrollbar never fires a click.)
    const last = await rows.nth(2).boundingBox();
    await window.mouse.click(last.x + 50, last.y + last.height + 30);
    await expect(selected).toHaveCount(0);

    await window.locator('.search-clear-btn').click();
  });

  test('a multi-song selection can be dragged from search results into a playlist', async ({ window }) => {
    const name = `Search Drag ${STAMP}`;
    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', name);
    await window.click('#renameOkBtn');
    const playlist = window.locator('.qa-playlist-item').filter({ hasText: name });
    await expect(playlist).toBeVisible({ timeout: 2000 });
    const listId = parseInt(await playlist.getAttribute('data-list-id'));

    await runSearch(window);
    const rows = window.locator('.qa-song-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Meta'] });
    await expect(window.locator('.qa-song-row.selected')).toHaveCount(2);

    // Dragging any selected row carries the whole selection.
    await dragOnto(window, rows.nth(0), playlist);

    const copied = await window.evaluate((id) => window.electronAPI.getListItems(id), listId);
    expect(copied).toHaveLength(2);
    const draggedSongIds = await rows.evaluateAll((els) =>
      els.slice(0, 2).map((el) => parseInt(el.dataset.songId))
    );
    expect(copied.map((i) => i.song_id).sort()).toEqual(draggedSongIds.sort());

    // Copying never removes the originals.
    const mainLibrary = await window.evaluate(() => window.electronAPI.getListItems(0));
    for (const item of imported) {
      expect(mainLibrary.some((i) => i.id === item.itemId)).toBe(true);
    }

    await window.locator('.search-clear-btn').click();
    await playlist.click({ button: 'right' });
    await window.click('.qa-playlist-delete');
    await window.click('#modalYesBtn');
    await expect(playlist).toHaveCount(0, { timeout: 2000 });
  });
});
