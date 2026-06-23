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

test.describe('Folder: Flatten', () => {
  test('moves subfolder contents into the folder in order, deleting subfolders', async ({ window }) => {
    // Distinct filenames so we can verify ordering (the embedded title tag is identical).
    const fTop = uniqueCopy('flat-alpha');
    const fA = uniqueCopy('flat-bravo');
    const fB = uniqueCopy('flat-charlie');

    // FlattenParent = [ song(alpha), Sub = [ song(bravo), song(charlie) ] ]
    const parentId = await window.evaluate(async (files) => {
      const pid = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'FlattenParent' });
      await window.electronAPI.importFiles({ filePaths: [files.top], parentListId: pid, position: 0 });
      const subId = await window.electronAPI.addFolder({ parentListId: pid, position: 1, title: 'Sub' });
      await window.electronAPI.importFiles({ filePaths: [files.a], parentListId: subId, position: 0 });
      await window.electronAPI.importFiles({ filePaths: [files.b], parentListId: subId, position: 1 });
      return pid;
    }, { top: fTop, a: fA, b: fB });

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const parentRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: 'FlattenParent' });
    await expect(parentRow).toBeVisible({ timeout: 2000 });
    await parentRow.click({ button: 'right' });
    await window.waitForTimeout(50);
    await window.locator('.context-menu-item').filter({ hasText: 'Flatten' }).click();
    await window.waitForTimeout(250);

    // All three songs are now direct children, in depth-first order; no subfolder remains.
    const order = await window.evaluate(async (pid) => {
      const items = await window.electronAPI.getListItems(pid);
      const out = [];
      for (const i of items) {
        if (i.song_id !== null) {
          const s = await window.electronAPI.getSong(i.song_id);
          out.push(s.file_path);
        } else {
          out.push('FOLDER');
        }
      }
      return out;
    }, parentId);

    expect(order.length).toBe(3);
    expect(order).not.toContain('FOLDER');
    expect(order[0]).toContain('alpha');
    expect(order[1]).toContain('bravo');
    expect(order[2]).toContain('charlie');

    // Cleanup
    await parentRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
    [fTop, fA, fB].forEach((f) => fs.rmSync(f, { force: true }));
  });
});
