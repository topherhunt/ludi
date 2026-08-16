const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();

// Option-dragging a selection out to the Desktop or a Finder folder hands the OS
// the audio files behind it. The gesture itself (Electron's startDrag) can't run
// without a live mouse-down, so what's covered here is the part that decides
// WHICH files get handed over: folder recursion, dedupe, order, absolute paths.
// The dragstart branch that calls it is covered in tests/unit/dragOut.test.js.
test.describe('Drag out to Finder', () => {
  let folderItemId = null;
  let loose = null; // { itemId, absPath }
  let inFolder = []; // [{ itemId, absPath }] in folder order

  // Import one fresh copy of the tone; a unique filename makes it its own songs
  // row rather than a duplicate of what other specs imported.
  async function importInto(window, listId, label) {
    const src = path.join(os.tmpdir(), `ludi-out-${label}.m4a`);
    fs.copyFileSync(TONE, src);
    const info = await window.evaluate(async ({ fp, parentListId }) => {
      const result = await window.electronAPI.importFiles({ filePaths: [fp], parentListId, position: 0 });
      const imported = result.imported[0];
      const row = await window.electronAPI.getSong(imported.songId);
      return { songId: imported.songId, itemId: imported.itemId, absPath: row.file_path };
    }, { fp: src, parentListId: listId });
    fs.unlinkSync(src);
    return info;
  }

  test.beforeAll(async ({ window }) => {
    // addFolder returns the new list id; its placement id has to be looked up.
    const folder = await window.evaluate(async (title) => {
      const listId = await window.electronAPI.addFolder({ parentListId: 0, position: 0, title });
      const placements = await window.electronAPI.getListItems(0);
      return { listId, itemId: placements.find((it) => it.list_id === listId).id };
    }, `Out ${STAMP}`);
    folderItemId = folder.itemId;

    const imports = [
      await importInto(window, folder.listId, `f1-${STAMP}`),
      await importInto(window, folder.listId, `f2-${STAMP}`),
    ];
    loose = await importInto(window, 0, `loose-${STAMP}`);

    // Read the folder's real display order rather than assuming import order.
    const items = await window.evaluate((id) => window.electronAPI.getListItems(id), folder.listId);
    inFolder = items.map((it) => imports.find((i) => i.songId === it.song_id));
    expect(inFolder).toHaveLength(2);
    expect(inFolder.every(Boolean)).toBe(true);
  });

  test.afterAll(async ({ window }) => {
    for (const id of [folderItemId, loose.itemId]) {
      await window.evaluate((i) => window.electronAPI.deleteItemWithFiles(i), id);
    }
  });

  const pathsFor = (window, itemIds) =>
    window.evaluate((ids) => window.electronAPI.getSongFilePathsForItems(ids), itemIds);

  test('a selection resolves to the real audio files, recursing into folders', async ({ window }) => {
    const paths = await pathsFor(window, [folderItemId, loose.itemId]);

    // Folder contents come first and in their own order, then the loose song --
    // the same depth-first order the user sees in the tree.
    expect(paths).toEqual([inFolder[0].absPath, inFolder[1].absPath, loose.absPath]);

    for (const p of paths) {
      expect(path.isAbsolute(p)).toBe(true);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  test('the same song selected twice is exported once', async ({ window }) => {
    // A folder plus a song already inside it: the OS would copy one file anyway,
    // so the same path must not be handed over twice.
    const paths = await pathsFor(window, [folderItemId, inFolder[0].itemId]);
    expect(paths).toEqual([inFolder[0].absPath, inFolder[1].absPath]);
  });
});

// Dragging out needs the Option key and nothing can change that (see
// renderer/utils/dragOut.js), so the same job has a menu command that doesn't:
// pick a folder, and the selection's audio files are copied into it.
test.describe('Copy files to a folder', () => {
  let song = null; // { itemId, songId, absPath, title }
  let targetDir = null;

  // Answer the folder chooser with `dir` instead of opening it. `dialog` is the
  // live electron object main.js calls through, so patching it lands.
  const chooseFolder = (electronApp, dir) =>
    electronApp.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({ canceled: chosen === null, filePaths: chosen ? [chosen] : [] });
    }, dir);

  test.beforeAll(async ({ window, electronApp }) => {
    // Keep the real chooser to put back: later specs open their own dialogs.
    await electronApp.evaluate(({ dialog }) => { globalThis.__realShowOpenDialog = dialog.showOpenDialog; });

    const src = path.join(os.tmpdir(), `ludi-copyto-${STAMP}.m4a`);
    fs.copyFileSync(TONE, src);
    song = await window.evaluate(async (fp) => {
      const result = await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
      const { songId, itemId } = result.imported[0];
      const row = await window.electronAPI.getSong(songId);
      return { songId, itemId, absPath: row.file_path, title: row.title };
    }, src);
    fs.unlinkSync(src);

    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludi-export-'));
  });

  test.afterAll(async ({ window, electronApp }) => {
    await electronApp.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.__realShowOpenDialog; });
    await window.evaluate((i) => window.electronAPI.deleteItemWithFiles(i), song.itemId);
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test('the song context menu copies the file into the chosen folder', async ({ window, electronApp }) => {
    await chooseFolder(electronApp, targetDir);

    await window.keyboard.press('Escape');
    await window.locator('.playlist-item').first().click();
    const row = window.locator(`.tree-item-content[data-item-id="${song.itemId}"]`);
    await expect(row).toBeVisible({ timeout: 2000 });
    await row.click({ button: 'right' });

    const command = window.locator('.context-menu .qa-copy-files-to');
    await expect(command).toBeVisible();
    await command.click();

    // The summary says where the files went, and they are actually there.
    const overlay = window.locator('.modal-overlay.visible');
    await expect(overlay.locator('.modal-content')).toContainText(targetDir, { timeout: 3000 });
    await expect(overlay.locator('.modal-content')).toContainText('Copied 1 of 1 file');
    await overlay.locator('.modal-btn', { hasText: 'OK' }).click();

    const copied = path.join(targetDir, path.basename(song.absPath));
    expect(fs.existsSync(copied)).toBe(true);
    expect(fs.statSync(copied).size).toBe(fs.statSync(song.absPath).size);
  });

  test('copying the same song again keeps both files instead of overwriting', async ({ window, electronApp }) => {
    await chooseFolder(electronApp, targetDir);

    const result = await window.evaluate(
      (itemIds) => window.electronAPI.copyItemsToFolder(itemIds),
      [song.itemId]
    );
    expect(result).toMatchObject({ canceled: false, targetDir, total: 1, copied: 1, errors: [] });

    const base = path.basename(song.absPath, path.extname(song.absPath));
    const ext = path.extname(song.absPath);
    expect(fs.existsSync(path.join(targetDir, `${base}${ext}`))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, `${base} (2)${ext}`))).toBe(true);
  });

  test('cancelling the folder chooser copies nothing', async ({ window, electronApp }) => {
    await chooseFolder(electronApp, null);

    const before = fs.readdirSync(targetDir);
    const result = await window.evaluate(
      (itemIds) => window.electronAPI.copyItemsToFolder(itemIds),
      [song.itemId]
    );
    expect(result).toEqual({ canceled: true });
    expect(fs.readdirSync(targetDir)).toEqual(before);
  });
});
