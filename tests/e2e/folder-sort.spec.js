const { test, expect } = require('./fixtures');

let seq = 0;
const uid = () => `${Date.now()}-${seq++}`;

// Right-click a folder, hover "Sort by...", click a submenu option.
async function sortFolderBy(window, folderTitle, optionText) {
  const row = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: folderTitle });
  await expect(row).toBeVisible({ timeout: 2000 });
  await row.click({ button: 'right' });
  await window.waitForTimeout(50);
  await window.locator('.context-menu-item.has-submenu').filter({ hasText: 'Sort by' }).hover();
  await window.waitForTimeout(50);
  await window.locator('.context-submenu .context-menu-item').filter({ hasText: optionText }).click();
  await window.waitForTimeout(200);
  return row;
}

async function deleteRow(window, row) {
  await row.click();
  await window.keyboard.press('Backspace');
  await window.waitForTimeout(100);
  await window.click('#modalYesBtn');
  await window.waitForTimeout(100);
}

test.describe('Folder: Sort by...', () => {
  test('Title (alphabetical): folders above songs', async ({ window }) => {
    const id = uid();
    const parentId = await window.evaluate(async (suffix) => {
      const pid = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'SortParent' });
      await window.electronAPI.addFolder({ parentListId: pid, position: 0, title: 'Zebra' });
      await window.electronAPI.addFolder({ parentListId: pid, position: 1, title: 'Alpha' });
      const sid = await window.electronAPI.addSong({
        filePath: `fake/sort-${suffix}.mp3`, title: 'Song', artist: 'X', album: 'Y', durationSeconds: 100, trackNumber: 1,
      });
      await window.electronAPI.addSongToList({ songId: sid, parentListId: pid, position: 0 });
      return pid;
    }, id);

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(200);

    const row = await sortFolderBy(window, 'SortParent', 'Title (alphabetical)');

    const order = await window.evaluate(async (pid) => {
      const items = await window.electronAPI.getListItems(pid);
      return items.map((i) => (i.list_id !== null ? `folder:${i.list_title}` : 'song'));
    }, parentId);
    expect(order).toEqual(['folder:Alpha', 'folder:Zebra', 'song']);

    await deleteRow(window, row);
  });

  test('Artist, album, track #, title', async ({ window }) => {
    const id = uid();
    const parentId = await window.evaluate(async (suffix) => {
      const pid = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'ArtistSortParent' });
      const mk = async (fp, title, artist, album, track, pos) => {
        const sid = await window.electronAPI.addSong({ filePath: fp, title, artist, album, durationSeconds: 100, trackNumber: track });
        await window.electronAPI.addSongToList({ songId: sid, parentListId: pid, position: pos });
      };
      // Added scrambled; expected sorted order is Mango, Apple, Zed.
      await mk(`fake/z-${suffix}.mp3`, 'Zed', 'Beatles', 'Abbey Road', 2, 0);
      await mk(`fake/a-${suffix}.mp3`, 'Apple', 'Beatles', 'Abbey Road', 1, 1);
      await mk(`fake/m-${suffix}.mp3`, 'Mango', 'ABBA', 'Gold', 1, 2);
      return pid;
    }, id);

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(200);

    const row = await sortFolderBy(window, 'ArtistSortParent', 'Artist, album, track');

    const titles = await window.evaluate(async (pid) => {
      const items = await window.electronAPI.getListItems(pid);
      return items.map((i) => i.song_title);
    }, parentId);
    expect(titles).toEqual(['Mango', 'Apple', 'Zed']);

    await deleteRow(window, row);
  });
});
