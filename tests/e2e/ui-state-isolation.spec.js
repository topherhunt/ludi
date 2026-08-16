const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The renderer persists two pieces of layout state in localStorage -- sidebar
 * width and column visibility -- and localStorage lives in the Electron profile,
 * which nothing in the harness used to clear. So a run that resized the sidebar
 * moved every column in every song row 30px to the right, in that run and in
 * every run afterwards, forever.
 *
 * That matters more than it sounds: `row.click()` clicks the centre of the row,
 * which normally lands on dead space in the rating column. Thirty pixels over,
 * it lands on a star -- and rating a song deliberately leaves the selection
 * alone, so the row never got selected and a dozen specs across tags,
 * song-edit-panel, song-context-menu and similarity failed with nothing in
 * common but a timeout.
 *
 * Deliberately named to sort near the end of the suite, so it sees whatever the
 * specs before it left behind.
 */

const SOURCE_AUDIO = path.join(testAudioDir, '02 Jump Into My Mouth and Breathe in the Stardust.mp3');

test.describe('UI state isolation', () => {
  test('the session runs at the default layout, whatever earlier specs did to it', async ({ window }) => {
    const width = await window.evaluate(() =>
      getComputedStyle(document.querySelector('.app-container')).getPropertyValue('--sidebar-width').trim()
    );
    expect(width).toBe('200px');

    // Column visibility shifts the row layout just as much as sidebar width.
    const columns = await window.evaluate(() => localStorage.getItem('ludi-column-settings'));
    expect(columns).toBe(null);
  });

  test('clicking the middle of a song row selects it rather than rating it', async ({ window }) => {
    const uniqueFile = path.join(os.tmpdir(), `ludi-rowclick-${Date.now()}.mp3`);
    fs.copyFileSync(SOURCE_AUDIO, uniqueFile);

    const imported = await window.evaluate(
      (fp) => window.electronAPI.importFiles({ filePaths: [fp], parentListId: 0, position: 0 }),
      uniqueFile
    );
    const songId = imported.imported[0].songId;

    await window.locator('.playlist-item').first().click();
    await window.waitForTimeout(150);

    const row = window.locator(`.tree-item-content[data-song-id="${songId}"]`);
    await expect(row).toBeVisible({ timeout: 2000 });
    await row.click();

    await expect(row).toHaveClass(/selected/);
    // ...and it did not quietly rate the song on the way past.
    const song = await window.evaluate((id) => window.electronAPI.getSong(id), songId);
    expect(song.rating).toBeFalsy();

    await window.keyboard.press('Backspace');
    await window.click('#modalYesBtn');
    await window.waitForTimeout(150);
    fs.rmSync(uniqueFile, { force: true });
  });
});
