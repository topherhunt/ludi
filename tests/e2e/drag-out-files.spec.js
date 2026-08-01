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
