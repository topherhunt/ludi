// Starting and -- more importantly -- reliably stopping the Vite dev server.
//
// Both `npm run dev` and the Playwright suite need a dev server, and both used
// to spawn one with `spawn('npm', ['run', 'vite'], { detached: true })`. Detached
// is right for shutdown (it puts npm -> vite -> esbuild in one process group we
// can kill as a unit) and wrong for everything else: a detached child outlives
// its parent, so any run that didn't exit cleanly -- Ctrl-C at the wrong moment,
// a killed test run, a crash -- left a fully functional Vite server behind. And
// because `server.port` had no strictPort, the next run didn't collide with the
// orphan; Vite quietly took the next port up. Nothing ever failed, so the
// orphans accumulated, a few hundred MB each, until the machine ran out of RAM.
//
// Three changes make that impossible rather than unlikely:
//
//   1. Ludi's dev server has its own fixed port per role, with strictPort set,
//      so a leftover server is a loud EADDRINUSE instead of a silent drift onto
//      port+1. Accumulation needs drift.
//   2. Every server writes a pidfile. The next run reads it and kills whatever
//      the last run left behind, so at most one orphan can exist at a time.
//   3. Shutdown is wired to exit, SIGINT, SIGTERM and SIGHUP, not just to the
//      happy path.
//
// A stale server is reaped rather than reused deliberately: reusing one means
// inheriting whatever state and file watchers it accumulated, and the reason
// this file exists is that trusting long-lived dev servers went badly.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Ports nothing else is likely to want. The old default of 5173 is the one every
// Vite project on the machine competes for, which is what made drift routine.
const PORTS = { dev: 5273, test: 5274 };

const pidFilePath = (role) => path.join(os.tmpdir(), `ludi-vite-${role}.pid`);

/** Is this pid alive, and does it actually look like a Vite server of ours? */
function isOurViteProcess(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;  // gone, or not ours to signal
  }
  try {
    // pids get recycled, so confirm what we're about to kill before killing it.
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return command.includes('vite');
  } catch {
    return false;
  }
}

/**
 * Kill the server a previous run left behind, if there is one. Returns the pid
 * it reaped, or null. Safe to call when there's no pidfile, a stale pidfile, or
 * a pidfile naming a pid that now belongs to something else.
 */
function reapOrphan(role) {
  const file = pidFilePath(role);
  if (!fs.existsSync(file)) return null;

  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fs.rmSync(file, { force: true });
    return null;
  }

  fs.rmSync(file, { force: true });
  if (!record || !isOurViteProcess(record.pid)) return null;

  // Negative pid: the whole process group, so esbuild and the shell go too.
  try {
    process.kill(-record.pid, 'SIGKILL');
  } catch {
    try { process.kill(record.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  return record.pid;
}

/**
 * Resolve once nothing is listening on `port`. A SIGKILLed server releases its
 * socket a moment after the signal, and Vite runs with --strictPort, so starting
 * the replacement too eagerly turns the reap into an EADDRINUSE crash.
 */
function waitForPortFree(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const probe = net.createServer();
      probe.once('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`port ${port} was still in use ${timeoutMs}ms after reaping the old server`));
          return;
        }
        setTimeout(attempt, 50);
      });
      probe.once('listening', () => probe.close(() => resolve()));
      probe.listen(port, '127.0.0.1');
    };
    attempt();
  });
}

// Vite prints a line like "  ➜  Local:   http://localhost:5273/" (ANSI-colored).
// Pull the real port out of it. Returns the port as a string, or null if absent.
const VITE_PORT_REGEX = /Local:\s+https?:\/\/localhost:(\d+)/;

function parseVitePort(text) {
  // Strip ANSI color escapes before matching.
  const clean = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  const match = clean.match(VITE_PORT_REGEX);
  return match ? match[1] : null;
}

/**
 * Start a dev server for `role` ('dev' or 'test') and resolve once it is
 * listening. Resolves to `{ port, pid, stop }`; `stop` is idempotent and is
 * also wired to this process exiting, however it exits.
 */
async function startViteServer({ role, onOutput = () => {}, timeoutMs = 30000 } = {}) {
  const port = Number(process.env.LUDI_VITE_PORT) || PORTS[role];
  if (!port) throw new Error(`unknown vite server role "${role}"`);

  const reaped = reapOrphan(role);
  if (reaped) {
    console.log(`[vite] reaped orphaned dev server from a previous run (pid ${reaped})`);
    await waitForPortFree(port);
  }

  // Run Vite's binary directly rather than through `npm run`: one fewer shell in
  // the tree, and the process we record the pid of is the one doing the work.
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true }
  );

  fs.writeFileSync(pidFilePath(role), JSON.stringify({ pid: child.pid, port, role, root: ROOT }));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    fs.rmSync(pidFilePath(role), { force: true });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  };

  // The orphan problem is precisely that this didn't happen on every exit path.
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => { stop(); process.exit(signal === 'SIGINT' ? 130 : 143); });
  }

  return new Promise((resolve, reject) => {
    const fail = (error) => { stop(); reject(error); };
    const timer = setTimeout(
      () => fail(new Error(`Vite did not start on port ${port} within ${timeoutMs}ms`)),
      timeoutMs
    );

    child.stdout.on('data', (data) => {
      onOutput(data.toString());
      const reported = parseVitePort(data);
      if (!reported) return;
      clearTimeout(timer);
      if (reported !== String(port)) {
        // strictPort should make this impossible; if it ever happens, a run
        // pointed at the wrong server is worse than a run that stops here.
        fail(new Error(`Vite bound to port ${reported}, expected ${port}`));
        return;
      }
      resolve({ port, pid: child.pid, stop });
    });

    child.stderr.on('data', (data) => onOutput(data.toString()));
    child.on('error', (error) => { clearTimeout(timer); fail(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(
        `Vite exited with code ${code} before it was ready. If port ${port} is in ` +
        `use by a server this launcher didn't start, stop that one first.`
      ));
    });
  });
}

module.exports = {
  startViteServer, parseVitePort, reapOrphan, isOurViteProcess, waitForPortFree, pidFilePath, PORTS,
};
