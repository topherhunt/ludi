import { For, Show, createSignal, createMemo } from 'solid-js';
import { searchResults, searchError, searchViewMode, searchRootListId } from '../stores/search.js';
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

// Row order for SHIFT-range selection. Collapsed folders drop their children
// from the DOM entirely here, so document order is exactly what the user sees.
// Virtual folder rows have no placement id and are skipped.
const visibleSearchItemIds = () =>
  Array.from(document.querySelectorAll('#explorerTree .tree-item-content[data-item-id]'))
    .map((el) => parseInt(el.dataset.itemId));

/**
 * Given matched songs with ancestor_folders, build a virtual nested tree rooted
 * at `rootListId` (the list the search was run in -- the Main Library or a
 * playlist).
 * Applies collapsing: folders with exactly 1 matched child are inlined at the parent level.
 * Returns array of nodes: { type:'song'|'folder', ... }
 */
function buildNestedTree(matchedSongs, rootListId) {
  if (!matchedSongs || matchedSongs.length === 0) return [];

  // folder metadata: list_id -> { title, position, parentListId }
  // The root itself is never rendered; it only anchors the recursion.
  const folderMeta = new Map();
  folderMeta.set(rootListId, { title: '', position: 0, parentListId: null });

  for (const song of matchedSongs) {
    let prevListId = rootListId;
    for (const ancestor of song.ancestor_folders) {
      if (!folderMeta.has(ancestor.list_id)) {
        folderMeta.set(ancestor.list_id, {
          title: ancestor.title,
          position: ancestor.position,
          parentListId: prevListId,
        });
      }
      prevListId = ancestor.list_id;
    }
  }

  // songs by direct parent list_id
  const songsByParent = new Map();
  for (const song of matchedSongs) {
    const pid = song.parent_list_id;
    if (!songsByParent.has(pid)) songsByParent.set(pid, []);
    songsByParent.get(pid).push(song);
  }

  function renderFolder(listId) {
    const rawChildren = [];

    // Direct songs in this folder
    for (const song of (songsByParent.get(listId) || [])) {
      rawChildren.push({ type: 'song', data: song, position: song.position });
    }

    // Subfolders whose parentListId is this folder
    for (const [folderId, meta] of folderMeta) {
      if (meta.parentListId !== listId) continue;

      const subChildren = renderFolder(folderId);
      if (subChildren.length === 0) continue;

      if (subChildren.length === 1) {
        // Collapse: inline the single child at this folder's position
        rawChildren.push({ ...subChildren[0], position: meta.position });
      } else {
        rawChildren.push({
          type: 'folder',
          list_id: folderId,
          title: meta.title,
          position: meta.position,
          children: subChildren,
        });
      }
    }

    rawChildren.sort((a, b) => a.position - b.position);
    return rawChildren;
  }

  return renderFolder(rootListId);
}

/**
 * One song row in a query-shaped list (search hits, similarity results).
 *
 * Exported because every such list wants the same selection, drag and
 * now-playing behaviour; only the reason the song is in the list differs. Pass
 * `similarity` (0..1) to show a match-strength badge ahead of the title.
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
              <SearchTreeNode node={child} depth={props.depth + 1} onPlaySong={props.onPlaySong} />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

function SearchTreeNode(props) {
  if (props.node.type === 'folder') {
    return <SearchFolderRow node={props.node} depth={props.depth} onPlaySong={props.onPlaySong} />;
  }
  return <SearchSongRow song={props.node.data} depth={props.depth} />;
}

export function SearchResultsView(props) {
  const nestedTree = createMemo(() => {
    if (searchViewMode() !== 'nested') return [];
    return buildNestedTree(searchResults() || [], searchRootListId());
  });

  const handleContainerDblClick = (e) => {
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
              {(song) => <SearchSongRow song={song} depth={0} />}
            </For>
          </ul>
        </Show>

        <Show when={searchViewMode() === 'nested'}>
          <ul class="explorer-tree" id="explorerTree">
            <For each={nestedTree()}>
              {(node) => (
                <SearchTreeNode node={node} depth={0} onPlaySong={props.onPlaySong} />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
