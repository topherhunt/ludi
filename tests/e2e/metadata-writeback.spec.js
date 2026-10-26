const { test, expect, testAudioDir } = require('./fixtures');
const { parseFile } = require('music-metadata');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Edits in the song panel go into the audio file's own tags, not just the
// database, for each format the library imports.
const STAMP = Date.now();
const SOURCES = ['test-tone.m4a', '02 Jump Into My Mouth and Breathe in the Stardust.mp3'];

test.describe('Writing metadata edits into the audio file', () => {
  let imported = [];

  test.beforeAll(async ({ window }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludi-writeback-'));
    const files = SOURCES.map((name, i) => {
      const file = path.join(dir, `writeback-${STAMP}-${i}${path.extname(name)}`);
      fs.copyFileSync(path.join(testAudioDir, name), file);
      return file;
    });
    imported = await window.evaluate(async (paths) =>
      (await window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 })).imported, files);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.afterAll(async ({ window }) => {
    await window.evaluate(async (entries) => {
      const items = await window.electronAPI.getAllListItems();
      const songIds = new Set(entries.map((entry) => entry.songId));
      for (const item of items.filter((i) => songIds.has(i.song_id))) await window.electronAPI.deleteItemWithFiles(item.id);
    }, imported);
  });

  for (const [i, source] of SOURCES.entries()) {
    test(`title, artist, album and track # are written into the ${path.extname(source)} file`, async ({ window }) => {
      const { songId } = imported[i];
      await window.keyboard.press('Escape');
      await window.locator('.qa-playlist-item[data-list-id="0"]').click();
      await window.locator(`.tree-item-content[data-song-id="${songId}"]`).click();

      for (const [field, value] of [['title', `Edited ${STAMP}`], ['artist', 'Edited Artist'], ['album', 'Edited Album'], ['track', '7']]) {
        const input = window.locator(`.qa-edit-${field}`);
        await input.fill(value);
        await input.press('Enter');
      }
      const filePath = await window.evaluate(async (id) => (await window.electronAPI.getSong(id)).file_path, songId);
      await expect.poll(async () => (await parseFile(filePath)).common.track.no).toBe(7);
      const { common } = await parseFile(filePath);
      expect([common.title, common.artist, common.album]).toEqual([`Edited ${STAMP}`, 'Edited Artist', 'Edited Album']);

      // Clearing a field clears it in the file too.
      await window.locator('.qa-edit-track').fill('');
      await window.locator('.qa-edit-track').press('Enter');
      await expect.poll(async () => (await parseFile(filePath)).common.track.no).toBe(null);
    });
  }
});
