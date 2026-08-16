// Dev launcher: one Vite dev server, one Electron pointed at it, and nothing
// left running when it ends.
//
// The tricky part is shutdown, not startup, and it lives in vite-server.js --
// see the comment there for why orphaned dev servers were able to pile up
// overnight. This file's own job is the mirror image for Electron: the two
// processes are tied together in both directions, so quitting the app stops the
// server and killing the launcher stops the app.

const { spawn } = require('child_process');
const path = require('path');
const { startViteServer, parseVitePort } = require('./vite-server');

async function main() {
  const electronPath = require('electron');
  const root = path.join(__dirname, '..');

  const { port, stop: stopVite } = await startViteServer({
    role: 'dev',
    onOutput: (text) => process.stdout.write(text),
  });

  console.log(`\n[dev] Vite is on port ${port}; launching Electron pointed at it.\n`);

  const electron = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV: 'true', VITE_PORT: String(port) },
  });

  // Quitting the app ends the session, server included.
  electron.on('exit', (code) => {
    stopVite();
    process.exit(code ?? 0);
  });

  // ...and ending the session from the terminal closes the app. startViteServer
  // already stops the server on these; Electron is ours to clean up.
  process.once('exit', () => { try { electron.kill('SIGTERM'); } catch { /* gone */ } });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => { try { electron.kill('SIGTERM'); } catch { /* gone */ } });
  }
}

module.exports = { parseVitePort };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[dev] ${error.message}`);
    process.exit(1);
  });
}
