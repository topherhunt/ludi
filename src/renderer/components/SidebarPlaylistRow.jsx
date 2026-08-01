import { currentListId, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import {
  dragSource,
  draggedItemIds,
  startInternalDrag,
  endDrag,
  showDropIndicator,
  hideDropIndicator,
} from '../stores/dragdrop.js';

/**
 * One row in the sidebar's list of playlists (including the Main Library).
 *
 * What a drop does is decided by WHAT is being dragged, not by where on the row
 * the cursor is -- that is what keeps "reorder playlists" and "add songs to a
 * playlist" from competing:
 *
 *   sidebar-playlist drag -> top/bottom half = insert above/below (indicator line)
 *   tree drag (songs/folders) -> whole row = copy into this playlist (.drop-into)
 *   OS files -> whole row = import + add (.drop-into)
 *   tag chip drag -> ignored entirely
 *
 * `depth` is the sidebar nesting level. It is always 0 today; it exists so that
 * folders-of-playlists can be added later without reworking this component.
 *
 * Props:
 *   list, depth, isTagDragging,
 *   onSelect(list), onPlay(list), onContextMenu(e, list),
 *   onReorder(draggedListId, targetListId, insertBefore),
 *   onCopyItems(list, itemIds), onDropFiles(list, paths),
 *   getListContainer() -> the scrolling element the drop indicator is positioned in
 */
export function SidebarPlaylistRow(props) {
  let rowRef;

  const isMainLibrary = () => props.list.id === MAIN_LIBRARY_ID;

  // What this row would do with the drag currently in progress.
  const dropMode = (e) => {
    if (props.isTagDragging()) return null;
    if (e.dataTransfer.types.includes('Files')) return 'copy';
    if (dragSource() === 'sidebar-playlist') {
      // The Main Library is pinned first and never reorders.
      if (isMainLibrary()) return null;
      if (draggedItemIds().includes(props.list.id)) return null;
      return 'reorder';
    }
    if (dragSource() === 'tree') {
      // A second Main Library placement would break "every song is in the
      // Main Library exactly once".
      if (isMainLibrary()) return null;
      return 'copy';
    }
    return null;
  };

  const clearVisuals = () => {
    rowRef?.classList.remove('drop-into');
    hideDropIndicator();
  };

  const handleDragStart = (e) => {
    if (isMainLibrary()) return;
    e.dataTransfer.effectAllowed = 'move';
    startInternalDrag([props.list.id], 'sidebar-playlist');
  };

  const handleDragEnd = () => {
    clearVisuals();
    endDrag();
  };

  const handleDragOver = (e) => {
    const mode = dropMode(e);
    if (!mode) return; // no preventDefault -> not a drop target

    e.preventDefault();
    e.stopPropagation();

    if (mode === 'copy') {
      hideDropIndicator();
      rowRef.classList.add('drop-into');
      e.dataTransfer.dropEffect = 'copy';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    rowRef.classList.remove('drop-into');

    const container = props.getListContainer();
    if (!container) return;
    const rect = rowRef.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;
    const top = (insertBefore ? rect.top : rect.bottom) - containerRect.top + container.scrollTop;
    showDropIndicator(top, rect.left - containerRect.left, rect.width, 'sidebar');
  };

  const handleDragLeave = (e) => {
    if (rowRef?.contains(e.relatedTarget)) return;
    clearVisuals();
  };

  const handleDrop = (e) => {
    const mode = dropMode(e);
    if (!mode) return;

    e.preventDefault();
    e.stopPropagation();

    // Capture everything synchronously: the source element's dragend fires
    // right after this and wipes the drag store.
    const isFiles = e.dataTransfer.types.includes('Files');
    const itemIds = [...draggedItemIds()];
    const paths = isFiles
      ? Array.from(e.dataTransfer.files).map((f) => window.electronAPI.getPathForFile(f))
      : [];
    const rect = rowRef.getBoundingClientRect();
    const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;

    clearVisuals();

    if (mode === 'reorder') {
      props.onReorder(itemIds[0], props.list.id, insertBefore);
    } else if (isFiles) {
      if (paths.length > 0) props.onDropFiles(props.list, paths);
    } else {
      props.onCopyItems(props.list, itemIds);
    }
  };

  return (
    <div
      ref={rowRef}
      class="playlist-item qa-playlist-item"
      classList={{ active: currentListId() === props.list.id }}
      data-list-id={props.list.id}
      style={{ 'padding-left': `${12 + props.depth * 16}px` }}
      draggable={!isMainLibrary()}
      onClick={() => props.onSelect(props.list)}
      onDblClick={() => props.onPlay(props.list)}
      onContextMenu={(e) => props.onContextMenu(e, props.list)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {props.list.title}
    </div>
  );
}
