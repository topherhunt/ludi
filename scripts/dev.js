// Dev launcher.
//
// `vite.config.js` sets the dev server to port 5173 but NOT strictPort, so when
// 5173 is already taken (e.g. another project's dev server) Vite silently drifts
// to 5174+. The old `concurrently` dev script hardcoded 5173 for both `wait-on`
// and Electron, so Electron would happily load whatever stray app was squatting
// on 5173. This launcher starts Vite, reads the port it ACTUALLY bound to from
// its output, and launches Electron pointed at exactly that port (via VITE_PORT,
// which src/main/main.js reads). Mirrors what tests/e2e/fixtures.js already does.

const { spawn } = require('child_process');
const path = require('path');

// Vite prints a line like "  ➜  Local:   http://localhost:5174/" (ANSI-colored).
// Pull the real port out of it. Returns the port as a string, or null if absent.
const VITE_PORT_REGEX = /Local:\s+https?:\/\/localhost:(\d+)/;

function parseVitePort(text) {
  // Strip ANSI color escapes before matching.
  const clean = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  const match = clean.match(VITE_PORT_REGEX);
  return match ? match[1] : null;
}

function main() {
  const electronPath = require('electron');
  const root = path.join(__dirname, '..');

  let electronProc = null;
  let shuttingDown = false;

  // Start Vite in its own process group so we can tear down the whole tree
  // (npm -> vite -> esbuild) on exit rather than orphaning children.
  const viteProc = spawn('npm', ['run', 'vite'], {
    cwd: root,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (viteProc.pid) {
      try {
        process.kill(-viteProc.pid, 'SIGTERM');
      } catch {
        try { viteProc.kill('SIGTERM'); } catch {}
      }
    }
    if (electronProc) {
      try { electronProc.kill('SIGTERM'); } catch {}
    }
    process.exit(code ?? 0);
  };

  let launched = false;

  viteProc.stdout.on('data', (data) => {
    process.stdout.write(data); // surface Vite logs
    if (launched) return;

    const port = parseVitePort(data.toString());
    if (!port) return;

    launched = true;
    console.log(`\n[dev] Vite bound to port ${port}; launching Electron pointed at it.\n`);

    electronProc = spawn(electronPath, ['.'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV: 'true', VITE_PORT: port },
    });
    electronProc.on('exit', (code) => shutdown(code ?? 0));
  });

  viteProc.stderr.on('data', (data) => process.stderr.write(data));

  viteProc.on('exit', (code) => {
    if (!launched) {
      console.error('[dev] Vite exited before reporting a port.');
    }
    shutdown(code ?? 0);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

module.exports = { parseVitePort };

if (require.main === module) {
  main();
}
