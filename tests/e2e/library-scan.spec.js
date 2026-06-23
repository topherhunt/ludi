const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');

test.describe('Library scan', () => {
  test('scans the library folder and ingests new files in place, grouped by artist/album', async ({ window }) => {
    const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

    // Drop a file DIRECTLY into the library folder (not via the importer, so it
    // is not copied/reorganized and is not yet in the database).
    const libraryPath = await window.evaluate(async () => {
      const settings = await window.electronAPI.getSettings();
      return settings.library_path;
    });
    const dropDir = path.join(libraryPath, 'ScanTest');
    fs.mkdirSync(dropDir, { recursive: true });
    const droppedFile = path.join(dropDir, 'dropped-song.mp3');
    fs.copyFileSync(testAudioPath, droppedFile);
    const relativePath = path.join('ScanTest', 'dropped-song.mp3');

    // Show Main Library first so we can later confirm the tree auto-refreshes.
    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(100);

    // The scan must surface the dropped file.
    const scanned = await window.evaluate(() => window.electronAPI.scanLibraryForNewFiles());
    expect(scanned).toContain(relativePath);

    // Ingest it in place.
    const result = await window.evaluate((paths) => window.electronAPI.ingestFilesInPlace(paths), [relativePath]);
    expect(result.imported.length).toBe(1);
    expect(result.imported[0].file_path).toBe(relativePath);
    const { artist, album } = result.imported[0];
    const expectedFolderTitle = `${artist} - ${album}`;

    // The original file stays exactly where it was dropped (ingest in place = no move).
    expect(fs.existsSync(droppedFile)).toBe(true);

    // A second scan must no longer report it (it is now ingested).
    const rescanned = await window.evaluate(() => window.electronAPI.scanLibraryForNewFiles());
    expect(rescanned).not.toContain(relativePath);

    // The song must live in a new "{artist} - {album}" folder under Main Library,
    // and its stored path must remain the in-place relative path.
    const placement = await window.evaluate(async (rel) => {
      const items = await window.electronAPI.getListItems(0);
      for (const item of items) {
        if (item.list_id === null) continue;
        const children = await window.electronAPI.getListItems(item.list_id);
        for (const child of children) {
          if (child.song_id === null) continue;
          const song = await window.electronAPI.getSong(child.song_id);
          if (song && song.file_path.endsWith(rel)) {
            return { folderTitle: item.list_title, songTitle: child.song_title };
          }
        }
      }
      return null;
    }, relativePath);

    expect(placement).not.toBeNull();
    expect(placement.folderTitle).toBe(expectedFolderTitle);

    // The main window's tree auto-refreshed (no manual re-click) and shows the folder.
    const importedFolder = window
      .locator('.tree-item-content[data-is-folder="true"]')
      .filter({ hasText: expectedFolderTitle });
    await expect(importedFolder.first()).toBeVisible({ timeout: 2000 });

    // Clean up: remove the folder from the tree and the dropped file from disk.
    await importedFolder.first().click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
    fs.rmSync(dropDir, { recursive: true, force: true });
  });
});
