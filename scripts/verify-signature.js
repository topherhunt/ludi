// Build-time gate: prove the packaged .app carries a valid, complete code signature.
//
// WHY: without `mac.identity` set, electron-builder finds no Developer ID cert on this
// machine and skips signing entirely. The app is NOT left unsigned -- it keeps the stock
// Electron executable's linker-signed ad-hoc signature, while electron-builder goes on to
// rewrite Info.plist (bundle id, name) and add Resources around it. macOS then sees a
// signature describing a bundle that no longer exists and reports the app as "damaged and
// can't be opened", with no "Open Anyway" escape -- strictly worse than being unsigned.
//
// `mac.identity: "-"` makes electron-builder ad-hoc sign the whole bundle, which seals the
// resources and binds Info.plist. This hook fails the build if that ever stops happening,
// so the breakage surfaces here rather than in someone's Downloads folder.

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

function verifyAppSignature(appPath) {
  // Exits non-zero if the signature doesn't match the bundle's current contents.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  // --verify alone can pass on a bundle whose Info.plist and resources were never sealed,
  // so assert the specific fields that were broken. `codesign -d` reports on stderr.
  const result = spawnSync('codesign', ['-dvvv', appPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`codesign -dvvv failed for ${appPath}: ${result.stderr}`);
  }
  const details = result.stdout + result.stderr;

  if (details.includes('Info.plist=not bound')) {
    throw new Error(`${appPath}: Info.plist is not bound to the code signature -- macOS will report this app as damaged.`);
  }
  if (details.includes('Sealed Resources=none')) {
    throw new Error(`${appPath}: bundle resources are not sealed -- macOS will report this app as damaged.`);
  }
}

// electron-builder afterSign hook.
function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  verifyAppSignature(appPath);
  console.log(`  • code signature verified  app=${appPath}`);
}

module.exports = { afterSign, verifyAppSignature };
