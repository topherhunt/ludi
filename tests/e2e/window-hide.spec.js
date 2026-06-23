const { test, expect } = require('./fixtures');

test.describe('Window close behavior', () => {
  test('closing the window hides it instead of destroying it (playback keeps running)', async ({ electronApp }) => {
    test.skip(process.platform !== 'darwin', 'hide-on-close is macOS-only');

    const state = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      const win = wins.find((w) => w.webContents.getURL().includes('index.html')) || wins[0];
      try {
        win.close();
        return { destroyed: win.isDestroyed(), visible: win.isDestroyed() ? false : win.isVisible() };
      } finally {
        // Always restore the shared window for subsequent tests.
        if (!win.isDestroyed()) win.show();
      }
    });

    // Not destroyed => the renderer (and Howler playback) stays alive; just hidden.
    expect(state.destroyed).toBe(false);
    expect(state.visible).toBe(false);
  });
});
