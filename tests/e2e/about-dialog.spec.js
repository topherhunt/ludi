const { test, expect } = require('./fixtures');
const { execSync } = require('child_process');
const path = require('path');

const pkg = require('../../package.json');
const commit = execSync('git rev-parse HEAD', {
  cwd: path.join(__dirname, '../..'),
  encoding: 'utf8',
}).trim().slice(0, 8);

const openAbout = (electronApp) =>
  electronApp.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().getMenuItemById('about').click();
  });

test.describe('About dialog', () => {
  test.afterEach(async ({ window }) => {
    await window.keyboard.press('Escape');
    await expect(window.locator('.qa-about-dialog')).toHaveCount(0);
  });

  test('"About Ludi" is the first item in the Ludi menu', async ({ electronApp }) => {
    const items = await electronApp.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label || item.type)
    );
    expect(items[0]).toBe('About Ludi');
  });

  test('it shows the version, the commit it was built from, and the credit', async ({ electronApp, window }) => {
    await openAbout(electronApp);

    const dialog = window.locator('.qa-about-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.qa-about-build')).toHaveText(`Version ${pkg.version} · build ${commit}`);
    await expect(dialog).toContainText('Made with 💙 by Topher Hunt');
  });

  test('the README link opens in the browser instead of navigating the app', async ({ electronApp, window }) => {
    await openAbout(electronApp);

    // Record what the main process would hand to the OS, so the test doesn't
    // actually launch a browser. The renderer's electronAPI is frozen by the
    // context bridge, so the stub has to go here -- which means the real IPC
    // handler is exercised too.
    await electronApp.evaluate(({ shell }) => {
      global.__opened = [];
      global.__realOpenExternal = shell.openExternal;
      shell.openExternal = async (url) => { global.__opened.push(url); };
    });

    const before = window.url();
    await window.locator('.qa-about-readme').click();

    const opened = await electronApp.evaluate(({ shell }) => {
      shell.openExternal = global.__realOpenExternal;
      return global.__opened;
    });
    expect(opened).toEqual(['https://github.com/topherhunt/ludi/blob/main/README.md']);

    // The window itself must not have followed the href.
    expect(window.url()).toBe(before);
  });
});
