import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startNativeFileDrag } from '../../src/renderer/utils/dragOut.js';

// A drag either stays inside the app or becomes a native file export -- never
// both, because Electron's startDrag needs the HTML5 drag cancelled. Option is
// what picks between them, so that branch is the whole contract here.
describe('startNativeFileDrag', () => {
  let startFileDragForItems;

  const fakeDragEvent = (altKey) => ({ altKey, preventDefault: vi.fn() });

  beforeEach(() => {
    startFileDragForItems = vi.fn();
    window.electronAPI = { startFileDragForItems };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it('leaves a plain drag alone so it stays an in-app drag', () => {
    const e = fakeDragEvent(false);
    expect(startNativeFileDrag(e, [1, 2])).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(startFileDragForItems).not.toHaveBeenCalled();
  });

  it('claims an Option-drag, cancels the HTML5 drag, and exports the selection', () => {
    const e = fakeDragEvent(true);
    expect(startNativeFileDrag(e, [1, 2])).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(startFileDragForItems).toHaveBeenCalledWith([1, 2]);
  });
});
