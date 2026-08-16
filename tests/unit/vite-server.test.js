// @vitest-environment node
//
// The dev-server launcher's cleanup, which is the part that failed: orphaned
// Vite servers accumulated across runs until the machine ran out of RAM. These
// cover the two things that make accumulation impossible -- a fixed port that
// can't drift, and a reaper that kills whatever the last run left behind.

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { reapOrphan, isOurViteProcess, waitForPortFree, pidFilePath, parseVitePort, PORTS } =
  require('../../scripts/vite-server.js');

// A role of its own, not 'dev' or 'test': these tests write and delete pidfiles,
// and doing that under a real role would let a `npm test` running at the same
// time lose track of its own dev server.
const ROLE = 'unit-spec';
const strays = [];

/**
 * A long-lived process whose command line contains `name`, standing in for a
 * leaked dev server. Detached, like the real one, so it has its own group.
 */
function fakeProcess(name) {
  const script = path.join(os.tmpdir(), `ludi-${name}-${process.pid}.js`);
  fs.writeFileSync(script, 'setInterval(() => {}, 1e9);');
  const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
  strays.push({ child, script });
  return child;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

afterEach(() => {
  for (const { child, script } of strays.splice(0)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already reaped */ }
    fs.rmSync(script, { force: true });
  }
  fs.rmSync(pidFilePath(ROLE), { force: true });
});

describe('dev server ports', () => {
  it('does not use 5173, which every Vite project competes for', () => {
    // Sharing the default port is what made Vite drift to the next one instead
    // of colliding, and silent drift is how orphans piled up unnoticed.
    expect(Object.values(PORTS)).not.toContain(5173);
  });

  it('gives dev and tests separate ports so neither reaps the other', () => {
    expect(PORTS.dev).not.toBe(PORTS.test);
  });
});

describe('reapOrphan', () => {
  it('kills the dev server a previous run left behind', async () => {
    const orphan = fakeProcess('vite');
    fs.writeFileSync(pidFilePath(ROLE), JSON.stringify({ pid: orphan.pid, port: PORTS.test }));
    // A killed child is a zombie until its parent reaps it, so `kill(pid, 0)`
    // would still say it's alive. The exit event is the real answer.
    const exited = new Promise((resolve) => orphan.once('exit', () => resolve(true)));

    expect(reapOrphan(ROLE)).toBe(orphan.pid);
    await expect(exited).resolves.toBe(true);
    expect(fs.existsSync(pidFilePath(ROLE))).toBe(false);
  });

  it('leaves an unrelated process alone when the pid has been recycled', () => {
    // pids get reused. Killing whatever now holds the recorded pid would be a
    // far worse bug than the one this is fixing.
    const innocent = fakeProcess('something-else');
    fs.writeFileSync(pidFilePath(ROLE), JSON.stringify({ pid: innocent.pid, port: PORTS.test }));

    expect(reapOrphan(ROLE)).toBe(null);
    expect(alive(innocent.pid)).toBe(true);
  });

  it('is a no-op when no previous run left anything', () => {
    fs.rmSync(pidFilePath(ROLE), { force: true });
    expect(reapOrphan(ROLE)).toBe(null);
  });

  it('discards a corrupt pidfile instead of throwing', () => {
    fs.writeFileSync(pidFilePath(ROLE), 'not json');
    expect(reapOrphan(ROLE)).toBe(null);
    expect(fs.existsSync(pidFilePath(ROLE))).toBe(false);
  });
});

describe('waitForPortFree', () => {
  /** A listening server on an OS-assigned port, so nothing real is disturbed. */
  const occupy = () => new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });

  it('waits for a killed server to release the socket instead of racing it', async () => {
    // Reaping the orphan and starting the replacement are back to back, but the
    // socket outlives the SIGKILL by a moment -- and Vite runs with --strictPort,
    // so losing that race is a crash, not a retry.
    const { server, port } = await occupy();
    setTimeout(() => server.close(), 100);

    await expect(waitForPortFree(port, 3000)).resolves.toBeUndefined();
  });

  it('gives up loudly rather than hanging when the port never frees', async () => {
    const { server, port } = await occupy();

    await expect(waitForPortFree(port, 150)).rejects.toThrow(/still in use/);
    server.close();
  });
});

describe('isOurViteProcess', () => {
  it('recognizes a live vite process', () => {
    expect(isOurViteProcess(fakeProcess('vite').pid)).toBe(true);
  });

  it('rejects a pid that is not running', () => {
    expect(isOurViteProcess(2147483646)).toBe(false);
  });
});

describe('parseVitePort', () => {
  it('reads the port out of Vite ready output', () => {
    expect(parseVitePort('  ➜  Local:   http://localhost:5273/')).toBe('5273');
  });

  it('strips ANSI color codes before matching', () => {
    const colored = '\x1b[32m  ➜  Local:\x1b[39m   \x1b[36mhttp://localhost:5274/\x1b[39m';
    expect(parseVitePort(colored)).toBe('5274');
  });

  it('handles an https dev server', () => {
    expect(parseVitePort('Local:   https://localhost:5280/')).toBe('5280');
  });

  it('returns null for lines without a Local URL', () => {
    expect(parseVitePort('VITE v7.3.5  ready in 299 ms')).toBe(null);
    expect(parseVitePort('  ➜  Network: use --host to expose')).toBe(null);
  });
});
