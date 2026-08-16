const { test, expect, testAudioDir } = require('./fixtures');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * The two places the analysis pass reports on itself: the Settings panel that
 * starts it, and the strip at the bottom of the main window's sidebar.
 *
 * Nothing here runs the analyzer -- that is analysis.spec.js's job, and it costs
 * minutes. This drives the queue's own bookkeeping functions to produce a failed
 * song, and pushes a progress broadcast from main, so both read-outs are
 * exercised against the real IPC they listen on.
 */

const SOURCE_AUDIO = path.join(testAudioDir, 'test-tone.m4a');
const DATABASE_MODULE = path.resolve(__dirname, '../../src/main/database.js');

const SONG_TITLE = 'Unreadable Fixture';
const FAILURE_MESSAGE = 'codec exploded';

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
  return settings;
}

test.describe('Analysis progress reporting', () => {
  let itemId = null;
  let songId = null;
  let tempFile = null;

  test.beforeAll(async ({ window, electronApp }) => {
    tempFile = path.join(os.tmpdir(), `ludi-analysis-panel-${Date.now()}.m4a`);
    fs.copyFileSync(SOURCE_AUDIO, tempFile);

    const imported = await window.evaluate(
      (filePath) => window.electronAPI.importFiles({ filePaths: [filePath], parentListId: 0, position: 0 }),
      tempFile
    );
    expect(imported.errors).toEqual([]);
    songId = imported.imported[0].songId;
    itemId = imported.itemIds[0];

    // Drive the song to 'failed' the way the analyzer does: claim it, fail it,
    // three times over, so it exhausts MAX_ANALYSIS_ATTEMPTS.
    await electronApp.evaluate(async (unused, { modulePath, id, title, message }) => {
      const db = process.mainModule.require(modulePath);
      db.updateSong(id, { title, artist: '' });
      db.enqueueForAnalysis([id]);
      for (let attempt = 0; attempt < 3; attempt++) {
        db.claimAnalysisTasks(50);
        db.failAnalysis(id, message);
      }
    }, { modulePath: DATABASE_MODULE, id: songId, title: SONG_TITLE, message: FAILURE_MESSAGE });
  });

  test.afterAll(async () => {
    const { setupElectronApp } = require('./fixtures');
    const { window } = await setupElectronApp();
    await window.evaluate((id) => window.electronAPI.deleteItemWithFiles(id), itemId);
    if (tempFile) fs.rmSync(tempFile, { force: true });
  });

  test('the sidebar strip tracks a running pass and disappears when it stops', async ({ window, electronApp }) => {
    await expect(window.locator('.qa-analysis-progress')).toHaveCount(0);

    const push = (payload) => electronApp.evaluate(async ({ BrowserWindow }, progress) => {
      const main = BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
      main.webContents.send('analysis:progress', progress);
    }, payload);

    await push({ total: 40, analyzed: 3, pending: 7, failed: 0, running: true });
    await expect(window.locator('.qa-analysis-progress-text')).toHaveText('Analyzing 3 of 10');
    await expect(window.locator('.qa-analysis-progress')).toHaveAttribute('data-percent', '30');

    await push({ total: 40, analyzed: 8, pending: 2, failed: 0, running: true });
    await expect(window.locator('.qa-analysis-progress-text')).toHaveText('Analyzing 8 of 10');
    await expect(window.locator('.qa-analysis-progress')).toHaveAttribute('data-percent', '80');

    await push({ total: 40, analyzed: 10, pending: 0, failed: 0, running: false });
    await expect(window.locator('.qa-analysis-progress')).toHaveCount(0);
  });

  test('the sidebar strip reports failures as they happen, not at the end', async ({ window, electronApp }) => {
    const push = (payload) => electronApp.evaluate(async ({ BrowserWindow }, progress) => {
      const main = BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
      main.webContents.send('analysis:progress', progress);
    }, payload);

    // A pass whose very first song failed. Nothing about that should have to
    // wait for the other 3900 -- that is hours of watching a bar fill up for
    // nothing before finding out.
    await push({ total: 4000, analyzed: 0, pending: 3999, failed: 1, running: true });
    await expect(window.locator('.qa-analysis-failed-count')).toHaveText('1 failed');

    await push({ total: 4000, analyzed: 2, pending: 3900, failed: 98, running: true });
    await expect(window.locator('.qa-analysis-failed-count')).toHaveText('98 failed');

    // No failures, no scolding.
    await push({ total: 4000, analyzed: 100, pending: 3900, failed: 0, running: true });
    await expect(window.locator('.qa-analysis-failed-count')).toHaveCount(0);

    await push({ total: 40, analyzed: 10, pending: 0, failed: 0, running: false });
    await expect(window.locator('.qa-analysis-progress')).toHaveCount(0);
  });

  test('Settings reports the queue\'s own counts and lists what failed', async ({ window, electronApp }) => {
    const stats = await window.evaluate(() => window.electronAPI.getAnalysisProgress());
    expect(stats.failed).toBe(1);

    const settings = await openSettings(electronApp);

    await expect(settings.locator('.qa-analysis-status')).toContainText(
      `${stats.analyzed} of ${stats.total} songs analyzed`
    );
    await expect(settings.locator('.qa-show-failures')).toHaveText('1 failed');
    await expect(settings.locator('.qa-retry-analysis')).toHaveText('Retry 1 failed');

    // The list is closed until the count is clicked, and closes again on a second click.
    await expect(settings.locator('.qa-failure-list')).toHaveCount(0);
    await settings.locator('.qa-show-failures').click();
    const row = settings.locator(`.qa-failure-row[data-song-id="${songId}"]`);
    await expect(row).toContainText(SONG_TITLE);
    await expect(row).toContainText(FAILURE_MESSAGE);

    await settings.locator('.qa-show-failures').click();
    await expect(settings.locator('.qa-failure-list')).toHaveCount(0);

    await settings.close();
  });

  test('Settings surfaces failures while the pass is still running', async ({ electronApp }) => {
    const settings = await openSettings(electronApp);

    const push = (payload) => electronApp.evaluate(async ({ BrowserWindow }, progress) => {
      const target = BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('settings.html'));
      target.webContents.send('analysis:progress', progress);
    }, payload);

    // The count and the list used to live only in the not-running branch, so a
    // pass that was failing every single song looked perfectly healthy until it
    // finished hours later. Push until it lands -- a window that has just opened
    // may not have subscribed yet.
    await expect(async () => {
      await push({ total: 4000, analyzed: 292, pending: 99, failed: 3609, running: true });
      await expect(settings.locator('.qa-analysis-status')).toContainText('Analyzing... 292 of 4000 done', { timeout: 500 });
    }).toPass({ timeout: 5000 });
    await expect(settings.locator('.qa-show-failures')).toHaveText('3609 failed');

    await settings.locator('.qa-show-failures').click();
    await expect(settings.locator(`.qa-failure-row[data-song-id="${songId}"]`))
      .toContainText(FAILURE_MESSAGE);

    // Stopping is still the offer while it runs; retrying comes after.
    await expect(settings.locator('.qa-stop-analysis')).toBeVisible();
    await expect(settings.locator('.qa-retry-analysis')).toHaveCount(0);

    await settings.close();
  });
});
