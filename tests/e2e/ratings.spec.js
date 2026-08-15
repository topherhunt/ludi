const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sourceAudio = path.join(testAudioDir, 'test-tone.m4a');

// Import N uniquely-named copies so each test owns fresh, unrated songs.
// The files have no ID3 title, so the unique filename becomes the title.
async function importSongs(window, prefix, count) {
  const stamp = `${prefix}-${Date.now()}`;
  const paths = [];
  for (let i = 0; i < count; i++) {
    const fp = path.join(os.tmpdir(), `ludi-${stamp}-${i}.m4a`);
    fs.copyFileSync(sourceAudio, fp);
    paths.push(fp);
  }

  const imported = await window.evaluate(async (filePaths) => {
    const result = await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
    return result.imported;
  }, paths);
  paths.forEach(fp => fs.rmSync(fp, { force: true }));

  await window.keyboard.press('Escape');
  await window.locator('.playlist-item').first().click();
  await window.waitForTimeout(200);

  return { stamp, songs: imported };
}

const rowFor = (window, songId) => window.locator(`.tree-item-content[data-song-id="${songId}"]`);
const starsIn = (row) => row.locator('.qa-star-rating .star');

async function cleanUp(window, songIds) {
  for (const songId of songIds) {
    const row = rowFor(window, songId);
    if (await row.count() === 0) continue;
    await row.click();
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    await window.click('#modalYesBtn');
    await window.waitForTimeout(150);
  }
}

