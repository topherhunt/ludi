const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MP3 = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

test.describe('Chevron double-click', () => {
  test('double-clicking the caret toggles but does not start playback', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-chevron-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(MP3, path.join(tempDir, 'inside.mp3'));

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);
    await window.evaluate((fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }), tempDir);
    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const folderName = path.basename(tempDir);
    const folderRow = window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: folderName });
    await expect(folderRow).toBeVisible({ timeout: 2000 });
    const chevron = folderRow.locator('.tree-item-icon.chevron');
    const playPauseBtn = window.locator('#playPauseBtn');

    // Double-clicking the caret must NOT start playback.
    await chevron.dblclick();
    await window.waitForTimeout(400);
    await expect(playPauseBtn).not.toHaveClass(/playing/);

    // Sanity: double-clicking the folder label still starts playback (proves the
    // row's dblclick handler is intact and only the caret is exempt).
    await folderRow.locator('.tree-item-label').dblclick();
    await expect(playPauseBtn).toHaveClass(/playing/, { timeout: 3000 });

    // Pause + cleanup
    await playPauseBtn.click();
    await window.waitForTimeout(50);
    fs.rmSync(tempDir, { recursive: true, force: true });
    await folderRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
