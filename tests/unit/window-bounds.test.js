import { describe, it, expect } from 'vitest';
import windowBounds from '../../src/main/window-bounds.js';

const { restoredBounds, DEFAULT_SIZE } = windowBounds;

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };
const EXTERNAL = { x: 1512, y: 0, width: 2560, height: 1415 };

describe('restoredBounds', () => {
  it('opens at the default size the first time', () => {
    expect(restoredBounds(null, [LAPTOP])).toEqual(DEFAULT_SIZE);
  });

  it('reopens where the window was when that is still on a screen', () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(restoredBounds(saved, [LAPTOP, EXTERNAL])).toEqual(saved);
  });

  it('keeps the size but drops the position once its screen is gone', () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(restoredBounds(saved, [LAPTOP])).toEqual({ width: 1400, height: 900 });
  });

  it('drops the position when only a sliver would show', () => {
    const saved = { x: 1450, y: 100, width: 1000, height: 700 };
    expect(restoredBounds(saved, [LAPTOP])).toEqual({ width: 1000, height: 700 });
  });
});
