import { describe, it, expect } from 'vitest';
import devLauncher from '../../scripts/dev.js';

const { parseVitePort } = devLauncher;

describe('parseVitePort', () => {
  it('parses the default Vite port', () => {
    expect(parseVitePort('  ➜  Local:   http://localhost:5173/')).toBe('5173');
  });

  it('parses a drifted port when 5173 was already taken', () => {
    // This is the bug case: another app holds 5173, so Vite picks 5174.
    expect(parseVitePort('  ➜  Local:   http://localhost:5174/')).toBe('5174');
  });

  it('strips ANSI color codes before matching', () => {
    const colored = '\x1b[32m  ➜  Local:\x1b[39m   \x1b[36mhttp://localhost:5199/\x1b[39m';
    expect(parseVitePort(colored)).toBe('5199');
  });

  it('handles an https dev server', () => {
    expect(parseVitePort('Local:   https://localhost:5180/')).toBe('5180');
  });

  it('returns null for lines without a Local URL', () => {
    expect(parseVitePort('VITE v7.3.5  ready in 299 ms')).toBe(null);
    expect(parseVitePort('  ➜  Network: use --host to expose')).toBe(null);
  });
});
