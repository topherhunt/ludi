const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

test.describe('Import', () => {
  test('should import folder and create matching folder structure in library', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-folder-${Date.now()}`);
    const subfolderDir = path.join(tempDir, 'subfolder');
    fs.mkdirSync(subfolderDir, { recursive: true });

    const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    const destPath1 = path.join(tempDir, 'song1.mp3');
    const destPath2 = path.join(subfolderDir, 'song2.mp3');
    fs.copyFileSync(testAudioPath, destPath1);
    fs.copyFileSync(testAudioPath, destPath2);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const importResult = await window.evaluate(async (folderPath) => {
      try {
        const result = await window.electronAPI.importFiles({
          filePaths: [folderPath],
          parentListId: 0,
          position: 0
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, tempDir);

    expect(importResult.success).toBe(true);
    expect(importResult.result.imported.length).toBe(2);

    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const folderName = path.basename(tempDir);
    const importedFolder = await window.locator(`.tree-item-content[data-is-folder="true"]`).filter({ hasText: folderName });
    await expect(importedFolder).toBeVisible({ timeout: 2000 });

    const chevron = importedFolder.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

    const subfolder = await window.locator('.tree-item-content[data-is-folder="true"]').filter({ hasText: 'subfolder' });
    await expect(subfolder).toBeVisible({ timeout: 1000 });

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    await importedFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });

  test('should show dialog when importing folder with unsupported files', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-unsupported-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    const destAudioPath = path.join(tempDir, 'valid-song.mp3');
    fs.copyFileSync(testAudioPath, destAudioPath);

    fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'This is a text file');
    fs.writeFileSync(path.join(tempDir, 'image.jpg'), 'fake image data');

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const importResult = await window.evaluate(async (folderPath) => {
      try {
        const result = await window.electronAPI.importFiles({
          filePaths: [folderPath],
          parentListId: 0,
          position: 0
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, tempDir);

    expect(importResult.success).toBe(true);
    expect(importResult.result.imported.length).toBe(1);
    expect(importResult.result.unsupported.length).toBe(2);
    expect(importResult.result.unsupported).toContain('readme.txt');
    expect(importResult.result.unsupported).toContain('image.jpg');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    await mainLibraryItem.click();
    await window.waitForTimeout(100);
    const folderName = path.basename(tempDir);
    const importedFolder = await window.locator(`.tree-item-content[data-is-folder="true"]`).filter({ hasText: folderName });
    if (await importedFolder.count() > 0) {
      await importedFolder.click();
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(100);
      await window.click('#modalYesBtn');
      await window.waitForTimeout(100);
    }
  });

  test('should import folder contents in alphabetical order', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-alpha-${Date.now()}`);
    fs.mkdirSync(path.join(tempDir, 'zebra-folder'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'alpha-folder'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'middle-folder'), { recursive: true });

    const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');
    fs.copyFileSync(testAudioPath, path.join(tempDir, 'zebra-folder', 'zebra-song.mp3'));
    fs.copyFileSync(testAudioPath, path.join(tempDir, 'alpha-folder', 'alpha-song.mp3'));
    fs.copyFileSync(testAudioPath, path.join(tempDir, 'middle-folder', 'middle-song.mp3'));

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    const importResult = await window.evaluate(async (folderPath) => {
      const result = await window.electronAPI.importFiles({
        filePaths: [folderPath],
        parentListId: 0,
        position: 0
      });
      return result;
    }, tempDir);

    expect(importResult.imported.length + importResult.errors.length).toBeGreaterThanOrEqual(1);

    await mainLibraryItem.click();
    await window.waitForTimeout(200);

    const folderName = path.basename(tempDir);
    const importedFolder = await window.locator(`.tree-item-content[data-is-folder="true"]`).filter({ hasText: folderName });
    await expect(importedFolder).toBeVisible({ timeout: 2000 });

    const chevron = importedFolder.locator('.tree-item-icon.chevron');
    await chevron.click();
    await window.waitForTimeout(100);

    const folderId = await importedFolder.getAttribute('data-folder-id');

    const children = await window.evaluate(async (listId) => {
      const items = await window.electronAPI.getListItems(parseInt(listId));
      return items.map(item => item.list_title);
    }, folderId);

    expect(children[0]).toBe('alpha-folder');
    expect(children[1]).toBe('middle-folder');
    expect(children[2]).toBe('zebra-folder');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    await importedFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
  });
});
