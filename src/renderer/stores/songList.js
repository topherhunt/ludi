import { createSignal, createMemo, createRoot, createEffect, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { getAllListItems } from '../utils/api.js';
import { currentListId, selectItem, selectedItems, selectAll, toggleItemsSelection, MAIN_LIBRARY_ID } from './navigation.js';
import { openList } from './viewHistory.js';
import { libraryVersion } from './tags.js';
import { isSearching, searchResults, searchRootListId } from './search.js';
import { isShowingSimilar, similarResults } from './similar.js';
import { isShowingCluster, clusterSongs } from './clusters.js';
import { viewSettings, isGroupCollapsed, toggleGroupCollapsed } from './listView.js';
import { songRowsUnder } from '../utils/listTree.js';
import { arrangeRows, songsInTreeOrder, findGroup } from '../utils/arrangeRows.js';

/**
 * The song list on screen -- the Main Library, a playlist, search results,
 * similar songs or a group's songs -- arranged by that view's group and sort
 * settings. Every one of them renders, plays and selects through this.
 */
const store = createRoot(() => {
  const [libraryRows, setLibraryRows] = createSignal([]);
  const [libraryRowsListId, setLibraryRowsListId] = createSignal(null);

  // Bumped per load, so a slow load overtaken by a list switch can't land.
  let loadGeneration = 0;
  createEffect(on([currentListId, libraryVersion], async ([listId]) => {
    const generation = ++loadGeneration;
    const rows = songRowsUnder(await getAllListItems(), listId);
    if (generation !== loadGeneration) return;
    setLibraryRows(rows);
    setLibraryRowsListId(listId);
  }));

  const libraryLoaded = createMemo(() => libraryRowsListId() === currentListId());

  // Which saved settings apply. Search results share the settings of the list searched.
  const activeViewKey = createMemo(() => {
    if (isShowingSimilar()) return 'similar';
    if (isShowingCluster()) return 'cluster';
    if (isSearching()) return `list:${searchRootListId()}`;
    return `list:${currentListId()}`;
  });

  // Which collapsed-groups state applies. Search keeps its own, reset per search.
  const collapseKey = createMemo(() => (isSearching() ? 'search' : activeViewKey()));

  // Library and playlist views (not results) can be reordered and dropped onto.
  const isListView = createMemo(() => !isShowingSimilar() && !isShowingCluster() && !isSearching());

  const activeRows = createMemo(() => {
    if (isShowingSimilar()) return similarResults() || [];
    if (isShowingCluster()) return clusterSongs();
    if (isSearching()) return searchResults();
    return libraryRows();
  });

  const arranged = createMemo(() => arrangeRows(activeRows(), viewSettings(activeViewKey())));

  // Rendered from a reconciled store so a reload patches the rows that changed
  // instead of rebuilding the list (which would reset scroll and break drags).
  const [nodes, setNodes] = createStore([]);
  createEffect(() => setNodes(reconcile(arranged(), { key: 'key' })));

  const displayedSongs = createMemo(() => songsInTreeOrder(arranged()));

  // The rows on screen, top to bottom: an open group's rows follow it, a
  // collapsed group's are left out. Holds the store's own node proxies, which
  // reconcile keeps stable, so a row's DOM survives recomputing this.
  const visibleRows = createMemo(() => {
    const rows = [];
    const depths = new Map();
    const walk = (list, depth) => {
      for (const node of list) {
        rows.push(node);
        depths.set(node.key, depth);
        if (node.type === 'group' && !isGroupCollapsed(collapseKey(), node.key)) walk(node.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return { rows, depths };
  });

  const visibleSongIds = createMemo(() =>
    visibleRows().rows.filter((node) => node.type === 'song').map((node) => node.data.item_id));

  // The row the arrow keys move from, and the row a SHIFT range stretches from.
  // Row keys, so either can be a song or a group.
  const [cursorRowKey, setCursorRowKey] = createSignal(null);
  const [anchorRowKey, setAnchorRowKey] = createSignal(null);

  // A song to find in the Main Library once it has loaded, then the row the
  // list should scroll to once that row is on screen.
  const [songToReveal, setSongToReveal] = createSignal(null);
  const [rowToReveal, setRowToReveal] = createSignal(null);
  createEffect(() => {
    const songId = songToReveal();
    if (songId === null || !libraryLoaded() || activeViewKey() !== `list:${MAIN_LIBRARY_ID}`) return;
    setSongToReveal(null);
    const path = pathToSong(arranged(), songId);
    if (!path) throw new Error(`Song ${songId} is not in the Main Library`);
    const row = path.pop();
    for (const group of path) {
      if (isGroupCollapsed(collapseKey(), group.key)) toggleGroupCollapsed(collapseKey(), group.key);
    }
    selectItem(row.data.item_id);
    setCursorRowKey(row.key);
    setAnchorRowKey(row.key);
    setRowToReveal(row.key);
  });

  return {
    libraryLoaded, activeViewKey, collapseKey, isListView, nodes, arranged, displayedSongs, visibleRows, visibleSongIds,
    cursorRowKey, setCursorRowKey, anchorRowKey, setAnchorRowKey, setSongToReveal, rowToReveal, setRowToReveal,
  };
});

export const { libraryLoaded, activeViewKey, collapseKey, isListView, nodes, displayedSongs, visibleRows, visibleSongIds, cursorRowKey, rowToReveal, setRowToReveal } = store;

const rowSongIds = (node) =>
  (node.type === 'group' ? songsInTreeOrder(node.children).map((song) => song.item_id) : [node.data.item_id]);

// A group row counts as selected when every song in it is, as its highlight shows.
const isRowSelected = (node, selected) => rowSongIds(node).every((id) => selected.has(id));

const rowIndex = (rows, key) => rows.findIndex((node) => node.key === key);

function selectRowRange(rows, from, to) {
  const [start, end] = from < to ? [from, to] : [to, from];
  selectAll(rows.slice(start, end + 1).flatMap(rowSongIds));
}

/**
 * A click on a song or group row: selects its songs, with CMD adds or removes
 * them, with SHIFT selects every row from the last plain or CMD click to it.
 */
export function clickRow(node, { shift, cmd }) {
  const rows = store.visibleRows().rows;
  const anchor = rowIndex(rows, store.anchorRowKey());
  if (shift && anchor !== -1) {
    selectRowRange(rows, anchor, rowIndex(rows, node.key));
  } else {
    if (cmd) toggleItemsSelection(rowSongIds(node));
    else selectAll(rowSongIds(node));
    store.setAnchorRowKey(node.key);
  }
  store.setCursorRowKey(node.key);
}

/**
 * Up/Down: moves to the next row up or down (song or group) and selects it, or
 * with `extend` (SHIFT) stretches the range to it. Returns the row's key, or null
 * for an empty list.
 */
export function moveRowCursor(step, extend) {
  const rows = store.visibleRows().rows;
  if (rows.length === 0) return null;
  const selected = selectedItems();
  // Selection changed some other way since: carry on from its topmost row.
  let from = rowIndex(rows, store.cursorRowKey());
  if (from === -1 || !isRowSelected(rows[from], selected)) from = rows.findIndex((node) => isRowSelected(node, selected));

  const to = from === -1 ? (step > 0 ? 0 : rows.length - 1) : Math.min(Math.max(from + step, 0), rows.length - 1);
  if (extend && from !== -1) {
    const anchor = rowIndex(rows, store.anchorRowKey());
    const start = anchor === -1 ? from : anchor;
    selectRowRange(rows, start, to);
    store.setAnchorRowKey(rows[start].key);
  } else {
    selectAll(rowSongIds(rows[to]));
    store.setAnchorRowKey(rows[to].key);
  }
  store.setCursorRowKey(rows[to].key);
  return rows[to].key;
}

/** CMD+A: every song in the list, in closed groups too. */
export function selectAllRows() {
  const rows = store.visibleRows().rows;
  if (rows.length === 0) return;
  selectAll(store.displayedSongs().map((song) => song.item_id));
  store.setAnchorRowKey(rows[0].key);
  store.setCursorRowKey(rows[rows.length - 1].key);
}

// The groups a song sits in, outermost first, then the song's own row.
function pathToSong(nodes, songId) {
  for (const node of nodes) {
    if (node.type === 'song') {
      if (node.data.song_id === songId) return [node];
    } else {
      const inside = pathToSong(node.children, songId);
      if (inside) return [node, ...inside];
    }
  }
  return null;
}

/** Opens the Main Library on a song's row, selected and scrolled into view. */
export function revealInLibrary(songId) {
  openList(MAIN_LIBRARY_ID);
  store.setSongToReveal(songId);
}

/** The songs in one group, in the order shown. */
export function groupSongs(groupKey) {
  const group = findGroup(store.arranged(), groupKey);
  if (!group) throw new Error(`No group ${groupKey} in the current view`);
  return songsInTreeOrder(group.children);
}

/**
 * The selected groups -- every song in them selected, as their highlight shows
 * -- leaving out any inside another selected group, so opening them opens one level.
 */
export function outermostSelectedGroupKeys() {
  const selected = selectedItems();
  const keys = [];
  const walk = (list) => {
    for (const node of list) {
      if (node.type !== 'group') continue;
      if (songsInTreeOrder(node.children).every((song) => selected.has(song.item_id))) keys.push(node.key);
      else walk(node.children);
    }
  };
  walk(store.arranged());
  return keys;
}

/** A playlist's songs as its own view would show them, for playing it from the sidebar. */
export async function arrangedSongsInList(listId) {
  const rows = songRowsUnder(await getAllListItems(), listId);
  return songsInTreeOrder(arrangeRows(rows, viewSettings(`list:${listId}`)));
}
