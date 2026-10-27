const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Grouping, sorting, the column chooser and the genre / date added fields, on a
// playlist of five songs. The tone has no ID3 title, so filenames are titles.

const TONE = path.join(testAudioDir, 'test-tone.m4a');
const STAMP = Date.now();
const ALPHA = `Alpha ${STAMP}`;
const BETA = `Beta ${STAMP}`;
const PLAYLIST = `List View ${STAMP}`;

// Playlist order. S4 has no album, so it stands alone whatever the grouping.
const SONGS = [
  { name: `lv1-${STAMP}`, album: ALPHA, artist: 'Ann', track_number: 2, genre: 'Rock', date_added: '2024-03-01' },
  { name: `lv2-${STAMP}`, album: ALPHA, artist: 'Bob', track_number: 1, genre: 'Rock', date_added: '2022-01-01' },
  { name: `lv3-${STAMP}`, album: BETA, track_number: 1, genre: 'Folk', date_added: '2023-06-01' },
  { name: `lv4-${STAMP}`, album: '', track_number: null, genre: null, date_added: '2025-01-01' },
  { name: `lv5-${STAMP}`, album: BETA, track_number: 2, genre: 'Folk', date_added: '2021-05-05' },
];
const [S1, S2, S3, S4, S5] = SONGS.map((s) => s.name);

let playlistId = null;
let libraryItemIds = [];
let tagId = null; // on S1 only, which is rated 4 to S2's 3

const nowPlaying = (window) => window.locator('.player-info .song-title');
const songRows = (window) => window.locator('.qa-song-row');
const songRow = (window, name) => songRows(window).filter({ hasText: name });
const groupRow = (window, title) => window.locator('.qa-group-row').filter({ hasText: title });
// Top-level rows only: groups and the songs that stand alone.
const topRows = (window) => window.locator('#explorerTree > li > .tree-item-content');

const rowTitles = (locator) =>
  locator.evaluateAll((els) => els.map((el) => el.querySelector('.tree-item-label').firstChild.textContent.trim()));

