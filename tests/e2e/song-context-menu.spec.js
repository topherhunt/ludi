const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testAudioPath = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

test.describe('Song context menu', () => {
  test('offers Show in Finder + Copy file path, and copies the absolute path', async ({ window, electronApp }) => {
    // Import a uniquely-named copy so this test owns fresh data regardless of what
    // earlier tests left in the library (importing a duplicate would be skipped).
    const uniqueFile = path.join(os.tmpdir(), `ludi-ctx-song-${Date.now()}.mp3`);
    fs.copyFileSync(testAudioPath, uniqueFile);

    const importResult = await window.evaluate(
      (fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }),
      uniqueFile
    );
    const songId = importResult.imported[0].songId;
    const absPath = await window.evaluate((id) => window.electronAPI.getSong(id).then((s) => s.file_path), songId);

    const mainLibraryItem = window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(150);

    const songRow = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    await expect(songRow).toBeVisible({ timeout: 2000 });
    await songRow.click({ button: 'right' });
    await window.waitForTimeout(50);

    const finderItem = window.locator('.context-menu-item').filter({ hasText: 'Show in Finder' });
    const copyItem = window.locator('.context-menu-item').filter({ hasText: 'Copy file path' });
    await expect(finderItem).toBeVisible();
    await expect(copyItem).toBeVisible();

    // "Copy file path" writes the absolute path. Record the write in the main
    // process instead of letting it clobber the user's real clipboard.
    // (We don't click "Show in Finder" -- it would pop real Finder windows during tests.)
    await electronApp.evaluate(({ clipboard }) => {
      global.__copied = [];
      global.__realWriteText = clipboard.writeText;
      clipboard.writeText = (text) => { global.__copied.push(text); };
    });
    await copyItem.click();
    await window.waitForTimeout(150);
    const copied = await electronApp.evaluate(({ clipboard }) => {
      clipboard.writeText = global.__realWriteText;
      return global.__copied;
    });
    expect(copied).toEqual([absPath]);

    // Cleanup
    await songRow.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(100);
    fs.rmSync(uniqueFile, { force: true });
  });

  test('does not offer those actions for album groups', async ({ window }) => {
    const album = `CtxAlbum ${Date.now()}`;
    const files = [0, 1].map((i) => path.join(os.tmpdir(), `ludi-ctx-group-${Date.now()}-${i}.mp3`));
    files.forEach((f) => fs.copyFileSync(testAudioPath, f));
    const itemIds = await window.evaluate(async ({ filePaths, album }) => {
      const { itemIds } = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      for (const item of await window.electronAPI.getListItems(0)) {
        if (itemIds.includes(item.id)) await window.electronAPI.updateSong({ songId: item.song_id, fields: { album } });
      }
      window.__ludiResetListViews({ 'list:0': { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] } });
      return itemIds;
    }, { filePaths: files, album });
    files.forEach((f) => fs.rmSync(f, { force: true }));

    await window.locator('.playlist-item').first().click();
    const groupRow = window.locator('.qa-group-row').filter({ hasText: album });
    await groupRow.click({ button: 'right' });

    await expect(window.locator('.qa-play-group')).toBeVisible();
    await expect(window.locator('.context-menu-item').filter({ hasText: 'Copy file path' })).toHaveCount(0);
    await expect(window.locator('.context-menu-item').filter({ hasText: 'Show in Finder' })).toHaveCount(0);

    await window.keyboard.press('Escape');
    await window.evaluate(async (ids) => {
      for (const id of ids) await window.electronAPI.deleteItemWithFiles(id);
    }, itemIds);
  });

  test('opened in the bottom-right corner, the menu and its submenus stay inside the window', async ({ window }) => {
    const file = path.join(os.tmpdir(), `ludi-ctx-corner-${Date.now()}.mp3`);
    fs.copyFileSync(testAudioPath, file);
    const { imported, itemIds } = await window.evaluate(
      (fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }), file);
    fs.rmSync(file, { force: true });

    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // A real MouseEvent: Playwright's dispatchEvent('contextmenu') carries no coordinates.
    await window.locator(`.tree-item-content[data-song-id="${imported[0].songId}"]`).evaluate((row, { x, y }) => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: viewport.w - 5, y: viewport.h - 5 });
    const insideWindow = async (locator) => {
      const box = await locator.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.w);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.h);
    };

    await insideWindow(window.locator('.context-menu'));
    await window.locator('.qa-rate-menu').hover();
    await insideWindow(window.locator('.qa-rate-menu > .context-submenu'));

    await window.locator('.search-input').click();
    await expect(window.locator('.context-menu')).toHaveCount(0);
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), itemIds[0]);
  });

  test('right-clicking outside the selection selects just that song; inside it keeps the selection', async ({ window }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludi-ctx-select-'));
    const files = [0, 1, 2].map((i) => {
      const file = path.join(dir, `ludi-ctx-select-${Date.now()}-${i}.mp3`);
      fs.copyFileSync(testAudioPath, file);
      return file;
    });
    const { imported, itemIds } = await window.evaluate(
      (paths) => window.electronAPI.importFiles({ filePaths: paths, parentListId: 0, position: 0 }), files);
    fs.rmSync(dir, { recursive: true, force: true });

    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    const [a, b, c] = imported.map(({ songId }) => window.locator(`.tree-item-content[data-song-id="${songId}"]`));
    const selectedCount = () => window.locator('.tree-item-content.selected').count();
    const closeMenu = async () => {
      await window.locator('.search-input').click();
      await expect(window.locator('.context-menu')).toHaveCount(0);
    };

    await a.click();
    await b.click({ modifiers: ['Meta'] });
    await c.click({ button: 'right' });
    await expect(c).toHaveClass(/selected/);
    expect(await selectedCount()).toBe(1);
    await closeMenu();

    await a.click();
    await b.click({ modifiers: ['Meta'] });
    await a.click({ button: 'right' });
    await expect(window.locator('.qa-rate-menu')).toContainText('Rate these 2');
    expect(await selectedCount()).toBe(2);
    await closeMenu();

    await window.evaluate(async (ids) => {
      for (const id of ids) await window.electronAPI.deleteItemWithFiles(id);
    }, itemIds);
  });
});
