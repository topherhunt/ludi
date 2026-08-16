// Play count and last-played date: the app records a play only once you have
// actually listened to a track, so these drive real playback rather than
// calling the recording API directly.

const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sourceAudio = path.join(testAudioDir, 'test-tone.m4a');

// A uniquely-named copy, so the song starts with a clean history and its
// filename-derived title is searchable.
async function importSong(window, prefix) {
  const stamp = `${prefix}-${Date.now()}`;
  const filePath = path.join(os.tmpdir(), `ludi-${stamp}.m4a`);
  fs.copyFileSync(sourceAudio, filePath);

  const imported = await window.evaluate(async (fp) => {
    const result = await window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 });
    return result.imported;
  }, filePath);
  fs.rmSync(filePath, { force: true });

  await window.keyboard.press('Escape');
  await window.locator('.playlist-item').first().click();
  await window.waitForTimeout(200);

  return { stamp, songId: imported[0].songId };
}

const historyOf = (window, songId) =>
  window.evaluate(async (id) => {
    const song = await window.electronAPI.getSong(id);
    return { play_count: song.play_count, last_played_at: song.last_played_at };
  }, songId);

// Listening time only accrues once Howler reports the track playing, which
// lags the double-click by a variable load -- so the wait starts from the
// button turning over, not from the click.
async function playFor(window, songId, thresholdMs, listenMs) {
  const playPauseBtn = window.locator('#playPauseBtn');
  await window.evaluate((ms) => { window.__ludiPlayThresholdMs = ms; }, thresholdMs);
  await window.locator(`.tree-item-content[data-song-id="${songId}"]`).dblclick();
  await expect(playPauseBtn).toHaveClass(/playing/, { timeout: 4000 });
  await window.waitForTimeout(listenMs);
  await playPauseBtn.click(); // stop, so the queue doesn't roll on
  await expect(playPauseBtn).not.toHaveClass(/playing/, { timeout: 2000 });
  await window.evaluate(() => { delete window.__ludiPlayThresholdMs; });
}

// Deleting only works from the library view with the row selected, so this
// leaves any search results first rather than pressing Backspace at whatever
// happens to be on screen.
async function deleteSong(window, songId) {
  await window.keyboard.press('Escape');
  const clearBtn = window.locator('.search-clear-btn');
  if (await clearBtn.count() > 0) await clearBtn.first().click();
  await window.locator('.playlist-item').first().click();
  await window.waitForTimeout(200);

  const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
  if (await row.count() === 0) return;
  // Backspace is ignored unless something is selected, and a list that is still
  // rendering drops the click, so click until the row actually lights up.
  await expect(async () => {
    await row.click();
    await expect(row).toHaveClass(/selected/, { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await window.keyboard.press('Backspace');
  await expect(window.locator('#modalYesBtn')).toBeVisible({ timeout: 2000 });
  await window.locator('#modalYesBtn').click();
  await expect(row).toHaveCount(0, { timeout: 2000 });
}

test.describe('Play history', () => {
  test('listening past the threshold counts a play and stamps the date', async ({ window }) => {
    const { songId } = await importSong(window, 'played');

    expect(await historyOf(window, songId)).toEqual({ play_count: 0, last_played_at: null });

    await playFor(window, songId, 0, 600);

    // The count is written over IPC a beat after the play is reported.
    await expect.poll(async () => (await historyOf(window, songId)).play_count, { timeout: 3000 }).toBe(1);
    expect((await historyOf(window, songId)).last_played_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await deleteSong(window, songId);
  });

  test('a track cut off before the threshold is not counted', async ({ window }) => {
    const { songId } = await importSong(window, 'skipped');

    // A minute of required listening that the test never gives it -- this is
    // the click-down-a-list case that must not inflate the count.
    await playFor(window, songId, 60000, 600);

    expect(await historyOf(window, songId)).toEqual({ play_count: 0, last_played_at: null });

    await deleteSong(window, songId);
  });

  test('a played song is findable by play count and by last-played date', async ({ window }) => {
    const { stamp, songId } = await importSong(window, 'searchable');
    await playFor(window, songId, 0, 600);

    const today = new Date().toISOString().slice(0, 10);
    const searchBox = window.locator('.search-input');

    for (const query of [`${stamp} plays>=1`, `${stamp} lastplayed>=${today}`]) {
      await searchBox.fill(query);
      await searchBox.press('Enter');
      await window.waitForTimeout(400);
      const results = window.locator('.qa-search-song');
      await expect(results).toHaveCount(1);
      await expect(results.first()).toHaveAttribute('data-song-id', String(songId));
    }

    // ...and excluded by the queries that say it has not been played.
    await searchBox.fill(`${stamp} plays=0`);
    await searchBox.press('Enter');
    await window.waitForTimeout(400);
    await expect(window.locator('.qa-search-song')).toHaveCount(0);

    await deleteSong(window, songId);
  });

  test('the advanced search composer builds play-count and last-played filters', async ({ window }) => {
    const { stamp, songId } = await importSong(window, 'advsearch-history');
    await playFor(window, songId, 0, 600);

    const openComposer = async () => {
      await window.keyboard.press('Escape');
      await window.locator('.search-advanced-btn').click();
      await expect(window.locator('.advanced-search-dialog')).toBeVisible();
    };
    const runSearch = () => window.locator('.modal-btn').filter({ hasText: 'Search' }).click();
    const results = window.locator('.qa-search-song');

    await openComposer();
    await window.locator('.advsearch-field-select').first().selectOption('title');
    await window.locator('.advsearch-value-input').first().fill(stamp);
    await window.locator('.advsearch-action-btn').filter({ hasText: 'Condition' }).first().click();

    const secondRow = window.locator('.advsearch-condition-row').nth(1);
    await window.locator('.advsearch-field-select').nth(1).selectOption('plays');
    await window.locator('.qa-compare-op').selectOption('>=');
    await secondRow.locator('.advsearch-value-input').fill('1');
    await runSearch();
    await window.waitForTimeout(300);
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(songId));

    // The same row switched to Last played swaps in a date picker, and the
    // operator relabels itself rather than offering "is at least June 1".
    await openComposer();
    await window.locator('.advsearch-field-select').nth(1).selectOption('lastplayed');
    await expect(window.locator('.qa-compare-op')).toContainText('is on or after');
    await window.locator('.qa-compare-op').selectOption('>=');
    await window.locator('.qa-date-value').fill(new Date().toISOString().slice(0, 10));
    await runSearch();
    await window.waitForTimeout(300);
    await expect(results).toHaveCount(1);
    await expect(results.first()).toHaveAttribute('data-song-id', String(songId));

    // Hand the composer back with the single empty title row other specs expect.
    await openComposer();
    await secondRow.locator('.advsearch-remove-btn').click();
    await expect(window.locator('.advsearch-condition-row')).toHaveCount(1);
    await window.locator('.advsearch-value-input').first().fill('');
    await window.locator('.modal-btn-secondary').filter({ hasText: 'Cancel' }).click();

    await deleteSong(window, songId);
  });
});
