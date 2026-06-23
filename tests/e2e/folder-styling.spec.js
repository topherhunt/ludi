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

async function deleteFolderRow(window, row) {
  await row.click();
  await window.keyboard.press('Backspace');
  await window.waitForTimeout(100);
  await window.click('#modalYesBtn');
  await window.waitForTimeout(100);
}

test.describe('Folder styling', () => {
  test('empty folders are dimmed and folder titles are bold', async ({ window }) => {
    const songFile = uniqueCopy('style-song');

    await window.evaluate(async (file) => {
      await window.electronAPI.addFolder({ parentListId: 0, position: 0, title: 'EmptyStyleFolder' });
      const fullId = await window.electronAPI.addFolder({ parentListId: 0, position: 1, title: 'FullStyleFolder' });
      await window.electronAPI.importFiles({ filePaths: [file], parentListId: fullId, position: 0 });
    }, songFile);

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const emptyRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: 'EmptyStyleFolder' });
    const fullRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: 'FullStyleFolder' });
    await expect(emptyRow).toBeVisible({ timeout: 2000 });

    // Empty folder is dimmed; the one with a song is not.
    await expect(emptyRow).toHaveClass(/folder-empty/, { timeout: 2000 });
    await expect(fullRow).not.toHaveClass(/folder-empty/);

    // Folder titles render bold.
    const weight = await fullRow.locator('.tree-item-label').evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight).toBe('700');

    // Cleanup
    await deleteFolderRow(window, emptyRow);
    await deleteFolderRow(window, fullRow);
    fs.rmSync(songFile, { force: true });
  });
});
