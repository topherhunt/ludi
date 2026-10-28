const { test, expect } = require('./fixtures');
const os = require('os');
const fs = require('fs');
const path = require('path');

test.describe('Window close behavior', () => {
  test('closing the window hides it instead of destroying it (playback keeps running)', async ({ electronApp }) => {
    test.skip(process.platform !== 'darwin', 'hide-on-close is macOS-only');

    const state = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      const win = wins.find((w) => w.webContents.getURL().includes('index.html')) || wins[0];
      // Test mode starts hidden, so this assertion only means something once shown.
      // showInactive() so the window can't steal focus; it's hidden again by close().
      win.showInactive();
      const visibleBefore = win.isVisible();
      win.close();
      return { visibleBefore, destroyed: win.isDestroyed(), visible: win.isDestroyed() ? false : win.isVisible() };
    });

    expect(state.visibleBefore).toBe(true);
    // Not destroyed => the renderer (and Howler playback) stays alive; just hidden.
    expect(state.destroyed).toBe(false);
    expect(state.visible).toBe(false);
  });

  // Reopening at these bounds on the next launch is covered by tests/unit/window-bounds.test.js.
  test('closing the window saves its size and position for the next launch', async ({ electronApp, window }) => {
    const original = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      const bounds = win.getBounds();
      win.setBounds({ x: 40, y: 60, width: 1000, height: 700 });
      win.close();
      return bounds;
    });

    const settings = await window.evaluate(() => window.electronAPI.getSettings());
    expect(JSON.parse(settings.window_bounds)).toEqual({ x: 40, y: 60, width: 1000, height: 700 });

    await electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html')).setBounds(bounds);
    }, original);
  });
});

test.describe('Test mode stays out of the way', () => {
  test('windows are hidden, audio is muted, media keys are left alone and the app has no Dock icon', async ({ electronApp }) => {
    const state = await electronApp.evaluate(({ app, BrowserWindow, globalShortcut }) => ({
      windows: BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), muted: w.webContents.isAudioMuted(), url: w.webContents.getURL() })),
      dockVisible: process.platform === 'darwin' ? app.dock.isVisible() : false,
      mediaShortcuts: ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack'].filter((k) => globalShortcut.isRegistered(k)),
      disabledFeatures: app.commandLine.getSwitchValue('disable-features'),
    }));

    const main = state.windows.find((w) => w.url.includes('index.html'));
    expect(main.muted).toBe(true);
    expect(state.windows.filter((w) => w.visible)).toEqual([]);
    expect(state.dockVisible).toBe(false);
    expect(state.mediaShortcuts).toEqual([]);
    expect(state.disabledFeatures).toContain('HardwareMediaKeyHandling');
  });

  test('the database, library folder and browser profile all live in the run\'s temp dir', async ({ electronApp, window }) => {
    const { testHome, userData } = await electronApp.evaluate(({ app }) => ({
      testHome: process.env.LUDI_TEST_HOME, userData: app.getPath('userData'),
    }));
    const settings = await window.evaluate(() => window.electronAPI.getSettings());
    expect(testHome.startsWith(os.tmpdir())).toBe(true);
    expect(userData.startsWith(testHome)).toBe(true);
    expect(settings.library_path.startsWith(testHome)).toBe(true);
    expect(fs.existsSync(path.join(testHome, 'ludi-library-test.sqlite'))).toBe(true);
  });
});
