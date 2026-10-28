import { createSignal, createMemo, createRoot, createEffect, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { getAllListItems } from '../utils/api.js';
import { currentListId } from './navigation.js';
import { libraryVersion } from './tags.js';
import { isSearching, searchResults, searchRootListId } from './search.js';
import { isShowingSimilar, similarResults } from './similar.js';
import { isShowingCluster, clusterSongs } from './clusters.js';
import { viewSettings, isGroupCollapsed } from './listView.js';
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

  return { libraryLoaded, activeViewKey, collapseKey, isListView, nodes, arranged, displayedSongs, visibleRows, visibleSongIds };
});

export const { libraryLoaded, activeViewKey, collapseKey, isListView, nodes, displayedSongs, visibleRows, visibleSongIds } = store;

/** The songs in one group, in the order shown. */
export function groupSongs(groupKey) {
  const group = findGroup(store.arranged(), groupKey);
  if (!group) throw new Error(`No group ${groupKey} in the current view`);
  return songsInTreeOrder(group.children);
}

/** A playlist's songs as its own view would show them, for playing it from the sidebar. */
export async function arrangedSongsInList(listId) {
  const rows = songRowsUnder(await getAllListItems(), listId);
  return songsInTreeOrder(arrangeRows(rows, viewSettings(`list:${listId}`)));
}
