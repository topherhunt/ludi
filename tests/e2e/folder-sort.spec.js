const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MP3 = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

let seq = 0;
function uniqueCopy(label) {
  const p = path.join(os.tmpdir(), `ludi-${label}-${Date.now()}-${seq++}.mp3`);
  fs.copyFileSync(MP3, p);
  return p;
}

test.describe('Folder: Sort alphabetically', () => {
  test('orders folders above songs, each alphabetical', async ({ window }) => {
    const songFile = uniqueCopy('sort-song');

    // Build SortParent with subfolders [Zebra, Alpha] and a song inserted on top.
    const parentId = await window.evaluate(async (file) => {
      const pid = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'SortParent' });
      await window.electronAPI.addFolder({ parentListId: pid, position: 0, title: 'Zebra' });
      await window.electronAPI.addFolder({ parentListId: pid, position: 1, title: 'Alpha' });
      await window.electronAPI.importFiles({ filePaths: [file], parentListId: pid, position: 0 });
      return pid;
    }, songFile);

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const parentRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: 'SortParent' });
    await expect(parentRow).toBeVisible({ timeout: 2000 });
    await parentRow.click({ button: 'right' });
    await window.waitForTimeout(50);
    await window.locator('.context-menu-item').filter({ hasText: 'Sort alphabetically' }).click();
    await window.waitForTimeout(200);

    const order = await window.evaluate(async (pid) => {
      const items = await window.electronAPI.getListItems(pid);
      return items.map((i) => (i.list_id !== null ? `folder:${i.list_title}` : 'song'));
    }, parentId);

    expect(order).toEqual(['folder:Alpha', 'folder:Zebra', 'song']);

    // Cleanup
    await parentRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
    fs.rmSync(songFile, { force: true });
  });
});
