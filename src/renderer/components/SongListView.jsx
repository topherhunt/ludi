import { For, Show, Switch, Match, createMemo, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { currentListId, selectedItems, lastSelectedItemId, selectOnly, toggleSelection, toggleItemsSelection, rangeSelect, setLastSelectedItemId, clearSelection, selectAll, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import { currentPlayingItemId, isPlaying } from '../stores/playback.js';
import { COLUMNS, columnVisibility, gridTemplateColumns } from '../stores/columns.js';
import { bumpLibraryVersion } from '../stores/tags.js';
import { startInternalDrag, endDrag, dragSource, draggedItemIds, showDropIndicator, hideDropIndicator } from '../stores/dragdrop.js';
import { isSearching, searchError } from '../stores/search.js';
import { isShowingSimilar, similarResults, similarTotal, similarLoading, similarNotice, hasMoreSimilar, showMoreSimilar, PAGE_SIZE } from '../stores/similar.js';
import { isShowingCluster } from '../stores/clusters.js';
import { isReorderable, isGroupCollapsed, toggleGroupCollapsed } from '../stores/listView.js';
import { nodes, visibleRows, visibleSongIds, activeViewKey, collapseKey, isListView, libraryLoaded, itemToReveal, setItemToReveal } from '../stores/songList.js';
import { copyIntoPlaylist } from '../stores/playlistCopy.js';
import { showImportSummary } from '../utils/importSummary.js';
import { startNativeFileDrag } from '../utils/dragOut.js';
import { songsInTreeOrder } from '../utils/arrangeRows.js';
import { knownText, summarizeSongs } from '../utils/groupSummary.js';
import { formatTime, formatLocalDate, pluralize } from '../utils/format.js';
import { getItemById, moveItem, addSongsToList } from '../utils/api.js';
import { TagPill, TagPillList } from './TagPill.jsx';
import { StarRating, AverageStars } from './StarRating.jsx';
import { DropIndicator } from './DropIndicator.jsx';
import { ColumnHeaders } from './ColumnHeaders.jsx';

// Only the rows in and near view are in the DOM, so every row is this tall and
// a row's position is its index times this.
const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 20;

// A tag on a few of a group's songs is faint but still readable.
const MIN_TAG_OPACITY = 0.25;

function groupCellContent(key, summary) {
  switch (key) {
    case 'track': return summary.track;
    case 'duration': return summary.duration ? formatTime(summary.duration) : '';
    case 'rating': return summary.rating === null ? '' : <AverageStars rating={summary.rating} />;
    case 'artist': return summary.artist;
    case 'album': return summary.album;
    case 'genre': return summary.genre;
    case 'date_added': return summary.date_added || '';
    case 'plays': return summary.plays || '';
    case 'last_played': return summary.last_played ? formatLocalDate(summary.last_played) : '';
    case 'tags': return (
      <For each={summary.tags}>
        {({ tag, share }) => (
          <span class="qa-group-tag" style={{ opacity: Math.max(share, MIN_TAG_OPACITY) }} data-share={share}>
            <TagPill tag={{ ...tag, is_auto: 0 }} />
          </span>
        )}
      </For>
    );
    default: throw new Error(`No cell for column ${key}`);
  }
}

function cellContent(key, song) {
  switch (key) {
    case 'track': return song.track_number || '';
    case 'duration': return song.duration_seconds ? formatTime(song.duration_seconds) : '';
    case 'rating': return <StarRating rating={song.rating} itemId={song.item_id} />;
    case 'artist': return knownText(song.artist);
    case 'album': return knownText(song.album);
    case 'genre': return song.genre || '';
    case 'date_added': return song.date_added || '';
    case 'plays': return song.play_count || '';
    case 'last_played': return song.last_played_at ? formatLocalDate(song.last_played_at) : '';
    case 'tags': return <TagPillList tags={song.tags} />;
    default: throw new Error(`No cell for column ${key}`);
  }
}

function SongRow(props) {
  const isCurrent = createMemo(() => props.song.item_id === currentPlayingItemId());
  const isSelected = createMemo(() => selectedItems().has(props.song.item_id));
  const isDragged = createMemo(() => dragSource() === 'tree' && draggedItemIds().includes(props.song.item_id));

  // Plain click replaces the selection, CMD toggles, SHIFT extends from the last click.
  const handleClick = (e) => {
    if (e.shiftKey && lastSelectedItemId() !== null) {
      rangeSelect(props.song.item_id, visibleSongIds());
    } else if (e.metaKey || e.ctrlKey) {
      toggleSelection(props.song.item_id);
    } else {
      selectOnly(props.song.item_id);
    }
    setLastSelectedItemId(props.song.item_id);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    props.onContextMenu(e.clientX, e.clientY, {
      id: props.song.item_id,
      list_id: null,
      song_id: props.song.song_id,
      parent_list_id: props.song.parent_list_id,
      position: props.song.position,
    });
  };

  const iconClass = () => {
    if (isCurrent()) return isPlaying() ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    return 'bi bi-music-note';
  };

  return (
    <li class="tree-item" data-item-id={props.song.item_id}>
      <div
        class="tree-item-content qa-song-row"
        classList={{ 'current-song': isCurrent(), selected: isSelected(), dragging: isDragged() }}
        style={{ 'grid-template-columns': gridTemplateColumns(), height: `${ROW_HEIGHT}px` }}
        data-item-id={props.song.item_id}
        data-is-folder="false"
        data-song-id={props.song.song_id}
        draggable={true}
        onClick={handleClick}
        onDblClick={() => props.onPlaySong(props.song.item_id, props.song.parent_list_id)}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => props.onDragStart(e, props.song.item_id)}
      >
        <span class="col-title" style={{ 'padding-left': props.depth > 0 ? `${props.depth * 20}px` : undefined }}>
          <span class={'tree-item-icon' + (isCurrent() ? (isPlaying() ? ' playing' : ' paused') : '')}>
            <i class={iconClass()} />
          </span>
          <Show when={props.song.similarity !== undefined}>
            <span class="similarity-badge qa-similarity">{Math.round(props.song.similarity * 100)}%</span>
          </Show>
          <span class="tree-item-label">{props.song.title}</span>
        </span>

        <For each={COLUMNS}>
          {(column) => (
            <Show when={columnVisibility()[column.key]}>
              <span class={`col-${column.key}`} data-column={column.key}>{cellContent(column.key, props.song)}</span>
            </Show>
          )}
        </For>
      </div>
    </li>
  );
}

function GroupRow(props) {
  const collapsed = () => isGroupCollapsed(collapseKey(), props.node.key);
  const songs = createMemo(() => songsInTreeOrder(props.node.children));
  // Highlighted while every song in it is selected, however that came about.
  const isSelected = createMemo(() => songs().length > 0 && songs().every((song) => selectedItems().has(song.item_id)));

  // The caret opens and closes the group; anywhere else on the row selects its
  // songs, ready to edit together, or with CMD adds them to the selection.
  const handleClick = (e) => {
    const ids = songs().map((song) => song.item_id);
    if (e.target.closest('.tree-item-icon.chevron')) toggleGroupCollapsed(collapseKey(), props.node.key);
    else if (e.metaKey || e.ctrlKey) toggleItemsSelection(ids);
    else selectAll(ids);
  };
  const holdsPlayingSong = createMemo(() => songs().some((song) => song.item_id === currentPlayingItemId()));
  // Collapsed, the row previews its songs column by column; expanded, the songs show for themselves.
  const summary = createMemo(() => (collapsed() ? summarizeSongs(songs()) : null));

  // A group has no placement of its own (id null); the menu acts on the songs in it.
  const handleContextMenu = (e) => {
    e.preventDefault();
    props.onContextMenu(e.clientX, e.clientY, {
      id: null,
      list_id: null,
      song_id: null,
      groupKey: props.node.key,
      groupTitle: props.node.title,
    });
  };

  return (
    <li class="tree-item">
      <div
        class="tree-item-content group-row qa-group-row"
        classList={{ selected: isSelected() }}
        data-group-key={props.node.key}
        data-is-group="true"
        style={{ 'grid-template-columns': collapsed() ? gridTemplateColumns() : '1fr', height: `${ROW_HEIGHT}px` }}
        onClick={handleClick}
        onDblClick={(e) => {
          // Double-clicking the chevron is two toggles, not a play.
          if (!e.target.closest('.tree-item-icon.chevron')) props.onPlayGroup(props.node.key);
        }}
        onContextMenu={handleContextMenu}
      >
        <span class="col-title" style={{ 'padding-left': props.depth > 0 ? `${props.depth * 20}px` : undefined }}>
          <span
            class="tree-item-icon chevron"
            classList={{ expanded: !collapsed(), playing: holdsPlayingSong() && isPlaying(), paused: holdsPlayingSong() && !isPlaying() }}
          >
            <i class="bi bi-caret-right-fill" />
          </span>
          <span class="tree-item-label">
            {props.node.title}
            <span class="tree-item-count">{props.node.songCount} {pluralize(props.node.songCount, 'song')}</span>
          </span>
        </span>

        <Show when={summary()}>
          <For each={COLUMNS}>
            {(column) => (
              <Show when={columnVisibility()[column.key]}>
                <span class={`col-${column.key}`} data-column={column.key}>{groupCellContent(column.key, summary())}</span>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </li>
  );
}

function SongListRow(props) {
  return (
    <Show when={props.node.type === 'group'} fallback={<SongRow {...props} song={props.node.data} />}>
      <GroupRow {...props} />
    </Show>
  );
}

/**
 * Every song list: the Main Library, playlists, search results, similar songs
 * and a group's songs, grouped and sorted by that view's settings.
 *
 * Rows can be dragged out (onto a sidebar playlist, or Option-dragged to the
 * Finder) from any of them. Within a library or playlist they can be dragged
 * into a new order only while the view shows that order -- no grouping, natural
 * sort -- and files from the Finder can be dropped in.
 */
export function SongListView(props) {
  let containerRef;
  let treeRef;
  let draggedIds = [];
  let dropTarget = null; // { itemId, before } or { itemId: null } for the end of the list

  const reorderable = () => isListView() && isReorderable(activeViewKey());

  // ---- Rendering only the rows in view ----
  //
  // Measured from the container's own top, which the rows start a little below
  // (the column headers), so the window errs towards rendering a few more rows.
  const [viewport, setViewport] = createSignal({ top: 0, height: 0 });
  const measureViewport = () => setViewport({ top: containerRef.scrollTop, height: containerRef.clientHeight });

  onMount(() => {
    measureViewport();
    const observer = new ResizeObserver(measureViewport);
    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  const windowRange = createMemo(() => {
    const count = visibleRows().rows.length;
    const { top, height } = viewport();
    const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(count, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN_ROWS);
    return { start, end, count };
  }, undefined, { equals: (a, b) => a.start === b.start && a.end === b.end && a.count === b.count });

  const windowRows = createMemo(() => visibleRows().rows.slice(windowRange().start, windowRange().end));

  // Nearest-edge, like scrollIntoView({ block: 'nearest' }), for a row that may not be rendered.
  const scrollItemIntoView = (itemId) => {
    const index = visibleRows().rows.findIndex((node) => node.type === 'song' && node.data.item_id === itemId);
    if (index === -1) throw new Error(`Item ${itemId} is not in the list`);
    const rowTop = treeRef.offsetTop + parseFloat(getComputedStyle(treeRef).paddingTop) + index * ROW_HEIGHT;
    const viewTop = containerRef.scrollTop + containerRef.querySelector('.column-headers').offsetHeight;
    const viewBottom = containerRef.scrollTop + containerRef.clientHeight;
    if (rowTop < viewTop) containerRef.scrollTo({ top: containerRef.scrollTop - (viewTop - rowTop), behavior: 'instant' });
    else if (rowTop + ROW_HEIGHT > viewBottom) containerRef.scrollTo({ top: containerRef.scrollTop + (rowTop + ROW_HEIGHT - viewBottom), behavior: 'instant' });
  };

  props.ref({ scrollItemIntoView });
  onCleanup(() => props.ref(null));

  createEffect(() => {
    const itemId = itemToReveal();
    if (itemId === null || !visibleSongIds().includes(itemId)) return;
    setItemToReveal(null);
    scrollItemIntoView(itemId);
  });

  // ---- Drag autoscroll ----
  //
  // Chromium's own drag autoscroll only fires in a couple of pixels right at the
  // edge at one fixed speed. This uses a generous band whose speed ramps up
  // towards the edge, so both a slow crawl and a fast scroll are reachable.
  const AUTOSCROLL_BAND_EM = 4;
  const AUTOSCROLL_MIN_PX_PER_SEC = 60;
  const AUTOSCROLL_MAX_PX_PER_SEC = 1400;

  let autoScrollVelocity = 0; // px/sec, negative = up
  let autoScrollFrame = null;
  let lastFrameTime = 0;

  const stepAutoScroll = (now) => {
    if (!containerRef || autoScrollVelocity === 0) {
      autoScrollFrame = null;
      return;
    }
    const elapsed = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    containerRef.scrollTop += autoScrollVelocity * elapsed;
    autoScrollFrame = requestAnimationFrame(stepAutoScroll);
  };

  const updateAutoScroll = (clientY) => {
    const rect = containerRef.getBoundingClientRect();
    const band = AUTOSCROLL_BAND_EM * parseFloat(getComputedStyle(containerRef).fontSize);
    const fromTop = clientY - rect.top;
    const fromBottom = rect.bottom - clientY;

    // 0 outside the band, 1 at (or past) the edge itself.
    let intensity = 0;
    if (fromTop < band) intensity = -(1 - Math.max(fromTop, 0) / band);
    else if (fromBottom < band) intensity = 1 - Math.max(fromBottom, 0) / band;

    // Squared so the slow end of the band stays genuinely slow and controllable.
    autoScrollVelocity = intensity === 0
      ? 0
      : Math.sign(intensity) *
        (AUTOSCROLL_MIN_PX_PER_SEC +
          (AUTOSCROLL_MAX_PX_PER_SEC - AUTOSCROLL_MIN_PX_PER_SEC) * intensity * intensity);

    if (autoScrollVelocity !== 0 && autoScrollFrame === null) {
      lastFrameTime = performance.now();
      autoScrollFrame = requestAnimationFrame(stepAutoScroll);
    }
  };

  const stopAutoScroll = () => {
    autoScrollVelocity = 0;
    if (autoScrollFrame !== null) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
  };

  onCleanup(stopAutoScroll);

  // ---- Dragging rows ----

  const handleDragStart = (e, itemId) => {
    const ids = selectedItems().has(itemId) ? Array.from(selectedItems()) : [itemId];
    // Option-drag hands the files to the OS instead, cancelling the HTML5 drag.
    if (startNativeFileDrag(e, ids)) return;

    draggedIds = ids;
    // 'copyMove' when the drag may also land back in this list: Chromium refuses
    // a drop whose dropEffect isn't allowed, and a sidebar playlist drop is a copy.
    e.dataTransfer.effectAllowed = reorderable() ? 'copyMove' : 'copy';
    // On the source row itself: scrolling can unmount it mid-drag, and a detached
    // node's dragend never bubbles up to the container.
    e.currentTarget.addEventListener('dragend', handleDragEnd, { once: true });
    startInternalDrag(ids, 'tree');
  };

  const handleDragEnd = () => {
    stopAutoScroll();
    draggedIds = [];
    dropTarget = null;
    endDrag();
  };

  const showIndicatorAt = (top) => {
    const containerRect = containerRef.getBoundingClientRect();
    showDropIndicator(top - containerRect.top + containerRef.scrollTop, 0, containerRect.width, 'tree');
  };

  const clearDropTarget = () => {
    hideDropIndicator();
    dropTarget = null;
  };

  // One handler for the whole surface: every dragover bubbles up to here.
  const handleDragOver = (e) => {
    updateAutoScroll(e.clientY);
    if (!isListView() || dragSource() === 'sidebar-playlist') return;

    const isExternalFile = e.dataTransfer.types.includes('Files');
    if (!isExternalFile && (draggedIds.length === 0 || !reorderable())) return;

    const row = reorderable() ? e.target.closest('.tree-item-content[data-item-id]') : null;
    if (!row) {
      // Over empty space, or a grouped/sorted list: files go on the end.
      if (!isExternalFile) return clearDropTarget();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      showIndicatorAt(treeRef.getBoundingClientRect().bottom - parseFloat(getComputedStyle(treeRef).paddingBottom));
      dropTarget = { itemId: null };
      return;
    }

    const itemId = parseInt(row.dataset.itemId);
    if (!isExternalFile && draggedIds.includes(itemId)) return clearDropTarget();

    e.preventDefault();
    e.dataTransfer.dropEffect = isExternalFile ? 'copy' : 'move';
    const rect = row.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    showIndicatorAt(before ? rect.top : rect.bottom);
    dropTarget = { itemId, before };
  };

  const handleDragLeave = (e) => {
    // Leaving for the sidebar keeps the drag payload alive until dragend.
    if (containerRef.contains(e.relatedTarget)) return;
    stopAutoScroll();
    clearDropTarget();
  };

  // Imports into a playlist land in the Main Library first (every song lives
  // there), then get copied in through the same path an in-app drag takes.
  const finishFileImport = async (result, targetListId) => {
    if (result.targetIsPlaylist && result.itemIds.length > 0) {
      await copyIntoPlaylist(result.itemIds, targetListId, props.listTitle);
    }
    bumpLibraryVersion();
    showImportSummary(result);
  };

  const dropFiles = async (e, target) => {
    // Electron 32+ removed File.path; the preload resolves it via webUtils.
    const paths = Array.from(e.dataTransfer.files).map((f) => window.electronAPI.getPathForFile(f));
    if (paths.length === 0) return;

    let listId = currentListId();
    let position;
    if (target.itemId !== null) {
      const item = await getItemById(target.itemId);
      listId = item.parent_list_id;
      position = target.before ? item.position : item.position + 1;
    }
    await finishFileImport(await addSongsToList(listId, paths, position), listId);
  };

  // Move the dragged songs to sit just above or below the target row.
  const moveDraggedTo = async (ids, target) => {
    const targetItem = await getItemById(target.itemId);
    const items = [];
    for (const id of ids) items.push(await getItemById(id));
    items.sort((a, b) => a.position - b.position);

    const basePosition = target.before ? targetItem.position : targetItem.position + 1;
    const sameListAbove = (item) => item.parent_list_id === targetItem.parent_list_id && item.position < basePosition;
    const effectiveBase = basePosition - items.filter(sameListAbove).length;
    const targetPositions = new Map(items.map((item, index) => [item.id, effectiveBase + index]));

    // Items moving down go first, highest first, so removing one never shifts
    // the position of another still waiting to move.
    const movingDown = items.filter(sameListAbove).sort((a, b) => b.position - a.position);
    const rest = items.filter((item) => !sameListAbove(item));
    for (const item of [...movingDown, ...rest]) {
      await moveItem(item.id, targetItem.parent_list_id, targetPositions.get(item.id));
    }
    bumpLibraryVersion();
  };

  const handleDrop = async (e) => {
    stopAutoScroll();
    hideDropIndicator();
    const target = dropTarget;
    const ids = draggedIds;
    dropTarget = null;
    if (!target) return;
    e.preventDefault();

    if (e.dataTransfer.types.includes('Files')) await dropFiles(e, target);
    else if (target.itemId !== null && ids.length > 0) await moveDraggedTo(ids, target);
  };

  // ---- Clicks ----

  const handleContainerClick = (e) => {
    // The path, not target.closest: the click may have removed its own target
    // (a group's preview cells go when it opens).
    const onRow = e.composedPath().some((el) => el instanceof Element && el.matches('.tree-item-content, .column-headers'));
    if (!onRow) clearSelection();
  };

  const showsEmptyPlaylist = () => isListView() && libraryLoaded() && nodes.length === 0 && currentListId() !== MAIN_LIBRARY_ID;
  const remainingSimilar = () => similarTotal() - (similarResults() || []).length;

  return (
    <div
      class="explorer-container"
      classList={{ 'qa-similar-view': isShowingSimilar(), 'qa-cluster-view': isShowingCluster() }}
      id="explorerContainer"
      ref={containerRef}
      onScroll={measureViewport}
      onClick={handleContainerClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Inside the scroll box, so the headings scroll sideways with the columns. */}
      <ColumnHeaders />

      <Show when={isShowingSimilar() && similarNotice()}>
        <div class="search-empty-state qa-similar-notice">
          <i class="bi bi-soundwave" />
          <p>{similarNotice()}</p>
        </div>
      </Show>

      <Switch>
        <Match when={isListView() && !libraryLoaded()}>
          <ul class="explorer-tree" id="explorerTree" data-list-id={currentListId()}><li class="loading">Loading...</li></ul>
        </Match>
        <Match when={isSearching() && searchError() === 'invalid_syntax'}>
          <div class="search-empty-state">
            <i class="bi bi-exclamation-triangle" />
            <p>Invalid search syntax</p>
            <span class="search-empty-hint">"and" and "or" are reserved operators -- use quotes to search for them literally</span>
          </div>
        </Match>
        <Match when={isSearching() && nodes.length === 0}>
          <div class="search-empty-state">
            <i class="bi bi-search" />
            <p>No results found</p>
          </div>
        </Match>
        <Match when={isShowingCluster() && nodes.length === 0}>
          <div class="search-empty-state qa-cluster-empty">
            <i class="bi bi-diagram-2" />
            <p>Every song in this group has been removed from your library.</p>
          </div>
        </Match>
        <Match when={true}>
          <ul class="explorer-tree" id="explorerTree" data-list-id={currentListId()} ref={treeRef}>
            <Show when={showsEmptyPlaylist()}>
              <li class="empty-playlist qa-empty-playlist">Drag songs here to add them to this playlist.</li>
            </Show>
            <li class="qa-rows-above" style={{ height: `${windowRange().start * ROW_HEIGHT}px` }} />
            <For each={windowRows()}>
              {(node) => (
                <SongListRow
                  node={node}
                  depth={visibleRows().depths.get(node.key)}
                  onPlaySong={props.onPlaySong}
                  onPlayGroup={props.onPlayGroup}
                  onContextMenu={props.onContextMenu}
                  onDragStart={handleDragStart}
                />
              )}
            </For>
            <li class="qa-rows-below" style={{ height: `${(windowRange().count - windowRange().end) * ROW_HEIGHT}px` }} />
          </ul>
        </Match>
      </Switch>

      <Show when={isShowingSimilar() && hasMoreSimilar() && nodes.length > 0}>
        <div class="similar-show-more">
          <button
            class="similar-show-more-btn qa-similar-show-more"
            disabled={similarLoading()}
            onClick={() => showMoreSimilar()}
          >
            Show {Math.min(PAGE_SIZE, remainingSimilar())} more
          </button>
        </div>
      </Show>

      <DropIndicator />
    </div>
  );
}
