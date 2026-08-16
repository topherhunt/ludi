// The dev build runs from the repo, so main-process code can require anything on disk.
// The packaged app only contains what build.files copies into the asar -- a require that
// escapes those globs resolves fine in dev and crashes on launch in the .dmg. This test
// walks the real requires so that mismatch fails here, not on a user's machine.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MAIN_DIR = path.join(ROOT, 'src/main');
const FILE_GLOBS = require('../../package.json').build.files;

function jsFilesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesIn(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// Every build.files entry is either a literal path or `<dir>/**/*`, so matching the
// static prefix is enough -- no glob library needed.
function isPackaged(relPath) {
  return FILE_GLOBS.some((glob) => {
    if (!glob.includes('*')) return relPath === glob;
    return relPath.startsWith(glob.slice(0, glob.indexOf('*')));
  });
}

test('every file the main process requires is packaged into the app', () => {
  const unpackaged = [];

  for (const file of jsFilesIn(MAIN_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const resolved = require.resolve(path.resolve(path.dirname(file), specifier));
      const relPath = path.relative(ROOT, resolved);
      if (!isPackaged(relPath)) unpackaged.push(`${path.relative(ROOT, file)} requires ${relPath}`);
    }
  }

  expect(unpackaged).toEqual([]);
});
