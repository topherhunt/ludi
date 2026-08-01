import { startFileDragForItems } from './api.js';

/**
 * Hold Option at drag start to drag the selection out to the Desktop or a Finder
 * folder; the OS copies each selected song's audio file into the drop target.
 *
 * It has to be a modifier rather than the plain drag. Electron's `startDrag` must
 * be called from `dragstart` with `preventDefault()`, which cancels the HTML5
 * drag outright -- so one gesture can be an in-app drag (reorder, copy into a
 * playlist) or a native file export, never both.
 *
 * @param {DragEvent} e
 * @param {number[]} itemIds - tree item ids; folders export everything inside them
 * @returns {boolean} true if this drag was claimed as a file export
 */
export function startNativeFileDrag(e, itemIds) {
  if (!e.altKey) return false;
  e.preventDefault();
  startFileDragForItems(itemIds);
  return true;
}