async function openPlaylist(window) {
  await window.keyboard.press('Escape');
  await window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`).click();
  await expect(songRows(window).or(window.locator('.qa-group-row')).first()).toBeVisible({ timeout: 2000 });
}

async function chooseGroup(window, mode) {
  await window.locator('.qa-group-by-btn').click();
  await window.locator(`.qa-group-option[data-group="${mode}"]`).click();
  await expect(window.locator('.qa-group-menu')).toHaveCount(0);
}

async function sortBy(window, field) {
  await window.locator('.qa-sort-btn').click();
  await window.locator(`.qa-sort-option[data-field="${field}"]`).click();
  await window.locator('#currentListTitle').click(); // closes the menu
}

const playlistOrder = (window) =>
  window.evaluate(async (id) => {
    const items = await window.electronAPI.getListItems(id);
    return items.map((it) => it.song_title);
  }, playlistId);

async function drag(window, source, target, { below }) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  await window.mouse.move(s.x + 40, s.y + s.height / 2);
  await window.mouse.down();
  await window.mouse.move(t.x + 40, t.y + t.height * (below ? 0.9 : 0.1), { steps: 5 });
  await window.waitForTimeout(50);
  await window.mouse.up();
  await window.waitForTimeout(150);
}

test.describe('Song list grouping and sorting', () => {
  test.beforeAll(async ({ window }) => {
    const files = SONGS.map((s) => path.join(os.tmpdir(), `${s.name}.m4a`));
    files.forEach((f) => fs.copyFileSync(TONE, f));

    await window.keyboard.press('Escape');
    await window.click('#addLibraryBtn');
    await window.click('#newPlaylistMenuItem');
    await window.fill('#renameInput', PLAYLIST);
    await window.click('#renameOkBtn');
    const playlist = window.locator('.qa-playlist-item').filter({ hasText: PLAYLIST });
    await expect(playlist).toBeVisible({ timeout: 2000 });
    playlistId = parseInt(await playlist.getAttribute('data-list-id'));

    ({ libraryItemIds, tagId } = await window.evaluate(async ({ filePaths, songs, listId, tagName }) => {
      const imported = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
      const library = await window.electronAPI.getListItems(0);
      const itemIds = [];
      const songIds = [];
      for (const { name, ...fields } of songs) {
        const item = library.find((it) => it.song_title === name);
        await window.electronAPI.updateSong({ songId: item.song_id, fields });
        itemIds.push(item.id);
        songIds.push(item.song_id);
      }
      await window.electronAPI.copyItemsToList({ itemIds, targetListId: listId, skipSongIds: [] });
      await window.electronAPI.setSongRating({ songIds: [songIds[0]], rating: 4 });
      await window.electronAPI.setSongRating({ songIds: [songIds[1]], rating: 3 });
      const tag = await window.electronAPI.createTag({ name: tagName, color: '#4ec9b0' });
      await window.electronAPI.addTagToSongs({ tagId: tag.id, songIds: [songIds[0]] });
      return { libraryItemIds: imported.itemIds, tagId: tag.id };
    }, { filePaths: files, songs: SONGS, listId: playlistId, tagName: `lvtag-${STAMP}` }));
    files.forEach((f) => fs.rmSync(f, { force: true }));

    await window.evaluate(() => { window.__ludiRepeatOneWindowMs = 1; });
    while (await window.evaluate(() => window.loopMode) !== 'off') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
  });

  test.afterAll(async ({ window }) => {
    if (await window.locator('#playPauseBtn.playing').count()) await window.locator('#playPauseBtn').click();
    // Through the UI, so the sidebar the next spec inherits matches the database.
    const playlist = window.locator(`.qa-playlist-item[data-list-id="${playlistId}"]`);
    await playlist.click({ button: 'right' });
    await window.click('.qa-playlist-delete');
    await window.click('#modalYesBtn');
    await expect(playlist).toHaveCount(0, { timeout: 2000 });
    await window.evaluate(async ({ itemIds, tagId }) => {
      await window.electronAPI.deleteTag(tagId);
      for (const id of itemIds) await window.electronAPI.deleteItemWithFiles(id);
    }, { itemIds: libraryItemIds, tagId });
    while (await window.evaluate(() => window.loopMode) !== 'all') {
      await window.locator('#loopBtn').click();
      await window.waitForTimeout(5);
    }
    await window.evaluate(() => { delete window.__ludiRepeatOneWindowMs; });
  });

  test('a playlist starts ungrouped in playlist order', async ({ window }) => {
    await openPlaylist(window);
    await expect(window.locator('.qa-group-by-btn')).toHaveText('No grouping');
    await expect(window.locator('.qa-sort-btn')).toHaveText('Playlist order');
    expect(await rowTitles(songRows(window))).toEqual([S1, S2, S3, S4, S5]);
  });

  test('grouping by album shows each album once, collapsed, and inlines a song with no album', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'album');
    await expect(window.locator('.qa-group-by-btn')).toHaveText('Album');

    // Groups sort by their earliest playlist position.
    expect(await rowTitles(topRows(window))).toEqual([ALPHA, BETA, S4]);
    await expect(groupRow(window, ALPHA).locator('.tree-item-count')).toHaveText('2 songs');
    await expect(songRow(window, S1)).toHaveCount(0);

    await groupRow(window, ALPHA).click();
    expect(await rowTitles(songRows(window))).toEqual([S1, S2, S4]);
    await groupRow(window, ALPHA).click();
    await expect(songRow(window, S1)).toHaveCount(0);

    // Expand All opens every group.
    await window.locator('.qa-expand-all').click();
    await expect(songRows(window)).toHaveCount(5);
  });

  test('opening a group selects every song in it, ready to edit together', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'album');
    await window.locator('.qa-collapse-all').click();
    await songRow(window, S4).click();

    // On a preview cell, which opening the group removes.
    await groupRow(window, ALPHA).locator('.col-album').click();
    await expect(songRows(window).and(window.locator('.selected'))).toHaveCount(2);
    expect(await rowTitles(songRows(window).and(window.locator('.selected')))).toEqual([S1, S2]);
    await expect(window.locator('.qa-song-edit-panel')).toBeVisible();

    // The caret opens it the same way.
    await groupRow(window, BETA).locator('.tree-item-icon.chevron').click();
    expect(await rowTitles(songRows(window).and(window.locator('.selected')))).toEqual([S3, S5]);
  });

  test('a collapsed group previews its songs in each column, lined up under the headings', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'album');
    const alpha = groupRow(window, ALPHA);
    const cell = (key) => alpha.locator(`.col-${key}`);

    const seconds = await window.evaluate(async ({ id, names }) =>
      (await window.electronAPI.getListItems(id))
        .filter((it) => names.includes(it.song_title))
        .reduce((sum, it) => sum + it.duration_seconds, 0), { id: playlistId, names: [S1, S2] });
    const total = Math.floor(seconds);

    await expect(cell('track')).toHaveText('1-2');
    await expect(cell('duration')).toHaveText(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
    await expect(cell('rating').locator('.qa-average-stars')).toHaveAttribute('data-rating', '3.5');
    await expect(cell('artist')).toHaveText('Ann + 1');
    await expect(cell('album')).toHaveText(ALPHA);
    await expect(cell('genre')).toHaveText('Rock');
    await expect(cell('date_added')).toHaveText('2022-01-01');
    // On one of the two songs: half strength.
    const tag = cell('tags').locator('.qa-group-tag');
    await expect(tag).toHaveText(`lvtag-${STAMP}`);
    await expect(tag).toHaveCSS('opacity', '0.5');

    const left = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().left));
    expect(await left(cell('genre'))).toBe(await left(songRow(window, S4).locator('.col-genre')));

    // Expanded, the songs speak for themselves.
    await alpha.click();
    await expect(cell('track')).toHaveCount(0);
  });

  test('the column headings scroll sideways with the rows', async ({ window }) => {
    await openPlaylist(window);
    const toggleColumns = async () => {
      await window.locator('.col-header.col-title').click({ button: 'right' });
      for (const key of ['plays', 'last_played']) await window.locator(`.qa-column-option[data-column="${key}"]`).click();
      await window.keyboard.press('Escape');
      await window.locator('#currentListTitle').click();
    };
    await toggleColumns(); // wider than the window now
    const container = window.locator('#explorerContainer');
    const left = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().left));
    const heading = window.locator('.col-header.col-genre');
    const genreCell = songRow(window, S1).locator('.col-genre');
    const offset = async () => (await left(heading)) - (await left(genreCell));

    await container.evaluate((el) => { el.scrollLeft = 0; });
    const before = await offset();
    const headingBefore = await left(heading);
    await container.evaluate((el) => { el.scrollLeft = 120; });
    expect(await container.evaluate((el) => el.scrollLeft)).toBe(120);
    expect(await left(heading)).toBe(headingBefore - 120);
    expect(await offset()).toBe(before);

    await toggleColumns();
  });

  test('an open menu lets clicks through the window-drag strips so they can close it', async ({ window }) => {
    await openPlaylist(window);
    const appRegion = () => window.locator('.explorer-header').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'));
    expect(await appRegion()).toBe('drag');

    await window.locator('.qa-sort-btn').click();
    expect(await appRegion()).toBe('no-drag');
    await window.locator('.explorer-header').click({ position: { x: 5, y: 5 } });
    await expect(window.locator('.qa-sort-menu')).toHaveCount(0);
    expect(await appRegion()).toBe('drag');
  });

  test('double-clicking a group plays just its songs; double-clicking its caret only toggles', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'album');

    const caret = groupRow(window, BETA).locator('.tree-item-icon.chevron');
    await caret.dblclick();
    await expect(window.locator('#playPauseBtn')).not.toHaveClass(/playing/);

    await groupRow(window, BETA).dblclick();
    await expect(nowPlaying(window)).toHaveText(S3);
    await window.locator('#nextBtn').click();
    await expect(nowPlaying(window)).toHaveText(S5);
    await expect(window.locator('#nextBtn')).toBeDisabled();
    await window.locator('#playPauseBtn').click();
  });

  test('the sort menu replaces, adds, flips and removes sort fields', async ({ window }) => {
    await openPlaylist(window);
    const sortBtn = window.locator('.qa-sort-btn');
    const menu = window.locator('.qa-sort-menu');

    await sortBtn.click();
    await menu.locator('.qa-sort-option[data-field="date_added"]').click();
    await expect(sortBtn).toHaveText('Date added A-Z');
    expect(await rowTitles(songRows(window))).toEqual([S5, S2, S3, S1, S4]);

    // The menu stays open while it's being edited.
    await menu.locator('.qa-sort-current[data-field="date_added"] .qa-sort-dir').click();
    await expect(sortBtn).toHaveText('Date added Z-A');
    expect(await rowTitles(songRows(window))).toEqual([S4, S1, S3, S2, S5]);

    // Genre first: Folk before Rock, then date added (newest first) within each.
    await menu.locator('.qa-sort-add[data-field="genre"]').click();
    await expect(menu.locator('.qa-sort-current')).toHaveCount(2);
    await menu.locator('.qa-sort-current[data-field="date_added"] .qa-sort-remove').click();
    await expect(sortBtn).toHaveText('Genre A-Z');
    // Ties on genre fall back to track #, then title; no genre sorts last.
    expect(await rowTitles(songRows(window))).toEqual([S3, S5, S2, S1, S4]);

    await window.locator('#currentListTitle').click();
    await expect(menu).toHaveCount(0);
  });

  test('a grouped list sorts groups by their earliest value, or latest when descending', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'album');
    await sortBy(window, 'date_added');
    // Beta's earliest is 2021, Alpha's 2022, the lone song's 2025.
    expect(await rowTitles(topRows(window))).toEqual([BETA, ALPHA, S4]);

    await window.locator('.qa-sort-btn').click();
    await window.locator('.qa-sort-current .qa-sort-dir').click();
    await window.locator('#currentListTitle').click();
    // Latest: the lone song's 2025, Alpha's 2024, Beta's 2023.
    expect(await rowTitles(topRows(window))).toEqual([S4, ALPHA, BETA]);
  });

  test('settings are remembered per list, and the Main Library defaults to album grouping', async ({ window }) => {
    await openPlaylist(window);
    await chooseGroup(window, 'genre_album');

    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await expect(window.locator('.qa-group-by-btn')).toHaveText('No grouping'); // as the fixture set it
    await openPlaylist(window);
    await expect(window.locator('.qa-group-by-btn')).toHaveText('Genre, then album');

    // Saved where a restart reads them back.
    const saved = await window.evaluate(() => JSON.parse(localStorage.getItem('ludi-list-view-settings')));
    expect(saved[`list:${playlistId}`].groupBy).toBe('genre_album');

    // With nothing saved, the Main Library groups and sorts by album.
    await window.evaluate(() => window.__ludiResetListViews({}));
    await window.locator('.qa-playlist-item[data-list-id="0"]').click();
    await expect(window.locator('.qa-group-by-btn')).toHaveText('Album');
    await expect(window.locator('.qa-sort-btn')).toHaveText('Album A-Z');
  });

  test('rows can be dragged into a new order in playlist order, and only then', async ({ window }) => {
    await openPlaylist(window);
    const before = await playlistOrder(window);

    // Two selected rows move together, keeping their order.
    await songRow(window, S1).click();
    await songRow(window, S2).click({ modifiers: ['Meta'] });
    await drag(window, songRow(window, S1), songRow(window, S4), { below: true });
    await expect.poll(() => playlistOrder(window)).toEqual([S3, S4, S1, S2, S5]);

    // Sorted by anything else, a drag within the list does nothing.
    await sortBy(window, 'title');
    await songRow(window, S5).click();
    await drag(window, songRow(window, S5), songRow(window, S1), { below: false });
    expect(await playlistOrder(window)).toEqual([S3, S4, S1, S2, S5]);

    // Put the playlist back as the other tests expect it.
    await window.evaluate(async ({ listId, order }) => {
      const items = await window.electronAPI.getListItems(listId);
      for (const [position, title] of order.entries()) {
        const item = items.find((it) => it.song_title === title);
        await window.electronAPI.moveItem({ itemId: item.id, newParentListId: listId, newPosition: position });
      }
    }, { listId: playlistId, order: before });
    expect(await playlistOrder(window)).toEqual(before);
  });

  test('right-clicking a column header opens a chooser that toggles columns and stays open', async ({ window }) => {
    await openPlaylist(window);
    const plays = window.locator('.col-header.col-plays');
    const chooser = window.locator('.qa-column-chooser');
    await expect(plays).toHaveCount(0);

    await window.locator('.col-header.col-title').click({ button: 'right' });
    await chooser.locator('.qa-column-option[data-column="plays"]').click();
    await expect(plays).toBeVisible();
    await expect(chooser).toBeVisible();

    await chooser.locator('.qa-column-option[data-column="plays"]').click();
    await expect(plays).toHaveCount(0);

    await window.locator('#currentListTitle').click();
    await expect(chooser).toHaveCount(0);
  });

  test('genre and date added show in their columns and can be edited for several songs at once', async ({ window }) => {
    await openPlaylist(window);
    await expect(songRow(window, S1).locator('.col-genre')).toHaveText('Rock');
    await expect(songRow(window, S1).locator('.col-date_added')).toHaveText('2024-03-01');

    await songRow(window, S1).click();
    await songRow(window, S3).click({ modifiers: ['Meta'] });
    const genre = window.locator('.qa-edit-genre');
    await expect(genre).toHaveAttribute('placeholder', '<multiple>');
    await genre.fill('Jazz');
    await genre.press('Enter');
    await window.locator('.qa-edit-date-added').fill('2020-02-02');

    for (const name of [S1, S3]) {
      await expect(songRow(window, name).locator('.col-genre')).toHaveText('Jazz');
      await expect(songRow(window, name).locator('.col-date_added')).toHaveText('2020-02-02');
    }
    await expect(songRow(window, S2).locator('.col-genre')).toHaveText('Rock');

    // Put them back for the sort tests.
    await window.evaluate(async ({ listId, songs }) => {
      const items = await window.electronAPI.getListItems(listId);
      for (const { name, genre, date_added } of songs) {
        const item = items.find((it) => it.song_title === name);
        await window.electronAPI.updateSong({ songId: item.song_id, fields: { genre, date_added } });
      }
    }, { listId: playlistId, songs: [SONGS[0], SONGS[2]] });
  });

  test('a newly imported song is dated today, in local time', async ({ window }) => {
    const file = path.join(os.tmpdir(), `lv-today-${STAMP}.m4a`);
    fs.copyFileSync(TONE, file);
    const { itemId, dateAdded } = await window.evaluate(async (fp) => {
      const { itemIds } = await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
      const items = await window.electronAPI.getListItems(0);
      return { itemId: itemIds[0], dateAdded: items.find((it) => it.id === itemIds[0]).date_added };
    }, file);
    fs.rmSync(file, { force: true });

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(dateAdded).toBe(today);
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), itemId);
  });
});
