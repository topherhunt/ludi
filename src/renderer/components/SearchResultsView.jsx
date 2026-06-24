import { For, Show, createSignal, createMemo } from 'solid-js';
import { searchResults, searchError, searchViewMode } from '../stores/search.js';
import { currentPlayingSongId, isPlaying } from '../stores/playback.js';
import { columnVisibility, gridTemplateColumns } from '../stores/columns.js';
import { formatTime } from '../utils/format.js';
import { selectOnly } from '../stores/navigation.js';

/**
 * Given matched songs with ancestor_folders, build a virtual nested tree.
 * Applies collapsing: folders with exactly 1 matched child are inlined at the parent level.
 * Returns array of nodes: { type:'song'|'folder', ... }
 */
function buildNestedTree(matchedSongs) {
  if (!matchedSongs || matchedSongs.length === 0) return [];

  // folder metadata: list_id -> { title, position, parentListId }
  const folderMeta = new Map();
  folderMeta.set(0, { title: 'Main Library', position: 0, parentListId: null });

  for (const song of matchedSongs) {
    let prevListId = 0;
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

  return renderFolder(0);
}

function SearchSongRow(props) {
  const isCurrent = createMemo(() => props.song.song_id === currentPlayingSongId());

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
        classList={{ 'current-song': isCurrent() }}
        style={{ 'grid-template-columns': gridTemplateColumns() }}
        data-item-id={props.song.item_id}
        data-is-folder="false"
        data-song-id={props.song.song_id}
        onClick={() => selectOnly(props.song.item_id)}
      >
        <span
          class="col-title"
          style={{ 'padding-left': props.depth > 0 ? `${props.depth * 20}px` : undefined }}
        >
          <span class={iconContainerClass()}>
            <i class={iconClass()} />
          </span>
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
          <span class="col-tags" />
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
    return buildNestedTree(searchResults() || []);
  });

  const handleContainerDblClick = (e) => {
    const songEl = e.target.closest('[data-song-id]');
    if (songEl) {
      const songId = parseInt(songEl.dataset.songId);
      const song = (searchResults() || []).find(s => s.song_id === songId);
      if (song) props.onPlaySong?.(song.song_id, song.parent_list_id);
    }
  };

  return (
    <div
      class="explorer-container"
      id="explorerContainer"
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
