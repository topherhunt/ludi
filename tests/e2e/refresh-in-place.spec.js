const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Refreshing a song list (after a tag edit, a playlist drop, an import...) must
// patch the rows that changed and leave the rest of the view exactly where it
// was. Rebuilding the list instead blanked it for a frame: the view blinked and
// the scroll position jumped back to the top.

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();
const LIST_NAME = `RIP List ${STAMP}`;
const TARGET_NAME = `RIP Target ${STAMP}`;

// Enough folder rows above the song that the list has somewhere to scroll.
const FILLER_FOLDERS = 30;

let song = null;    // { songId, itemId }
let targetId = null;

const playlistRow = (window, name) =>
  window.locator('.qa-playlist-item').filter({ hasText: name });

const songRow = (window) =>
  window.locator(`.tree-item-content[data-song-id="${song.songId}"]`);

async function makePlaylist(window, name) {
  await window.keyboard.press('Escape');
  await window.click('#addLibraryBtn');
  await window.click('#newPlaylistMenuItem');
  await window.fill('#renameInput', name);
  await window.click('#renameOkBtn');
  await expect(playlistRow(window, name)).toBeVisible({ timeout: 2000 });
  await window.waitForTimeout(150);
  return parseInt(await playlistRow(window, name).getAttribute('data-list-id'));
}

async function openList(window, name) {
  await playlistRow(window, name).click();
  await window.waitForTimeout(200);
}

// Stamp every rendered row. The marks live on the DOM nodes themselves, so a
// row that survives a refresh keeps its mark and a re-created one loses it --
// which is exactly the difference between patching and rebuilding.
const markRows = (window) =>
  window.evaluate(() => {
    const rows = document.querySelectorAll('#explorerTree .tree-item-content');
    rows.forEach((el) => { el.dataset.qaMark = '1'; });
    return rows.length;
  });

const markedRows = (window) =>
  window.locator('#explorerTree .tree-item-content[data-qa-mark="1"]');

const scrollToBottom = (window) =>
  window.evaluate(() => {
    const c = document.getElementById('explorerContainer');
    c.scrollTop = c.scrollHeight;
    return c.scrollTop;
  });

const scrollTop = (window) =>
  window.evaluate(() => document.getElementById('explorerContainer').scrollTop);

test.describe('Refreshing a list in place', () => {
  test.beforeAll(async ({ window }) => {
    const src = path.join(os.tmpdir(), `ludi-rip-${STAMP}.m4a`);
    fs.copyFileSync(TONE, src);
    song = await window.evaluate(async (fp) => {
      const result = await window.electronAPI.importFiles({
        filePaths: [fp], parentListId: 0, position: 0,
      });
      return { songId: result.imported[0].songId, itemId: result.imported[0].itemId };
    }, src);
    fs.unlinkSync(src);

    const listId = await makePlaylist(window, LIST_NAME);
    targetId = await makePlaylist(window, TARGET_NAME);

    // A tall list: filler folders first, then the song as the last row, so it is
    // on screen once the list is scrolled to the bottom.
    await window.evaluate(async ({ listId, itemId, count }) => {
      for (let i = 0; i < count; i++) {
        await window.electronAPI.addFolder({ parentListId: listId, position: i, title: `RIP F${i}` });
      }
      await window.electronAPI.copyItemsToList({ itemIds: [itemId], targetListId: listId, skipSongIds: [] });
    }, { listId, itemId: song.itemId, count: FILLER_FOLDERS });
  });

  test.afterAll(async ({ window }) => {
    // Through the UI, so the sidebar the next spec inherits matches the database.
    for (const name of [LIST_NAME, TARGET_NAME]) {
      const row = playlistRow(window, name);
      await row.click({ button: 'right' });
      await window.click('.qa-playlist-delete');
      await window.click('#modalYesBtn');
      await expect(row).toHaveCount(0, { timeout: 2000 });
    }
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), song.itemId);
  });

  test('applying a tag adds the pill without rebuilding the rows or moving the scroll', async ({ window }) => {
    await openList(window, LIST_NAME);
    await songRow(window).click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

    const scrolled = await scrollToBottom(window);
    expect(scrolled).toBeGreaterThan(0); // the list really is scrollable
    const rowCount = await markRows(window);
    expect(rowCount).toBe(FILLER_FOLDERS + 1);

    const tagName = `rip-${STAMP}`;
    const input = window.locator('.qa-tag-input');
    await input.click();
    await input.fill(tagName);
    await window.locator('.qa-tag-create').click();

    // The pill lands inside the existing row...
    await expect(songRow(window).locator('.col-tags .tag-pill').filter({ hasText: tagName }))
      .toBeVisible({ timeout: 2000 });

    // ...which is still the very same element, as is every other row...
    await expect(markedRows(window)).toHaveCount(rowCount);
    await expect(songRow(window)).toHaveAttribute('data-qa-mark', '1');

    // ...and the list did not jump back to the top.
    expect(await scrollTop(window)).toBe(scrolled);
  });

  test('dropping songs on a sidebar playlist leaves the list scrolled where it was', async ({ window }) => {
    await openList(window, LIST_NAME);
    await songRow(window).click();

    const scrolled = await scrollToBottom(window);
    expect(scrolled).toBeGreaterThan(0);
    const rowCount = await markRows(window);

    // Dispatched rather than mouse-driven: a real drag across the tree would
    // trip the drag autoscroll, which moves the scroll position by design.
    await window.evaluate(({ songId, targetName }) => {
      const row = document.querySelector(`.tree-item-content[data-song-id="${songId}"]`);
      const target = [...document.querySelectorAll('.qa-playlist-item')]
        .find((el) => el.textContent === targetName);
      const dt = new DataTransfer();
      const fire = (el, type) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(row, 'dragstart');
      fire(target, 'dragover');
      fire(target, 'drop');
      fire(row, 'dragend');
    }, { songId: song.songId, targetName: TARGET_NAME });

    // The copy landed...
    await expect.poll(
      () => window.evaluate((id) => window.electronAPI.getListItems(id).then(items => items.length), targetId),
      { timeout: 2000 }
    ).toBe(1);
    await window.waitForTimeout(200); // let the refresh the copy triggers settle

    // ...without disturbing the list it was dragged out of.
    await expect(markedRows(window)).toHaveCount(rowCount);
    expect(await scrollTop(window)).toBe(scrolled);
  });
});
