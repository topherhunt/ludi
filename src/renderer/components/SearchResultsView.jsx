import { For, Show, createSignal, createMemo } from 'solid-js';
import { searchResults, searchError, searchViewMode, searchTree } from '../stores/search.js';
import { currentPlayingItemId, isPlaying } from '../stores/playback.js';
import { columnVisibility, gridTemplateColumns } from '../stores/columns.js';
import { formatTime } from '../utils/format.js';
import {
  selectedItems,
  lastSelectedItemId,
  selectOnly,
  toggleSelection,
  rangeSelect,
  setLastSelectedItemId,
  clearSelection,
} from '../stores/navigation.js';
import { startInternalDrag, endDrag } from '../stores/dragdrop.js';
import { startNativeFileDrag } from '../utils/dragOut.js';
import { TagPillList } from './TagPill.jsx';
import { StarRating } from './StarRating.jsx';

// Row order for SHIFT-range selection. Collapsed folders drop their children
// from the DOM entirely here, so document order is exactly what the user sees.
// Virtual folder rows have no placement id and are skipped.
const visibleSearchItemIds = () =>
  Array.from(document.querySelectorAll('#explorerTree .tree-item-content[data-item-id]'))
    .map((el) => parseInt(el.dataset.itemId));

/**
 * One song row in a query-shaped list (search hits, similarity results).
 *
 * Exported because every such list wants the same selection, drag and
 * now-playing behaviour; only the reason the song is in the list differs. Pass
 * `similarity` (0..1) to show a match-strength badge ahead of the title, and
 * `onContextMenu(x, y, item)` to offer the song context menu.
 */
export function SearchSongRow(props) {
  const isCurrent = createMemo(() => props.song.item_id === currentPlayingItemId());
  const isSelected = createMemo(() => selectedItems().has(props.song.item_id));

  // Same selection gestures as the tree: plain click replaces, CMD toggles,
  // SHIFT extends from the last click.
  const handleClick = (e) => {
    if (e.shiftKey && lastSelectedItemId() !== null) {
      rangeSelect(props.song.item_id, visibleSearchItemIds());
    } else if (e.metaKey || e.ctrlKey) {
      toggleSelection(props.song.item_id);
    } else {
      selectOnly(props.song.item_id);
    }
    setLastSelectedItemId(props.song.item_id);
  };

  // Search results can be dragged OUT (onto a sidebar playlist) but never
  // rearranged: their order belongs to the query, not to any list. Publishing
  // the payload is all this needs -- the view itself is not a drop target.
  const handleDragStart = (e) => {
    const ids = selectedItems().has(props.song.item_id)
      ? Array.from(selectedItems())
      : [props.song.item_id];
    if (startNativeFileDrag(e, ids)) return;
    e.dataTransfer.effectAllowed = 'copy';
    startInternalDrag(ids, 'tree');
  };

  // Hands the menu the same item shape a tree row would, so its actions don't
  // need to know which view they were opened from.
  const handleContextMenu = (e) => {
    if (!props.onContextMenu) return;
    e.preventDefault();
    props.onContextMenu(e.clientX, e.clientY, {
      id: props.song.item_id,
      list_id: null,
      song_id: props.song.song_id,
      parent_list_id: props.song.parent_list_id,
      position: props.song.position,
    });
  };

  const iconClass = createMemo(() => {
    if (isCurrent()) return isPlaying() ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    return 'bi bi-music-note';
  });

  const iconContainerClass = createMemo(() => {
    let cls = 'tree-item-icon';
    if (isCurrent()) cls += isPlaying() ? ' playing' : ' paused';
    return cls;
  });

  return (
    <li class="tree-item">
      <div
        class="tree-item-content qa-search-song"
        classList={{ 'current-song': isCurrent(), selected: isSelected() }}
        style={{ 'grid-template-columns': gridTemplateColumns() }}
        data-item-id={props.song.item_id}
        data-is-folder="false"
        data-song-id={props.song.song_id}
        draggable={true}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={() => endDrag()}
      >
        <span
          class="col-title"
          style={{ 'padding-left': props.depth > 0 ? `${props.depth * 20}px` : undefined }}
        >
          <span class={iconContainerClass()}>
            <i class={iconClass()} />
          </span>
          <Show when={props.similarity !== undefined}>
            <span class="similarity-badge qa-similarity">{Math.round(props.similarity * 100)}%</span>
          </Show>
          <span class="tree-item-label">{props.song.title}</span>
        </span>

        <Show when={columnVisibility().track}>
          <span class="col-track">{props.song.track_number || ''}</span>
        </Show>
        <Show when={columnVisibility().duration}>
          <span class="col-duration">
            {props.song.duration_seconds ? formatTime(props.song.duration_seconds) : ''}
          </span>
        </Show>
        <Show when={columnVisibility().rating}>
          <span class="col-rating">
            <StarRating rating={props.song.rating} itemId={props.song.item_id} />
          </span>
        </Show>
        <Show when={columnVisibility().artist}>
          <span class="col-artist">
            {props.song.artist && props.song.artist !== 'Unknown' ? props.song.artist : ''}
          </span>
        </Show>
        <Show when={columnVisibility().album}>
          <span class="col-album">
            {props.song.album && props.song.album !== 'Unknown' ? props.song.album : ''}
          </span>
        </Show>
        <Show when={columnVisibility().tags}>
          <span class="col-tags">
            <TagPillList tags={props.song.tags} />
          </span>
        </Show>
      </div>
    </li>
  );
}

