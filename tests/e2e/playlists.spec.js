const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TONE = path.join(testAudioDir, 'test-tone.m4a');

// Unique per run so nothing collides with the songs other specs import into the
// shared test database.
const STAMP = Date.now();

// The song these tests drag around, captured in beforeAll.
let song = null; // { songId, itemId, title, absPath }

// ---- helpers ----

const playlistRow = (window, name) =>
  window.locator('.qa-playlist-item').filter({ hasText: name });

const mainLibraryRow = (window) => window.locator('.qa-playlist-item[data-list-id="0"]');

const songRow = (window, songId) =>
  window.locator(`.tree-item-content[data-song-id="${songId}"]`);

async function openList(window, rowLocator) {
  await rowLocator.click();
  await window.waitForTimeout(150);
}

async function makePlaylist(window, name) {
  await window.keyboard.press('Escape');
  await window.click('#addLibraryBtn');
  await window.click('#newPlaylistMenuItem');
  await window.fill('#renameInput', name);
  await window.click('#renameOkBtn');
  const row = playlistRow(window, name);
  await expect(row).toBeVisible({ timeout: 2000 });
  await window.waitForTimeout(150);
  return row;
}

async function playlistIdOf(window, name) {
  return parseInt(await playlistRow(window, name).getAttribute('data-list-id'));
}

async function itemsIn(window, listId) {
  return window.evaluate((id) => window.electronAPI.getListItems(id), listId);
}

async function removePlaylist(window, name) {
  const row = playlistRow(window, name);
  await row.click({ button: 'right' });
  await window.click('.qa-playlist-delete');
  await window.click('#modalYesBtn');
  await expect(row).toHaveCount(0, { timeout: 2000 });
}

// Press-move-release drag. HTML5 dragstart/dragover/drop fire for real in
// Electron, which is what makes the cross-surface (tree -> sidebar) path
// testable at all.
async function dragOnto(window, source, target, yFraction = 0.5) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  await window.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await window.mouse.down();
  await window.mouse.move(t.x + t.width / 2, t.y + t.height * yFraction, { steps: 8 });
  await window.mouse.move(t.x + t.width / 2, t.y + t.height * yFraction);
  await window.waitForTimeout(100);
  await window.mouse.up();
  await window.waitForTimeout(250);
}

// Import one fresh copy of the tone into the Main Library. Every copy gets its
// own filename, so it becomes its own `songs` row rather than being skipped as
// a duplicate of whatever other specs already imported.
async function importUniqueSong(window, label) {
  const src = path.join(os.tmpdir(), `ludi-pl-${label}.m4a`);
  fs.copyFileSync(TONE, src);

  const info = await window.evaluate(async (fp) => {
    const result = await window.electronAPI.importFiles({
      filePaths: [fp],
      parentListId: 0,
      position: 0,
    });
    const imported = result.imported[0];
    // getSong already resolves file_path against the library folder.
    const row = await window.electronAPI.getSong(imported.songId);
    return {
      songId: imported.songId,
      itemId: imported.itemId,
      title: row.title,
      absPath: row.file_path,
    };
  }, src);

  fs.unlinkSync(src);
  expect(info.songId).toBeTruthy();
  return info;
}

