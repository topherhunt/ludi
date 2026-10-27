const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MP3 = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

// Imported folders are kept in the database but not shown, so these tests look
// up the folder placement through the API.
const folderItemNamed = (window, title) =>
  window.evaluate(async (title) => {
    const items = await window.electronAPI.getListItems(0);
    return items.find((it) => it.list_title === title);
  }, title);

const deleteItem = (window, itemId) =>
  window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), itemId);

test.describe('Import', () => {
  test('importing a folder keeps its structure and lists every song inside it', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-folder-${Date.now()}`);
    const subfolderDir = path.join(tempDir, 'subfolder');
    fs.mkdirSync(subfolderDir, { recursive: true });
    fs.copyFileSync(MP3, path.join(tempDir, 'song1.mp3'));
    fs.copyFileSync(MP3, path.join(subfolderDir, 'song2.mp3'));

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();

    const result = await window.evaluate(
      (folderPath) => window.electronAPI.importFiles({ filePaths: [folderPath], parentListId: 0, position: 0 }),
      tempDir
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
    expect(result.imported.length).toBe(2);

    const folder = await folderItemNamed(window, path.basename(tempDir));
    const children = await window.evaluate((id) => window.electronAPI.getListItems(id), folder.list_id);
    expect(children.map((c) => c.list_title || c.song_title)).toContain('subfolder');

    // Both songs show in the library, the nested one included.
    await mainLibraryItem.click();
    const songIds = await window.evaluate(async (listId) => {
      const all = await window.electronAPI.getAllListItems();
      const under = new Set([listId]);
      for (const it of all) if (it.list_id && under.has(it.parent_list_id)) under.add(it.list_id);
      return all.filter((it) => it.song_id && under.has(it.parent_list_id)).map((it) => it.song_id);
    }, folder.list_id);
    expect(songIds).toHaveLength(2);
    for (const id of songIds) {
      await expect(window.locator(`.qa-song-row[data-song-id="${id}"]`)).toHaveCount(1, { timeout: 2000 });
    }

    await deleteItem(window, folder.id);
  });

  test('should show dialog when importing folder with unsupported files', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-unsupported-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(MP3, path.join(tempDir, 'valid-song.mp3'));
    fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'This is a text file');
    fs.writeFileSync(path.join(tempDir, 'image.jpg'), 'fake image data');

    const result = await window.evaluate(
      (folderPath) => window.electronAPI.importFiles({ filePaths: [folderPath], parentListId: 0, position: 0 }),
      tempDir
    );
    fs.rmSync(tempDir, { recursive: true, force: true });

    expect(result.imported.length).toBe(1);
    expect(result.unsupported.length).toBe(2);
    expect(result.unsupported).toContain('readme.txt');
    expect(result.unsupported).toContain('image.jpg');

    await deleteItem(window, (await folderItemNamed(window, path.basename(tempDir))).id);
  });

  test('should import folder contents in alphabetical order', async ({ window }) => {
    const tempDir = path.join(os.tmpdir(), `ludi-test-alpha-${Date.now()}`);
    for (const name of ['zebra', 'alpha', 'middle']) {
      fs.mkdirSync(path.join(tempDir, `${name}-folder`), { recursive: true });
      fs.copyFileSync(MP3, path.join(tempDir, `${name}-folder`, `${name}-song.mp3`));
    }

    await window.evaluate(
      (folderPath) => window.electronAPI.importFiles({ filePaths: [folderPath], parentListId: 0, position: 0 }),
      tempDir
    );
    fs.rmSync(tempDir, { recursive: true, force: true });

    const folder = await folderItemNamed(window, path.basename(tempDir));
    const children = await window.evaluate((id) => window.electronAPI.getListItems(id), folder.list_id);
    expect(children.map((c) => c.list_title)).toEqual(['alpha-folder', 'middle-folder', 'zebra-folder']);

    await deleteItem(window, folder.id);
  });
});
