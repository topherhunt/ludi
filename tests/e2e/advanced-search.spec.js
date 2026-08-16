// The Advanced Search composer: every compared field (Track #, Rating, Play
// count, Last played) offers an operator, and the two rating membership values
// hide it because "at least unrated" is meaningless.

const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sourceAudio = path.join(testAudioDir, 'test-tone.m4a');

// Uniquely-named copies, so each test owns songs whose title is searchable.
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

const openComposer = async (window) => {
  await window.keyboard.press('Escape');
  await window.locator('.search-advanced-btn').click();
  await expect(window.locator('.advanced-search-dialog')).toBeVisible();
};

// The composer keeps its condition tree between openings, so every test hands
// it back with the single empty title row the other specs expect to find.
async function resetComposer(window) {
  await openComposer(window);
  while (await window.locator('.advsearch-condition-row').count() > 1) {
    await window.locator('.advsearch-condition-row').nth(1).locator('.advsearch-remove-btn').click();
  }
  await window.locator('.advsearch-field-select').first().selectOption('title');
  await window.locator('.advsearch-value-input').first().fill('');
  await window.locator('.modal-btn-secondary').filter({ hasText: 'Cancel' }).click();
  await window.waitForTimeout(100);
}

// Deleting only works from the library view with the row selected, so this
// leaves the search results first rather than pressing Backspace at whatever
// happens to be on screen.
async function cleanUp(window, songIds) {
  await window.keyboard.press('Escape');
  const clearBtn = window.locator('.search-clear-btn');
  if (await clearBtn.count() > 0) await clearBtn.first().click();
  await window.locator('.playlist-item').first().click();
  await window.waitForTimeout(200);

  for (const songId of songIds) {
    const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    if (await row.count() === 0) continue;
    await expect(row).toBeVisible({ timeout: 2000 });
    // Backspace is ignored unless something is selected, and a list that is
    // still rendering drops the click, so click until the row lights up.
    await expect(async () => {
      await row.click();
      await expect(row).toHaveClass(/selected/, { timeout: 500 });
    }).toPass({ timeout: 5000 });
    await window.keyboard.press('Backspace');
    await expect(window.locator('#modalYesBtn')).toBeVisible({ timeout: 2000 });
    await window.locator('#modalYesBtn').click();
    await expect(row).toHaveCount(0, { timeout: 2000 });
  }
}

test.describe('Advanced search composer', () => {
  test('Track # is compared with an operator, not matched exactly', async ({ window }) => {
    const { stamp, songs } = await importSongs(window, 'advsearch-track', 2);
    const [early, late] = songs.map(s => s.songId);

    await window.evaluate(async ([lowId, highId]) => {
      await window.electronAPI.updateSong({ songId: lowId, fields: { track_number: 3 } });
      await window.electronAPI.updateSong({ songId: highId, fields: { track_number: 9 } });
    }, [early, late]);

    await openComposer(window);
    await window.locator('.advsearch-field-select').first().selectOption('title');
    await window.locator('.advsearch-value-input').first().fill(stamp);

    await window.locator('.advsearch-action-btn').filter({ hasText: 'Condition' }).first().click();
    await window.locator('.advsearch-field-select').nth(1).selectOption('track');
    await expect(window.locator('.qa-compare-op')).toBeVisible();
    await window.locator('.qa-compare-op').selectOption('>=');
    await window.locator('.advsearch-condition-row').nth(1).locator('.advsearch-value-input').fill('9');

    await window.locator('.modal-btn').filter({ hasText: 'Search' }).click();
    await window.waitForTimeout(300);

    // Track 3 is filtered out, which is what proves the composer emitted
    // `track>=9` rather than the old `track=9` equality.
    const results = window.locator('.qa-search-song');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(late));

    await resetComposer(window);
    await cleanUp(window, [early, late]);
  });

  test('the rating membership values hide the operator and search as membership', async ({ window }) => {
    const { stamp, songs } = await importSongs(window, 'advsearch-unrated', 2);
    const [rated, unrated] = songs.map(s => s.songId);

    await window.locator(`.tree-item-content[data-song-id="${rated}"]`).click();
    await window.keyboard.press('4');
    await expect(window.locator(`.tree-item-content[data-song-id="${rated}"] .qa-star-rating`))
      .toHaveAttribute('data-rating', '4', { timeout: 2000 });

    await openComposer(window);
    await window.locator('.advsearch-field-select').first().selectOption('title');
    await window.locator('.advsearch-value-input').first().fill(stamp);

    await window.locator('.advsearch-action-btn').filter({ hasText: 'Condition' }).first().click();
    await window.locator('.advsearch-field-select').nth(1).selectOption('rating');
    await expect(window.locator('.qa-compare-op')).toBeVisible();

    // "is at least unrated" is nonsense, so choosing a membership value takes
    // the operator away instead of leaving a stale one beside it.
    await window.locator('.qa-rating-value').selectOption('none');
    await expect(window.locator('.qa-compare-op')).toHaveCount(0);
    await window.locator('.qa-rating-value').selectOption('3');
    await expect(window.locator('.qa-compare-op')).toBeVisible();
    await window.locator('.qa-rating-value').selectOption('none');

    await window.locator('.modal-btn').filter({ hasText: 'Search' }).click();
    await window.waitForTimeout(300);

    // Only the song with no rating comes back: the query ran as a membership
    // test, ignoring whatever the operator had been set to.
    const results = window.locator('.qa-search-song');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(unrated));

    await resetComposer(window);
    await cleanUp(window, [rated, unrated]);
  });
});
