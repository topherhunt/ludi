const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');

test.describe('Sidebar collapse/expand all', () => {
  test('the sidebar icon buttons collapse and expand the list groups', async ({ window }) => {
    const stamp = Date.now();
    const album = `Collapse ${stamp}`;
    const files = [0, 1].map((i) => path.join(os.tmpdir(), `ludi-collapse-${stamp}-${i}.m4a`));
    files.forEach((f) => fs.copyFileSync(TONE, f));
    const itemIds = await window.evaluate(async ({ filePaths, album }) => {
      const { itemIds } = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      for (const item of await window.electronAPI.getListItems(0)) {
        if (itemIds.includes(item.id)) await window.electronAPI.updateSong({ songId: item.song_id, fields: { album } });
      }
      window.__ludiResetListViews({ 'list:0': { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] } });
      return itemIds;
    }, { filePaths: files, album });
    files.forEach((f) => fs.rmSync(f, { force: true }));

    await window.keyboard.press('Escape');
    await window.locator('.playlist-item').first().click();
    const chevron = window.locator('.qa-group-row').filter({ hasText: album }).locator('.chevron');
    await expect(chevron).toBeVisible({ timeout: 2000 });

    await window.locator('.qa-expand-all').click();
    await expect(chevron).toHaveClass(/expanded/);

    await window.locator('.qa-collapse-all').click();
    await expect(chevron).not.toHaveClass(/expanded/);

    await window.evaluate(async (ids) => {
      for (const id of ids) await window.electronAPI.deleteItemWithFiles(id);
    }, itemIds);
  });
});
