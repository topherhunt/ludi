import { startFileDragForItems } from './api.js';

/**
 * Hold Option at drag start to drag the selection out to the Desktop or a Finder
 * folder; the OS copies each selected song's audio file into the drop target.
 *
 * It has to be a modifier rather than the plain drag, and that is a platform
 * limit rather than a preference. Electron's `startDrag` must be called from
 * `dragstart` after `preventDefault()`, which cancels the HTML5 drag outright --
 * so one gesture can be an in-app drag (reorder, copy into a playlist) or a
 * native file export, never both. Making every song drag a native one was tried:
 * the OS takes the gesture over and our own drop targets stop hearing about it,
 * which took out dropping songs on playlists, reordering, and dropping into
 * folders (tests/e2e/playlists.spec.js catches this).
 *
 * For a drag-free way to get the same files into a folder, see "Copy Files
 * To..." in the song context menu.
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
