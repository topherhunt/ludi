// Covers the packaged .app, not the dev build: macOS refuses to run (or reports as
// "damaged") a bundle whose code signature doesn't seal its current contents, and that
// breakage is invisible from source-based tests. Requires `npm run release` first.

const { test, expect, _electron: electron } = require('@playwright/test');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_PATH = path.join(__dirname, '../..', 'release', 'mac-arm64', 'Ludi.app');

test.describe('Packaged app', () => {
  test.skip(!fs.existsSync(APP_PATH), 'No packaged build found -- run `npm run release` first');

  test('has a code signature that seals the whole bundle', () => {
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', APP_PATH], { encoding: 'utf8' });
    expect(verify.stderr.trim()).toBe('');
    expect(verify.status).toBe(0);

    // `codesign -d` reports on stderr. An unsigned-by-electron-builder bundle still
    // carries Electron's own linker signature, so check the fields that prove OUR
    // bundle was sealed -- those are what macOS reports as tampering when they're stale.
    const details = spawnSync('codesign', ['-dvvv', APP_PATH], { encoding: 'utf8' });
    const output = details.stdout + details.stderr;
    expect(output).toContain('Identifier=com.topherhunt.ludi');
    expect(output).not.toContain('Info.plist=not bound');
    expect(output).not.toContain('Sealed Resources=none');
  });

  test('launches from the signed bundle and renders the library UI', async () => {
    // Own DB file so this never touches the shared test library the other specs reset.
    const dbPath = path.join(os.tmpdir(), 'ludi-packaged-smoke.sqlite');
    fs.rmSync(dbPath, { force: true });

    const app = await electron.launch({
      executablePath: path.join(APP_PATH, 'Contents', 'MacOS', 'Ludi'),
      env: { ...process.env, NODE_ENV: 'test', LUDI_DB_PATH: dbPath },
    });

    const window = await app.firstWindow({ timeout: 15000 });
    await window.waitForLoadState('domcontentloaded');
    await expect(window.locator('.app-container')).toBeVisible({ timeout: 10000 });
    await expect(window.locator('.explorer-tree')).toBeVisible();

    // The DB file only exists if better-sqlite3's native binary loaded -- the thing
    // hardened runtime + ad-hoc signing (no team identifier) is most likely to break.
    expect(fs.existsSync(dbPath)).toBe(true);

    await app.close();
    fs.rmSync(dbPath, { force: true });
  });
});
