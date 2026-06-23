const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MP3 = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

test.describe('Sidebar collapse/expand all', () => {
  test('the sidebar icon buttons collapse and expand explorer folders', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-collapse-${Date.now()}`);
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

    // The buttons live in the sidebar header.
    await expect(window.locator('.qa-collapse-all')).toBeVisible();
    await expect(window.locator('.qa-expand-all')).toBeVisible();

    // Expand all -> the folder is expanded.
    await window.locator('.qa-expand-all').click();
    await expect(chevron).toHaveClass(/expanded/, { timeout: 2000 });

    // Collapse all -> the folder is collapsed again.
    await window.locator('.qa-collapse-all').click();
    await expect(chevron).not.toHaveClass(/expanded/, { timeout: 2000 });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    await folderRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
