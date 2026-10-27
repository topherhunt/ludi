const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// The Swinsian date added and genre import, driven through the Settings window
// against a stand-in Swinsian library. Only the native file picker is stubbed.

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
// Absolute, because main's require resolves from Electron's own stack, not the repo.
const BETTER_SQLITE_MODULE = path.resolve(__dirname, '../../node_modules/better-sqlite3');

async function openSettings(electronApp) {
  await electronApp.evaluate(async ({ Menu }) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label === 'Settings...') return item;
        if (item.submenu) {
          const hit = find(item.submenu.items);
          if (hit) return hit;
        }
      }
      return null;
    };
    find(Menu.getApplicationMenu().items).click();
  });
  const settings = await electronApp.waitForEvent('window', {
    predicate: (page) => page.url().includes('settings.html'),
  });
  await settings.waitForLoadState('domcontentloaded');
  return settings;
}

test.describe('Swinsian date added and genre import', () => {
  const stamp = Date.now();
  const audioFiles = [0, 1].map((i) => path.join(os.tmpdir(), `ludi-swdetails-${stamp}-${i}.m4a`));
  let imported = []; // [{ songId, itemId }]
  let swinsianDbPath = null;

  test.beforeAll(async ({ window, electronApp }) => {
    audioFiles.forEach((fp) => fs.copyFileSync(SOURCE_AUDIO, fp));
    imported = await window.evaluate(async (filePaths) => {
      const result = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      // The second song already has a genre here, which the import must keep.
      await window.electronAPI.updateSong({ songId: result.imported[1].songId, fields: { genre: 'Jazz' } });
      return result.imported.map(({ songId, itemId }) => ({ songId, itemId }));
    }, audioFiles);

    // Timestamps are Core Data seconds (since 2001-01-01 UTC), at local noon.
    swinsianDbPath = path.join(os.tmpdir(), `ludi-swdetails-${stamp}.sqlite`);
    await electronApp.evaluate(async (unused, { sqliteModule, dbPath, names }) => {
      const coreData = (day) => new Date(`${day}T12:00:00`).getTime() / 1000 - 978307200;
      const Database = process.mainModule.require(sqliteModule);
      const foreign = new Database(dbPath);
      foreign.exec(`CREATE TABLE track (id INTEGER PRIMARY KEY, path TEXT, title TEXT, rating INTEGER,
        genre TEXT, dateadded FLOAT, datecreated FLOAT)`);
      const insert = foreign.prepare('INSERT INTO track (path, title, rating, genre, dateadded, datecreated) VALUES (?, ?, 0, ?, ?, ?)');
      insert.run(`/Swinsian/${names[0]}`, 'First', 'Soundtrack', coreData('2019-12-10'), coreData('2011-04-02'));
      insert.run(`/Swinsian/${names[1]}`, 'Second', 'Pop', coreData('2015-07-07'), coreData('2016-01-01'));
      foreign.close();
    }, { sqliteModule: BETTER_SQLITE_MODULE, dbPath: swinsianDbPath, names: audioFiles.map((f) => path.basename(f)) });
    audioFiles.forEach((fp) => fs.rmSync(fp, { force: true }));

    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, swinsianDbPath);
  });

  test.afterAll(async ({ window }) => {
    await window.evaluate(async (items) => {
      for (const { itemId } of items) await window.electronAPI.deleteItemWithFiles(itemId);
    }, imported);
    if (swinsianDbPath) fs.rmSync(swinsianDbPath, { force: true });
  });

  test('previews the dates and genres, then dates both songs and fills only the missing genre', async ({ window, electronApp }) => {
    const settings = await openSettings(electronApp);
    await settings.locator('.qa-import-details').click();

    const modal = settings.locator('.modal-content');
    await expect(modal).toContainText('Matched 2 of 2 tracks', { timeout: 5000 });
    await expect(modal).toContainText('2 songs will get a new date added');
    await expect(modal).toContainText('2011: 1');
    await expect(modal).toContainText('2015: 1');
    await expect(modal).toContainText('1 song with no genre here will get one');
    await expect(modal).toContainText('Soundtrack: 1');
    await expect(modal).not.toContainText('Pop');

    await settings.locator('#modalYesBtn').click();
    await expect(settings.locator('.modal-content')).toContainText('Dated 2 songs and set the genre of 1', { timeout: 5000 });
    await settings.close();

    // The main window reloads, so the new values show without a restart.
    await window.locator('.playlist-item').first().click();
    const row = (i) => window.locator(`.qa-song-row[data-song-id="${imported[i].songId}"]`);
    await expect(row(0).locator('.col-date_added')).toHaveText('2011-04-02', { timeout: 5000 });
    await expect(row(0).locator('.col-genre')).toHaveText('Soundtrack');
    await expect(row(1).locator('.col-date_added')).toHaveText('2015-07-07');
    await expect(row(1).locator('.col-genre')).toHaveText('Jazz');
  });
});