function SearchFolderRow(props) {
  const [expanded, setExpanded] = createSignal(true);

  return (
    <li class="tree-item">
      <div
        class="tree-item-content qa-search-folder"
        data-is-folder="true"
        data-folder-id={props.node.list_id}
        style={{ 'grid-template-columns': '1fr' }}
        onClick={(e) => {
          if (!e.target.closest('.tree-item-icon.chevron')) {
            setExpanded(v => !v);
          }
        }}
      >
        <span
          class="col-title"
          style={{ 'padding-left': props.depth > 0 ? `${props.depth * 20}px` : undefined }}
        >
          <span
            class={'tree-item-icon chevron' + (expanded() ? ' expanded' : '')}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            <i class="bi bi-caret-right-fill" />
          </span>
          <span class="tree-item-label">{props.node.title}</span>
        </span>
      </div>
      <Show when={expanded()}>
        <ul
          class="tree-item-children expanded"
          data-list-id={props.node.list_id}
          data-depth={props.depth + 1}
        >
          <For each={props.node.children}>
            {(child) => (
              <SearchTreeNode node={child} depth={props.depth + 1} onContextMenu={props.onContextMenu} />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

function SearchTreeNode(props) {
  if (props.node.type === 'folder') {
    return <SearchFolderRow node={props.node} depth={props.depth} onContextMenu={props.onContextMenu} />;
  }
  return <SearchSongRow song={props.node.data} depth={props.depth} onContextMenu={props.onContextMenu} />;
}

export function SearchResultsView(props) {
  const handleContainerDblClick = (e) => {
    // Double-clicking a chevron is two expand/collapse clicks, not a play.
    if (e.target.closest('.tree-item-icon.chevron')) return;

    const folderEl = e.target.closest('.qa-search-folder');
    if (folderEl) {
      props.onPlaySearchFolder(parseInt(folderEl.dataset.folderId));
      return;
    }

    const songEl = e.target.closest('[data-song-id]');
    if (songEl) {
      // Rows are identified by placement, not song: a playlist can hold the
      // same song more than once.
      const itemId = parseInt(songEl.dataset.itemId);
      const song = (searchResults() || []).find(s => s.item_id === itemId);
      if (song) props.onPlaySong?.(song.item_id, song.parent_list_id);
    }
  };

  const handleContainerClick = (e) => {
    if (!e.target.closest('.tree-item-content')) clearSelection();
  };

  return (
    <div
      class="explorer-container"
      id="explorerContainer"
      onClick={handleContainerClick}
      onDblClick={handleContainerDblClick}
    >
      <Show
        when={(searchResults() || []).length > 0}
        fallback={
          <Show
            when={searchError() === 'invalid_syntax'}
            fallback={
              <div class="search-empty-state">
                <i class="bi bi-search" />
                <p>No results found</p>
              </div>
            }
          >
            <div class="search-empty-state">
              <i class="bi bi-exclamation-triangle" />
              <p>Invalid search syntax</p>
              <span class="search-empty-hint">"and" and "or" are reserved operators -- use quotes to search for them literally</span>
            </div>
          </Show>
        }
      >
        <Show when={searchViewMode() === 'flat'}>
          <ul class="explorer-tree" id="explorerTree">
            <For each={searchResults() || []}>
              {(song) => <SearchSongRow song={song} depth={0} onContextMenu={props.onContextMenu} />}
            </For>
          </ul>
        </Show>

        <Show when={searchViewMode() === 'nested'}>
          <ul class="explorer-tree" id="explorerTree">
            <For each={searchTree()}>
              {(node) => (
                <SearchTreeNode node={node} depth={0} onContextMenu={props.onContextMenu} />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
