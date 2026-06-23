const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

test.describe('M4A playback', () => {
  test('plays an .m4a file instead of reporting "File Not Found"', async ({ window }) => {
    // Import a uniquely-named copy of the m4a fixture (avoids duplicate-skip).
    const uniqueFile = path.join(os.tmpdir(), `ludi-m4a-${Date.now()}.m4a`);
    fs.copyFileSync(path.join(testAudioDir, 'test-tone.m4a'), uniqueFile);

    const importResult = await window.evaluate(
      (fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }),
      uniqueFile
    );
    expect(importResult.imported.length).toBe(1);
    const songId = importResult.imported[0].songId;

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(150);

    const songRow = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    await expect(songRow).toBeVisible({ timeout: 2000 });
    await songRow.dblclick();

    // Before the fix the m4a was served as audio/mpeg, failed to decode, and
    // popped a "File Not Found" modal. Now it should actually play.
    const playPauseBtn = window.locator('#playPauseBtn');
    await expect(playPauseBtn).toHaveClass(/playing/, { timeout: 4000 });
    await expect(window.locator('.modal-title').filter({ hasText: 'File Not Found' })).toHaveCount(0);

    // Pause + cleanup
    await playPauseBtn.click();
    await window.waitForTimeout(50);
    await songRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
    fs.rmSync(uniqueFile, { force: true });
  });
});
