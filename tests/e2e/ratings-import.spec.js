const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The Swinsian ratings import, driven through the Settings window.
 *
 * There is no real Swinsian library to test against, so this builds one: a
 * SQLite file whose track table is named and shaped the way the importer has to
 * discover rather than assume (an unfamiliar table name, an iTunes-style 0-100
 * rating column). The native file picker is the one thing stubbed -- everything
 * downstream of it is the real IPC, the real reader and the real write path.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');
// Absolute, because main's require resolves from Electron's own stack, not the repo.
const BETTER_SQLITE_MODULE = path.resolve(__dirname, '../../node_modules/better-sqlite3');

/** Open the Settings window through the app menu, as a user would. */
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
  await settings.waitForTimeout(200);
  return settings;
}

test.describe('Swinsian ratings import', () => {
  const stamp = Date.now();
  const audioFiles = [];
  let itemIds = [];
  let songIds = [];
  let swinsianDbPath = null;

  test.beforeAll(async ({ window, electronApp }) => {
    for (let i = 0; i < 2; i++) {
      const fp = path.join(os.tmpdir(), `ludi-swinsian-${stamp}-${i}.m4a`);
      fs.copyFileSync(SOURCE_AUDIO, fp);
      audioFiles.push(fp);
    }

    const imported = await window.evaluate(
      (filePaths) => window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 }),
      audioFiles
    );
    expect(imported.errors).toEqual([]);
    songIds = imported.imported.map(s => s.songId);
    itemIds = imported.itemIds;

    // A stand-in Swinsian library. Only the first song is rated, at 80/100 --
    // four stars once the importer works out the scale.
    swinsianDbPath = path.join(os.tmpdir(), `ludi-swinsian-${stamp}.sqlite`);
    await electronApp.evaluate(async (unused, { sqliteModule, dbPath, rated, unmatchedName }) => {
      const Database = process.mainModule.require(sqliteModule);
      const foreign = new Database(dbPath);
      foreign.exec(`CREATE TABLE track (id INTEGER PRIMARY KEY, path TEXT, title TEXT, rating INTEGER)`);
      const insert = foreign.prepare('INSERT INTO track (path, title, rating) VALUES (?, ?, ?)');
      insert.run(`/Users/someone/Swinsian/${rated}`, 'Rated Fixture', 80);
      insert.run(`/Users/someone/Swinsian/${unmatchedName}`, 'Not In Ludi', 100);
      foreign.close();
    }, {
      sqliteModule: BETTER_SQLITE_MODULE,
      dbPath: swinsianDbPath,
      rated: path.basename(audioFiles[0]),
      unmatchedName: `ludi-swinsian-absent-${stamp}.m4a`,
    });

    // Stub only the native picker; the import itself runs for real.
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, swinsianDbPath);
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { window } = await setupElectronApp();
    for (const id of itemIds) {
      await window.evaluate((itemId) => window.electronAPI.deleteItemWithFiles(itemId), id);
    }
    audioFiles.forEach(fp => fs.rmSync(fp, { force: true }));
    if (swinsianDbPath) fs.rmSync(swinsianDbPath, { force: true });
  });

  test('previews the counts, and writes nothing until they are approved', async ({ window, electronApp }) => {
    const settings = await openSettings(electronApp);

    await settings.locator('.qa-import-ratings').click();

    // The preview names what it found, what it matched, and what it could not.
    const modal = settings.locator('.modal-content');
    await expect(modal).toContainText('Found 2 rated tracks', { timeout: 5000 });
    await expect(modal).toContainText('1 song here will be rated');
    await expect(modal).toContainText('1 matched by filename, 0 by title');
    await expect(modal).toContainText('ratings run 0-100');
    await expect(modal).toContainText('1 rated track had no match here');
    await expect(modal).toContainText('Not In Ludi');

    // Declining leaves the library untouched.
    await settings.locator('.modal-btn-secondary').filter({ hasText: 'No' }).click();
    const beforeRatings = await electronApp.evaluate((unused, { modulePath, ids }) => {
      const db = process.mainModule.require(modulePath);
      return db.getSongsForRatingMatch().filter(s => ids.includes(s.id)).map(s => s.rating);
    }, { modulePath: DATABASE_MODULE, ids: songIds });
    expect(beforeRatings).toEqual([null, null]);

    // Approving writes the 80/100 through as four stars, and only for the match.
    await settings.locator('.qa-import-ratings').click();
    await expect(settings.locator('.modal-content')).toContainText('Found 2 rated tracks', { timeout: 5000 });
    await settings.locator('#modalYesBtn').click();
    await expect(settings.locator('.modal-content')).toContainText('Rated 1 song', { timeout: 5000 });

    const afterRatings = await electronApp.evaluate((unused, { modulePath, ids }) => {
      const db = process.mainModule.require(modulePath);
      const byId = new Map(db.getSongsForRatingMatch().map(s => [s.id, s.rating]));
      return ids.map(id => byId.get(id));
    }, { modulePath: DATABASE_MODULE, ids: songIds });
    expect(afterRatings).toEqual([4, null]);

    await settings.close();

    // The main window is told to reload, so the stars show up without a restart.
    await window.locator('.playlist-item').first().click();
    const ratedRow = window.locator(`.tree-item-content[data-song-id="${songIds[0]}"]`);
    await expect(ratedRow.locator('.qa-star-rating')).toHaveAttribute('data-rating', '4', { timeout: 5000 });
  });
});