test.describe('Playlists', () => {
  test.beforeAll(async ({ window }) => {
    song = await importUniqueSong(window, `shared-${STAMP}`);
  });

  test.afterAll(async ({ window }) => {
    if (song) await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), song.itemId);
  });

  test('New Playlist creates an empty playlist and opens it', async ({ window }) => {
    const name = `PL Empty ${STAMP}`;
    const row = await makePlaylist(window, name);

    await expect(row).toHaveClass(/active/);
    await expect(window.locator('#currentListTitle')).toHaveText(name);
    await expect(window.locator('.qa-empty-playlist')).toBeVisible({ timeout: 2000 });

    await removePlaylist(window, name);
    // Deleting the open playlist falls back to the Main Library.
    await expect(mainLibraryRow(window)).toHaveClass(/active/);
  });

  test('dragging a song onto a playlist copies it and leaves the Main Library intact', async ({ window }) => {
    const name = `PL Copy ${STAMP}`;
    await makePlaylist(window, name);
    const listId = await playlistIdOf(window, name);

    await openList(window, mainLibraryRow(window));
    const mainCountBefore = await window.locator('.tree-item-content[data-is-folder="false"]').count();

    await dragOnto(window, songRow(window, song.songId), playlistRow(window, name));

    // The playlist gained exactly the one song...
    await openList(window, playlistRow(window, name));
    await expect(songRow(window, song.songId)).toHaveCount(1, { timeout: 2000 });
    await expect(window.locator('.qa-empty-playlist')).toHaveCount(0);

    // ...and the Main Library still has it, with nothing moved out.
    await openList(window, mainLibraryRow(window));
    await expect(songRow(window, song.songId)).toHaveCount(1);
    await expect(window.locator('.tree-item-content[data-is-folder="false"]')).toHaveCount(mainCountBefore);

    // The copy is a new placement referencing the same song row.
    const placements = await itemsIn(window, listId);
    expect(placements).toHaveLength(1);
    expect(placements[0].song_id).toBe(song.songId);
    expect(placements[0].id).not.toBe(song.itemId);

    await removePlaylist(window, name);
  });

  test('dragging a folder onto a playlist copies the folder, not moves it', async ({ window }) => {
    const folderName = `PLFolder${STAMP}`;
    const tempDir = path.join(os.tmpdir(), folderName);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(TONE, path.join(tempDir, `inside-${STAMP}.m4a`));

    await openList(window, mainLibraryRow(window));
    await window.evaluate(
      (fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }),
      tempDir
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
    await openList(window, mainLibraryRow(window));

    const sourceFolder = window
      .locator('.tree-item-content[data-is-folder="true"]')
      .filter({ hasText: folderName });
    await expect(sourceFolder).toBeVisible({ timeout: 2000 });
    const sourceFolderId = await sourceFolder.getAttribute('data-folder-id');

    const name = `PL Folder ${STAMP}`;
    await makePlaylist(window, name);
    await openList(window, mainLibraryRow(window));

    await dragOnto(window, sourceFolder, playlistRow(window, name));

    // The source folder is untouched.
    await expect(sourceFolder).toHaveCount(1);

    await openList(window, playlistRow(window, name));
    const copiedFolder = window
      .locator('.tree-item-content[data-is-folder="true"]')
      .filter({ hasText: folderName });
    await expect(copiedFolder).toHaveCount(1, { timeout: 2000 });

    // A different folder id is what proves a new `lists` row rather than a move.
    const copiedFolderId = await copiedFolder.getAttribute('data-folder-id');
    expect(copiedFolderId).not.toBe(sourceFolderId);

    // The song inside came along, still pointing at the same song row.
    await copiedFolder.locator('.tree-item-icon.chevron').click();
    await expect(
      window.locator(`[data-list-id="${copiedFolderId}"] .tree-item-content[data-is-folder="false"]`)
    ).toHaveCount(1, { timeout: 2000 });

    await removePlaylist(window, name);

    // Clean up the source folder (and its song file).
    await openList(window, mainLibraryRow(window));
    await sourceFolder.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await expect(sourceFolder).toHaveCount(0, { timeout: 2000 });
  });

  test('dropping a song already in the playlist offers add / skip / cancel', async ({ window }) => {
    const name = `PL Dup ${STAMP}`;
    await makePlaylist(window, name);
    const listId = await playlistIdOf(window, name);

    await openList(window, mainLibraryRow(window));
    await dragOnto(window, songRow(window, song.songId), playlistRow(window, name));
    expect(await itemsIn(window, listId)).toHaveLength(1);

    const modal = window.locator('.qa-duplicate-songs-modal');

    // Cancel -> nothing added.
    await dragOnto(window, songRow(window, song.songId), playlistRow(window, name));
    await expect(modal).toBeVisible({ timeout: 2000 });
    await expect(modal).toContainText(name);
    await window.click('.qa-dup-cancel');
    await expect(modal).toHaveCount(0);
    expect(await itemsIn(window, listId)).toHaveLength(1);

    // Skip duplicates -> nothing added.
    await dragOnto(window, songRow(window, song.songId), playlistRow(window, name));
    await expect(modal).toBeVisible({ timeout: 2000 });
    await window.click('.qa-dup-skip');
    await expect(modal).toHaveCount(0);
    await window.waitForTimeout(150);
    expect(await itemsIn(window, listId)).toHaveLength(1);

    // Add duplicates -> a second placement of the same song.
    await dragOnto(window, songRow(window, song.songId), playlistRow(window, name));
    await expect(modal).toBeVisible({ timeout: 2000 });
    await window.click('.qa-dup-add');
    await expect(modal).toHaveCount(0);
    await window.waitForTimeout(200);
    const after = await itemsIn(window, listId);
    expect(after).toHaveLength(2);
    expect(after.map((i) => i.song_id)).toEqual([song.songId, song.songId]);

    // Both placements render as separate rows.
    await openList(window, playlistRow(window, name));
    await expect(songRow(window, song.songId)).toHaveCount(2, { timeout: 2000 });

    await removePlaylist(window, name);
  });

  test('playlists reorder by dragging, the Main Library stays pinned, and the order persists', async ({ window }) => {
    const a = `PL Ord A ${STAMP}`;
    const b = `PL Ord B ${STAMP}`;
    const c = `PL Ord C ${STAMP}`;
    await makePlaylist(window, a);
    await makePlaylist(window, b);
    await makePlaylist(window, c);

    const titlesInSidebar = () =>
      window.$$eval('.qa-playlist-item', (els) => els.map((e) => e.textContent));

    expect(await titlesInSidebar()).toEqual(['Main Library', a, b, c]);

    // Drop C on the top half of A -> C goes above A.
    await dragOnto(window, playlistRow(window, c), playlistRow(window, a), 0.25);
    expect(await titlesInSidebar()).toEqual(['Main Library', c, a, b]);

    // getLists() orders by sidebar_position, so this proves the order was
    // written to the database rather than only reordered in local state.
    const stored = await window.evaluate(() => window.electronAPI.getLists());
    expect(stored.map((l) => l.title)).toEqual(['Main Library', c, a, b]);

    // The Main Library is not a reorder target.
    await dragOnto(window, playlistRow(window, b), mainLibraryRow(window), 0.25);
    expect(await titlesInSidebar()).toEqual(['Main Library', c, a, b]);

    await removePlaylist(window, a);
    await removePlaylist(window, b);
    await removePlaylist(window, c);
  });

  test('drag source decides the gesture: playlist drags show the line, tree drags show the highlight', async ({ window }) => {
    const a = `PL Gest A ${STAMP}`;
    const b = `PL Gest B ${STAMP}`;
    await makePlaylist(window, a);
    await makePlaylist(window, b);

    const indicator = window.locator('#dropIndicator-sidebar');
    const highlighted = window.locator('.qa-playlist-item.drop-into');

    // Dragging a playlist chip over another playlist: reorder line only.
    const bBox = await playlistRow(window, b).boundingBox();
    const aBox = await playlistRow(window, a).boundingBox();
    await window.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height * 0.25, { steps: 8 });
    await window.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height * 0.25);
    await window.waitForTimeout(100);
    await expect(indicator).toHaveClass(/visible/);
    await expect(highlighted).toHaveCount(0);
    // Release back over the dragged row itself, which is never a drop target.
    await window.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2, { steps: 5 });
    await window.mouse.up();
    await window.waitForTimeout(150);

    // Dragging a song from the tree over a playlist: highlight only.
    await openList(window, mainLibraryRow(window));
    const sBox = await songRow(window, song.songId).boundingBox();
    await window.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height * 0.25, { steps: 8 });
    await window.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height * 0.25);
    await window.waitForTimeout(100);
    await expect(highlighted).toHaveCount(1);
    await expect(indicator).not.toHaveClass(/visible/);
    await window.mouse.up();
    await window.waitForTimeout(250);

    await removePlaylist(window, a);
    await removePlaylist(window, b);
  });

  test('removing from a playlist keeps the song and its file; deleting from the Main Library removes both', async ({ window }) => {
    // This test destroys the song it uses, so it gets its own copy.
    const victim = await importUniqueSong(window, `victim-${STAMP}`);
    const name = `PL Del ${STAMP}`;
    await makePlaylist(window, name);
    const listId = await playlistIdOf(window, name);
    const modalTitle = window.locator('.modal-overlay.visible .modal-title');

    await openList(window, mainLibraryRow(window));
    await dragOnto(window, songRow(window, victim.songId), playlistRow(window, name));

    // Backspace inside a playlist removes the placement only.
    await openList(window, playlistRow(window, name));
    await songRow(window, victim.songId).click();
    await window.keyboard.press('Backspace');
    await expect(modalTitle).toContainText('Remove from Playlist', { timeout: 2000 });
    await window.click('#modalYesBtn');
    await expect(songRow(window, victim.songId)).toHaveCount(0, { timeout: 2000 });
    await expect(window.locator('.qa-empty-playlist')).toBeVisible();

    await openList(window, mainLibraryRow(window));
    await expect(songRow(window, victim.songId)).toHaveCount(1);
    expect(fs.existsSync(victim.absPath)).toBe(true);

    // Put it back, then delete from the Main Library: it leaves the playlist too.
    await dragOnto(window, songRow(window, victim.songId), playlistRow(window, name));
    expect(await itemsIn(window, listId)).toHaveLength(1);

    await openList(window, mainLibraryRow(window));
    await songRow(window, victim.songId).click();
    await window.keyboard.press('Backspace');
    await expect(modalTitle).toContainText('Confirm Delete', { timeout: 2000 });
    // The warning has to say the delete is permanent and reaches into playlists.
    await expect(window.locator('.modal-overlay.visible .modal-content'))
      .toContainText('permanent');
    await expect(window.locator('.modal-overlay.visible .modal-content'))
      .toContainText('playlists');
    await window.click('#modalYesBtn');
    await expect(songRow(window, victim.songId)).toHaveCount(0, { timeout: 2000 });

    expect(await itemsIn(window, listId)).toHaveLength(0);
    expect(fs.existsSync(victim.absPath)).toBe(false);

    await removePlaylist(window, name);
  });

  test('double-clicking a playlist in the sidebar plays it from the top', async ({ window }) => {
    const name = `PL Play ${STAMP}`;
    await makePlaylist(window, name);
    const listId = await playlistIdOf(window, name);

    // A second song, imported at position 0 so it is the Main Library's top row.
    const second = await importUniqueSong(window, `play-second-${STAMP}`);

    // Two songs in the playlist, the shared one first -- so "starts at the top"
    // is an actual claim and not just "plays the only song".
    await window.evaluate(async ({ first, next, targetListId }) => {
      await window.electronAPI.copyItemsToList({ itemIds: [first], targetListId, skipSongIds: [] });
      await window.electronAPI.copyItemsToList({ itemIds: [next], targetListId, skipSongIds: [] });
    }, { first: song.itemId, next: second.itemId, targetListId: listId });

    const playPauseBtn = window.locator('#playPauseBtn');
    const nowPlaying = window.locator('#currentSongTitle');

    await playlistRow(window, name).dblclick();
    await expect(playPauseBtn).toHaveClass(/playing/, { timeout: 2000 });
    await expect(nowPlaying).toHaveText(song.title);
    await playPauseBtn.click();

    // The Main Library is a playlist too, and plays from its own first song.
    const firstInLibrary = await window.evaluate(async () => {
      const items = await window.electronAPI.getListItems(0);
      return items[0].song_title;
    });
    expect(firstInLibrary).toBe(second.title);

    await mainLibraryRow(window).dblclick();
    await expect(playPauseBtn).toHaveClass(/playing/, { timeout: 2000 });
    await expect(nowPlaying).toHaveText(second.title);
    await playPauseBtn.click();

    await removePlaylist(window, name);
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), second.itemId);
  });

  test('an OS file dropped on a playlist row lands in both the playlist and the Main Library', async ({ window }) => {
    const name = `PL Drop ${STAMP}`;
    await makePlaylist(window, name);
    const listId = await playlistIdOf(window, name);

    const uniqueFile = path.join(os.tmpdir(), `ludi-pl-drop-${STAMP}.m4a`);
    fs.copyFileSync(TONE, uniqueFile);

    await openList(window, mainLibraryRow(window));
    const mainBefore = await window.locator('.tree-item-content[data-is-folder="false"]').count();

    // A real <input type=file> is the only way to get an OS-backed File, which
    // is what webUtils.getPathForFile needs to resolve a path.
    await window.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'qa-pl-drop-input';
      input.style.display = 'none';
      document.body.appendChild(input);
    });
    await window.setInputFiles('#qa-pl-drop-input', uniqueFile);

    await window.evaluate((playlistName) => {
      const f = document.getElementById('qa-pl-drop-input').files[0];
      const dt = new DataTransfer();
      dt.items.add(f);
      const row = [...document.querySelectorAll('.qa-playlist-item')]
        .find((el) => el.textContent === playlistName);
      for (const type of ['dragover', 'drop']) {
        row.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    }, name);

    await expect(window.locator('.tree-item-content[data-is-folder="false"]'))
      .toHaveCount(mainBefore + 1, { timeout: 3000 });

    const placements = await itemsIn(window, listId);
    expect(placements).toHaveLength(1);
    const droppedSongId = placements[0].song_id;
    await expect(songRow(window, droppedSongId)).toHaveCount(1);

    await removePlaylist(window, name);

    // Clean up the imported song and the temp file.
    await window.locator(`.tree-item-content[data-song-id="${droppedSongId}"]`).click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await expect(window.locator(`.tree-item-content[data-song-id="${droppedSongId}"]`))
      .toHaveCount(0, { timeout: 2000 });
    await window.evaluate(() => document.getElementById('qa-pl-drop-input')?.remove());
    fs.unlinkSync(uniqueFile);
  });
});
