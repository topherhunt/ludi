const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');

// The OS media keys (next/previous) reach the app through the MediaSession API,
// which routes to the same handlers as the on-screen prev/next buttons. We can't
// simulate hardware media keys in Playwright, so we verify (a) the shared
// next/previous logic via the buttons, and (b) that the media session metadata
// is populated on play -- proof the Now Playing integration is actually active,
// which is the prerequisite for macOS to deliver the next/prev keys at all.
test.describe('Media keys / Now Playing', () => {
  async function importTwoSongs(window) {
    const files = [
      path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3'),
      path.join(testAudioDir, 'test-tone.m4a'),
    ];
    await window.evaluate(async (filePaths) => {
      await window.electronAPI.importFiles({ filePaths, parentListId: 0, position: 0 });
    }, files);

    const mainLibraryItem = await window.locator('.playlist-item').first();
    await mainLibraryItem.click();
    await window.waitForTimeout(150);
  }

  test('next button advances to the next song (same path media keys use)', async ({ window }) => {
    await importTwoSongs(window);

    const songRows = window.locator('.tree-item-content[data-is-folder="false"]');
    await expect(songRows.first()).toBeVisible({ timeout: 2000 });

    await songRows.first().dblclick();
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);
    const firstTitle = await window.locator('.player-info .song-title').textContent();

    await window.locator('#nextBtn').click();
    await window.waitForTimeout(300);

    const secondTitle = await window.locator('.player-info .song-title').textContent();
    expect(secondTitle).not.toBe(firstTitle);

    // The highlight follows the now-playing song to the second row.
    await expect(songRows.nth(1)).toHaveClass(/current-song/);

    // Previous returns to the first song.
    await window.locator('#prevBtn').click();
    await window.waitForTimeout(300);
    expect(await window.locator('.player-info .song-title').textContent()).toBe(firstTitle);
    await expect(songRows.first()).toHaveClass(/current-song/);

    await window.locator('#playPauseBtn').click();
    await window.waitForTimeout(50);
  });

  test('media session metadata is populated while playing', async ({ window }) => {
    await importTwoSongs(window);

    const songRow = window.locator('.tree-item-content[data-is-folder="false"]').first();
    await expect(songRow).toBeVisible({ timeout: 2000 });
    await songRow.dblclick();
    await expect(window.locator('#playPauseBtn')).toHaveClass(/playing/);
    await window.waitForTimeout(150);

    const session = await window.evaluate(() => ({
      hasMediaSession: 'mediaSession' in navigator,
      title: navigator.mediaSession.metadata?.title ?? null,
      playbackState: navigator.mediaSession.playbackState,
    }));

    expect(session.hasMediaSession).toBe(true);
    expect(session.title).toBeTruthy();
    expect(session.playbackState).toBe('playing');

    await window.locator('#playPauseBtn').click();
    await window.waitForTimeout(50);
  });
});
