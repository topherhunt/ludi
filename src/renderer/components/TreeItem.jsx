import { Show, createSignal, createMemo, createResource, For } from 'solid-js';
import {
  selectedItems,
  lastSelectedItemId,
  toggleSelection,
  rangeSelect,
  selectOnly,
  setLastSelectedItemId,
} from '../stores/navigation.js';
import {
  currentPlayingSongId,
  isPlaying,
} from '../stores/playback.js';
import {
  columnVisibility,
  gridTemplateColumns,
} from '../stores/columns.js';
import { formatTime, pluralize } from '../utils/format.js';
import { folderContainsSong, getItemById, countSongsInList } from '../utils/api.js';

/**
 * Single tree item (folder or song)
 */
export function TreeItem(props) {
  // Local state for folder expansion
  const [isExpanded, setIsExpanded] = createSignal(props.item.list_is_expanded || false);
  const [children, setChildren] = createSignal([]);
  const [childrenLoaded, setChildrenLoaded] = createSignal(false);

  // Determine if this is a folder
  const isFolder = () => props.item.list_id !== null;

  // Check if this song is currently playing
  const isCurrentSong = createMemo(() => {
    if (isFolder()) return false;
    return props.item.song_id === currentPlayingSongId();
  });

  // Check if this folder contains the currently playing song
  const [folderHasPlayingSong] = createResource(
    () => isFolder() ? [props.item.list_id, currentPlayingSongId()] : null,
    async ([listId, songId]) => {
      if (!songId) return false;
      return await folderContainsSong(listId, songId);
    }
  );

  // Recursive song count for folders -- drives the count label and the
  // "empty folder" dimming (a folder with no songs anywhere inside it).
  const [songCount] = createResource(
    () => isFolder() ? props.item.list_id : null,
    async (listId) => countSongsInList(listId)
  );
  const isEmptyFolder = () => isFolder() && songCount() === 0;

  // Selection state
  const isSelected = createMemo(() => selectedItems().has(props.item.id));

  // Column visibility
  const visibility = columnVisibility;

  // Icon based on state
  const iconClass = createMemo(() => {
    if (isFolder()) {
      return 'bi bi-caret-right-fill';
    }
    if (isCurrentSong()) {
      return isPlaying() ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    }
    return 'bi bi-music-note';
  });

  // Icon container class (for playing/paused animation)
  const iconContainerClass = createMemo(() => {
    let cls = isFolder() ? 'tree-item-icon chevron' : 'tree-item-icon';
    if (isFolder() && isExpanded()) {
      cls += ' expanded';
    }
    if (isCurrentSong() || folderHasPlayingSong()) {
      cls += isPlaying() ? ' playing' : ' paused';
    }
    return cls;
  });

  // Handle click on chevron to expand/collapse
  const handleChevronClick = async (e) => {
    e.stopPropagation();
    const newExpanded = !isExpanded();
    setIsExpanded(newExpanded);

    // Load children if expanding and not loaded
    if (newExpanded && !childrenLoaded()) {
      const items = await window.electronAPI?.getListItems(props.item.list_id) || [];
      setChildren(items);
      setChildrenLoaded(true);
    }

    // Save expanded state to database
    await window.electronAPI?.updateFolderExpanded({
      listId: props.item.list_id,
      isExpanded: newExpanded,
    });
  };

  // Handle click on item for selection
  const handleClick = (e) => {
    // Don't interfere with folder chevron clicks
    if (e.target.closest('.tree-item-icon.chevron')) {
      return;
    }

    const isCmdKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isShiftKey && lastSelectedItemId() !== null) {
      // SHIFT+click: Select range
      const visibleIds = props.getVisibleItemIds?.() || [];
      rangeSelect(props.item.id, visibleIds);
    } else if (isCmdKey) {
      // CMD+click: Toggle selection
      toggleSelection(props.item.id);
    } else {
      // Plain click: Select only this item
      selectOnly(props.item.id);
    }
    setLastSelectedItemId(props.item.id);
  };

  // Handle double-click to play
  const handleDoubleClick = async () => {
    if (isFolder()) {
      props.onPlayFolder?.(props.item.list_id);
    } else {
      props.onPlaySong?.(props.item.song_id, props.item.parent_list_id);
    }
  };

  // Handle context menu
  const handleContextMenu = (e) => {
    e.preventDefault();
    props.onContextMenu?.(e.clientX, e.clientY, props.item);
  };

  // Drag start
  const handleDragStart = (e) => {
    props.onDragStart?.(e, props.item.id);
  };

  // Drag over
  const handleDragOver = (e) => {
    props.onDragOver?.(e, props.item.id);
  };

  // Drop
  const handleDrop = (e) => {
    props.onDrop?.(e, props.item.id);
  };

  // Drag end
  const handleDragEnd = (e) => {
    props.onDragEnd?.(e);
  };

  // Load children on mount if expanded
  if (isFolder() && props.item.list_is_expanded) {
    window.electronAPI?.getListItems(props.item.list_id).then((items) => {
      setChildren(items || []);
      setChildrenLoaded(true);
    });
  }

  const depth = props.depth || 0;

  return (
    <li class="tree-item" data-item-id={props.item.id}>
      <div
        class="tree-item-content"
        classList={{ selected: isSelected(), 'folder-empty': isEmptyFolder() }}
        data-item-id={props.item.id}
        data-is-folder={isFolder()}
        data-folder-id={isFolder() ? props.item.list_id : undefined}
        data-song-id={!isFolder() ? props.item.song_id : undefined}
        style={{ 'grid-template-columns': isFolder() ? '1fr' : gridTemplateColumns() }}
        draggable={true}
        onClick={handleClick}
        onDblClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {/* Title column */}
        <span
          class="col-title"
          style={{ 'padding-left': depth > 0 ? `${depth * 20}px` : undefined }}
        >
          <span
            class={iconContainerClass()}
            onClick={isFolder() ? handleChevronClick : undefined}
            onDblClick={isFolder() ? (e) => e.stopPropagation() : undefined}
          >
            <i class={iconClass()}></i>
          </span>
          <span class="tree-item-label">
            {isFolder() ? props.item.list_title : props.item.song_title}
            <Show when={isFolder()}>
              <FolderItemCount count={songCount()} />
            </Show>
          </span>
        </span>

        {/* Song-only columns. Folders skip these so the name spans the full row. */}
        <Show when={!isFolder()}>
          {/* Track number column */}
          <Show when={visibility().track}>
            <span class="col-track" data-column="track">
              {props.item.track_number ? props.item.track_number : ''}
            </span>
          </Show>

          {/* Duration column */}
          <Show when={visibility().duration}>
            <span class="col-duration" data-column="duration">
              {props.item.duration_seconds
                ? formatTime(props.item.duration_seconds)
                : ''}
            </span>
          </Show>

          {/* Artist column */}
          <Show when={visibility().artist}>
            <span class="col-artist" data-column="artist">
              {props.item.artist && props.item.artist !== 'Unknown'
                ? props.item.artist
                : ''}
            </span>
          </Show>

          {/* Album column */}
          <Show when={visibility().album}>
            <span class="col-album" data-column="album">
              {props.item.album && props.item.album !== 'Unknown'
                ? props.item.album
                : ''}
            </span>
          </Show>

          {/* Tags column */}
          <Show when={visibility().tags}>
            <span class="col-tags" data-column="tags"></span>
          </Show>
        </Show>
      </div>

      {/* Children container for folders */}
      <Show when={isFolder()}>
        <ul
          class="tree-item-children"
          classList={{ expanded: isExpanded() }}
          data-list-id={props.item.list_id}
          data-depth={depth + 1}
        >
          <For each={children()}>
            {(child) => (
              <TreeItem
                item={child}
                depth={depth + 1}
                getVisibleItemIds={props.getVisibleItemIds}
                onPlayFolder={props.onPlayFolder}
                onPlaySong={props.onPlaySong}
                onContextMenu={props.onContextMenu}
                onDragStart={props.onDragStart}
                onDragOver={props.onDragOver}
                onDrop={props.onDrop}
                onDragEnd={props.onDragEnd}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/**
 * Folder song count display. The recursive count is computed once in the parent
 * TreeItem (it also drives empty-folder dimming) and passed in here.
 */
function FolderItemCount(props) {
  return (
    <span class="tree-item-count">
      <Show when={props.count !== undefined}>
        {props.count} {pluralize(props.count, 'song')}
      </Show>
    </span>
  );
}