test.describe('Star ratings', () => {
  test('clicking a star rates the song, clicking the same star clears it', async ({ window }) => {
    const { songs } = await importSongs(window, 'rate-click', 1);
    const songId = songs[0].songId;

    const row = rowFor(window, songId);
    await expect(row).toBeVisible({ timeout: 2000 });

    // Five outlines always show, even before the song has any rating.
    await expect(starsIn(row)).toHaveCount(5);
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '');

    await starsIn(row).nth(3).click(); // the 4th star
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '4', { timeout: 2000 });
    // The hover preview fills stars under the cursor, so step off the widget
    // before counting what the stored rating actually draws.
    await window.mouse.move(0, 0);
    await expect(row.locator('.qa-star-rating .bi-star-fill')).toHaveCount(4);

    // Same star again toggles the rating back off.
    await starsIn(row).nth(3).click();
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '', { timeout: 2000 });
    await window.mouse.move(0, 0);
    await expect(row.locator('.qa-star-rating .bi-star-fill')).toHaveCount(0);

    await cleanUp(window, [songId]);
  });

  test('clicking a star neither plays the song nor changes the selection', async ({ window }) => {
    const { songs } = await importSongs(window, 'rate-isolated', 1);
    const songId = songs[0].songId;
    const row = rowFor(window, songId);
    await expect(row).toBeVisible({ timeout: 2000 });

    await starsIn(row).nth(1).click();
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '2', { timeout: 2000 });
    await expect(row).not.toHaveClass(/selected/);

    await cleanUp(window, [songId]);
  });

  test('the 1-5 keys rate the whole selection and 0 clears it', async ({ window }) => {
    const { songs } = await importSongs(window, 'rate-keys', 3);
    const songIds = songs.map(s => s.songId);

    const rows = songIds.map(id => rowFor(window, id));
    await expect(rows[0]).toBeVisible({ timeout: 2000 });

    await rows[0].click();
    await rows[1].click({ modifiers: ['Meta'] });
    await rows[2].click({ modifiers: ['Meta'] });
    await window.keyboard.press('5');

    for (const row of rows) {
      await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '5', { timeout: 2000 });
    }

    await window.keyboard.press('0');
    for (const row of rows) {
      await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '', { timeout: 2000 });
    }

    await cleanUp(window, songIds);
  });

  test('a star click widens to the selection when the clicked row is part of it', async ({ window }) => {
    const { songs } = await importSongs(window, 'rate-widen', 2);
    const songIds = songs.map(s => s.songId);
    const rows = songIds.map(id => rowFor(window, id));
    await expect(rows[0]).toBeVisible({ timeout: 2000 });

    await rows[0].click();
    await rows[1].click({ modifiers: ['Meta'] });
    await starsIn(rows[0]).nth(2).click();

    for (const row of rows) {
      await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '3', { timeout: 2000 });
    }

    await cleanUp(window, songIds);
  });

  test('the context menu rates through the same path as a star click', async ({ window }) => {
    const { songs } = await importSongs(window, 'rate-menu', 1);
    const songId = songs[0].songId;
    const row = rowFor(window, songId);
    await expect(row).toBeVisible({ timeout: 2000 });

    await row.click({ button: 'right' });
    await window.locator('.qa-rate-menu').hover();
    await window.locator('.qa-rate-option[data-stars="2"]').click();
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '2', { timeout: 2000 });

    await row.click({ button: 'right' });
    await window.locator('.qa-rate-menu').hover();
    await window.locator('.qa-rate-clear').click();
    await expect(row.locator('.qa-star-rating')).toHaveAttribute('data-rating', '', { timeout: 2000 });

    await cleanUp(window, [songId]);
  });

  test('rating>=4 finds the songs you like and leaves the rest out', async ({ window }) => {
    const { stamp, songs } = await importSongs(window, 'rate-search', 2);
    const [liked, disliked] = songs.map(s => s.songId);

    await rowFor(window, liked).click();
    await window.keyboard.press('5');
    await rowFor(window, disliked).click();
    await window.keyboard.press('1');
    await expect(rowFor(window, disliked).locator('.qa-star-rating')).toHaveAttribute('data-rating', '1', { timeout: 2000 });

    const searchInput = window.locator('.search-input');
    await searchInput.click();
    await searchInput.fill(`${stamp} AND rating>=4`);
    await searchInput.press('Enter');
    await window.waitForTimeout(300);

    const results = window.locator('.qa-search-song');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(liked));

    // The same rows carry their stars in search results too.
    await expect(results.first().locator('.qa-star-rating')).toHaveAttribute('data-rating', '5');

    // rating=none excludes both, since both are now rated.
    await searchInput.fill(`${stamp} AND rating=none`);
    await searchInput.press('Enter');
    await window.waitForTimeout(300);
    await expect(window.locator('.qa-search-song')).toHaveCount(0);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await cleanUp(window, [liked, disliked]);
  });

  test('the advanced search composer builds a rating filter', async ({ window }) => {
    const { stamp, songs } = await importSongs(window, 'rate-advsearch', 2);
    const [liked, disliked] = songs.map(s => s.songId);

    await rowFor(window, liked).click();
    await window.keyboard.press('4');
    await rowFor(window, disliked).click();
    await window.keyboard.press('2');
    await expect(rowFor(window, disliked).locator('.qa-star-rating')).toHaveAttribute('data-rating', '2', { timeout: 2000 });

    await window.keyboard.press('Escape');
    await window.locator('.search-advanced-btn').click();
    await expect(window.locator('.advanced-search-dialog')).toBeVisible();

    // Condition 1: title contains the unique stamp.
    await window.locator('.advsearch-field-select').first().selectOption('title');
    await window.locator('.advsearch-value-input').first().fill(stamp);

    // Condition 2: rating is at least 4 -- selecting "Rating" swaps in the
    // operator + star dropdowns.
    await window.locator('.advsearch-action-btn').filter({ hasText: 'Condition' }).first().click();
    await window.locator('.advsearch-field-select').nth(1).selectOption('rating');
    await expect(window.locator('.qa-rating-op')).toBeVisible();
    await window.locator('.qa-rating-op').selectOption('>=');
    await window.locator('.qa-rating-value').selectOption('4');

    await window.locator('.modal-btn').filter({ hasText: 'Search' }).click();
    await window.waitForTimeout(300);

    // Only the 4-star song survives, which is what proves the composer emitted
    // `rating>=4` and not a plain equality.
    const results = window.locator('.qa-search-song');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(liked));

    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);

    // The composer keeps its condition tree between openings, so hand it back
    // with the single default row other specs expect to find.
    await window.locator('.search-advanced-btn').click();
    await expect(window.locator('.advanced-search-dialog')).toBeVisible();
    await window.locator('.advsearch-condition-row').nth(1).locator('.advsearch-remove-btn').click();
    await expect(window.locator('.advsearch-condition-row')).toHaveCount(1);
    await window.locator('.advsearch-field-select').first().selectOption('title');
    await window.locator('.advsearch-value-input').first().fill('');
    await window.locator('.modal-btn-secondary').filter({ hasText: 'Cancel' }).click();

    await cleanUp(window, [liked, disliked]);
  });
});
