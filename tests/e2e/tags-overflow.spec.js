const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

// Auto-tagging a real library produces dozens of tags at once. The sidebar used
// to be a stack of siblings with the scroll on the playlist tree alone, so a
// long chip list pushed the song edit panel and the analysis strip below the
// bottom of the window, where there was no way to reach them.

const SONG_ROW = '.tree-item-content[data-is-folder="false"]';
const TAG_COUNT = 40;
const STAMP = Date.now();

let tagIds = [];

const chipCount = (window) =>
  window.locator('.qa-tags-section .tag-pill').count();

// One scroll region, not two: the chips are shown in full and the sidebar's own
// scroll is what pays for them.
const tagsListScrolls = (window) =>
  window.evaluate(() => {
    const el = document.querySelector('.tags-list');
    return el.scrollHeight > el.clientHeight + 1
      || ['auto', 'scroll'].includes(getComputedStyle(el).overflowY);
  });

// The tree gives back empty space it was filling, but must never be squeezed
// below its own rows -- that's what "the tags don't cost you the tree" means.
const treeFitsItsRows = (window) =>
  window.evaluate(() => {
    const el = document.querySelector('.playlist-list');
    return el.getBoundingClientRect().height + 1 >= el.scrollHeight;
  });

const sidebarScrolls = (window) =>
  window.evaluate(() => {
    const el = document.querySelector('.qa-sidebar-scroll');
    return el.scrollHeight > el.clientHeight;
  });

// Whether the whole panel sits inside the window, which is the thing this all
// exists to guarantee.
const editPanelOnScreen = (window) =>
  window.evaluate(() => {
    const box = document.querySelector('.qa-song-edit-panel').getBoundingClientRect();
    return box.bottom <= window.innerHeight + 1;
  });

test.describe('Sidebar tag overflow', () => {
  test.beforeAll(async ({ window }) => {
    const file = path.join(testAudioDir, 'test-tone.m4a');
    tagIds = await window.evaluate(async ({ filePath, count, stamp }) => {
      try {
        await window.electronAPI.importFiles({ filePaths: [filePath], parentListId: 0, position: 0 });
      } catch { /* already imported by an earlier spec */ }
      const items = await window.electronAPI.getListItems(0);
      const songIds = items.filter((it) => it.song_id).map((it) => it.song_id);
      const ids = [];
      for (let i = 0; i < count; i++) {
        const tag = await window.electronAPI.createTag({ name: `overflow-${stamp}-${i}`, color: '#888888' });
        await window.electronAPI.addTagToSongs({ tagId: tag.id, songIds });
        ids.push(tag.id);
      }
      return ids;
    }, { filePath: file, count: TAG_COUNT, stamp: STAMP });

    expect(tagIds).toHaveLength(TAG_COUNT);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(500);
  });

  test.afterAll(async ({ window }) => {
    await window.evaluate(async (ids) => {
      for (const id of ids) await window.electronAPI.deleteTag(id);
    }, tagIds);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(500);
  });

  test('forty tags leave the song edit panel fully on screen', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator('.playlist-item').first().click();
    await window.locator(SONG_ROW).first().click();
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

    expect(await editPanelOnScreen(window)).toBe(true);
  });

  test('every chip is shown, paid for by the sidebar scroll and not by the tree', async ({ window }) => {
    await window.keyboard.press('Escape');
    await window.locator('.playlist-item').first().click();
    await window.locator(SONG_ROW).first().click();

    // Nothing hidden and nothing capped: all forty are there, in one list with
    // no scrollbar of its own.
    expect(await chipCount(window)).toBeGreaterThanOrEqual(TAG_COUNT);
    expect(await tagsListScrolls(window)).toBe(false);

    // The chips that no longer fit go into the sidebar's scroll region -- not
    // into the playlist tree's height, and not into the edit panel's.
    expect(await sidebarScrolls(window)).toBe(true);
    expect(await treeFitsItsRows(window)).toBe(true);
    expect(await editPanelOnScreen(window)).toBe(true);
  });
});
