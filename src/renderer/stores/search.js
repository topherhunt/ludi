import { createSignal, createMemo, createRoot, createEffect, on } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { currentListId } from './navigation.js';
import { parseQuery, evaluateSong, isInvalidQuery } from '../utils/searchParser.js';
import { clearSimilar } from './similar.js';
import { clearCluster, closeGroups } from './clusters.js';
import { closeMap } from './musicMap.js';
import { closeFacets } from './facets.js';
import { libraryVersion } from './tags.js';
import { buildRootResolver } from '../utils/listTree.js';
import { buildNestedTree, songsInTreeOrder, findTreeFolder } from '../utils/searchTree.js';

const {
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  searchError,
  setSearchError,
  searchViewMode,
  setSearchViewMode,
  searchRootListId,
  setSearchRootListId,
  isSearching,
  searchTree,
  collapsedFolders,
  setCollapsedFolders,
} = createRoot(() => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal(null); // null = not searching
  const [searchError, setSearchError] = createSignal(null);     // null | 'invalid_syntax'
  const [searchViewMode, setSearchViewMode] = createSignal('nested');
  // The root list the current results came from -- results are scoped to the
  // list you were viewing when you searched.
  const [searchRootListId, setSearchRootListId] = createSignal(null);
  const isSearching = createMemo(() => searchResults() !== null);
  const searchTree = createMemo(() => buildNestedTree(searchResults() || [], searchRootListId()));
  // Kept here rather than in each folder row, which is rebuilt on every refresh.
  const [collapsedFolders, setCollapsedFolders] = createSignal(new Set());

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchError,
    setSearchError,
    searchViewMode,
    setSearchViewMode,
    searchRootListId,
    setSearchRootListId,
    isSearching,
    searchTree,
    collapsedFolders,
    setCollapsedFolders,
  };
});

// Bumped by every search, refresh and clear, so a slow load that has been
// overtaken doesn't write its stale results (or reopen a cleared search).
let searchGeneration = 0;

// The items the last run of the query matched. A refresh redraws exactly these,
// so a song you edit out of the query's reach stays put until you search again.
let matchedItemIds = null;

/**
 * Run a search against the list currently being viewed (the Main Library or a
 * playlist). Loads all list items, parses the query, filters songs, stores
 * results.
 * @param {string} queryString
 */
async function runSearch(queryString) {
  const trimmed = (queryString || '').trim();
  if (!trimmed) {
    clearSearch();
    return;
  }

  // Only one answer to "what should the explorer show" is on screen at a time,
  // so starting a search puts the others away. Only runSearch clears them, never
  // clearSearch -- every other view's opener calls clearSearch, and clearing in
  // both directions would wipe each other out.
  clearSimilar();
  clearCluster();
  closeGroups();
  closeMap();
  closeFacets();

  setSearchQuery(trimmed);
  setSearchRootListId(currentListId());
  setCollapsedFolders(new Set());
  await filterResults(trimmed, currentListId(), null);
}

/** Redraw the current results from the library as it is now, keeping their membership and view state. */
async function refreshSearch() {
  if (!isSearching()) return;
  await filterResults(searchQuery(), searchRootListId(), matchedItemIds);
}

// Any library change (a rating, a tag, a delete) redraws the results.
createRoot(() => createEffect(on(libraryVersion, refreshSearch, { defer: true })));

/**
 * @param {Set<number>|null} keepItemIds - redraw just these items rather than
 *   evaluating the query; null evaluates it and records what matched.
 */
async function filterResults(trimmed, rootListId, keepItemIds) {
  const generation = ++searchGeneration;
  if (isInvalidQuery(trimmed)) {
    setSearchError('invalid_syntax');
    setSearchResults([]);
    return;
  }

  setSearchError(null);

  const allItems = await getAllListItems();
  if (generation !== searchGeneration) return;

  // map: list_id -> the list_items row for that folder (for walking the ancestor chain)
  const listIdToFolderItem = new Map();
  for (const item of allItems) {
    if (item.list_id !== null) {
      listIdToFolderItem.set(item.list_id, item);
    }
  }

  // Which root list (Main Library or playlist) an item ultimately sits under.
  const rootOf = buildRootResolver(allItems);

  function getAncestorFolders(item) {
    const ancestors = [];
    let listId = item.parent_list_id;
    while (listId !== rootListId && listId !== null) {
      const folderItem = listIdToFolderItem.get(listId);
      if (!folderItem) break;
      ancestors.unshift({
        list_id: listId,
        title: folderItem.list_title,
        position: folderItem.position,
      });
      listId = folderItem.parent_list_id;
    }
    return ancestors;
  }

  let ast;
  try {
    ast = parseQuery(trimmed);
  } catch (e) {
    console.error('Search parse error:', e);
    setSearchResults([]);
    return;
  }

  const results = [];
  for (const item of allItems) {
    if (item.song_id === null) continue;
    if (rootOf(item.parent_list_id) !== rootListId) continue;

    const ancestorFolders = getAncestorFolders(item);
    const songData = {
      title: item.song_title || '',
      artist: item.artist || '',
      album: item.album || '',
      track_number: item.track_number,
      rating: item.rating,
      play_count: item.play_count,
      last_played_at: item.last_played_at,
      ancestorFolderNames: ancestorFolders.map(f => f.title),
      tags: (item.tags || []).map(t => t.name),
    };

    if (keepItemIds ? keepItemIds.has(item.id) : evaluateSong(ast, songData)) {
      results.push({
        item_id: item.id,
        song_id: item.song_id,
        title: item.song_title || '',
        artist: item.artist || '',
        album: item.album || '',
        track_number: item.track_number,
        rating: item.rating,
        duration_seconds: item.duration_seconds,
        parent_list_id: item.parent_list_id,
        position: item.position,
        ancestor_folders: ancestorFolders,
        tags: item.tags || [],
      });
    }
  }

  if (!keepItemIds) matchedItemIds = new Set(results.map(result => result.item_id));
  setSearchResults(results);
}

/**
 * Clear search state and return to normal library view.
 */
function clearSearch() {
  searchGeneration++;
  matchedItemIds = null;
  setSearchResults(null);
  setSearchQuery('');
  setSearchError(null);
  setSearchRootListId(null);
}

/**
 * The results top to bottom as the current view mode shows them -- the order a
 * play queue started from the results follows.
 */
function searchResultsInDisplayOrder() {
  return searchViewMode() === 'nested' ? songsInTreeOrder(searchTree()) : searchResults();
}

/** The results inside one virtual folder of the nested view, in display order. */
function searchFolderSongs(listId) {
  const folder = findTreeFolder(searchTree(), listId);
  if (!folder) throw new Error(`No search folder ${listId} in the current results`);
  return songsInTreeOrder(folder.children);
}

export {
  searchQuery,
  setSearchQuery,
  searchResults,
  searchError,
  searchViewMode,
  setSearchViewMode,
  searchRootListId,
  isSearching,
  searchTree,
  searchResultsInDisplayOrder,
  searchFolderSongs,
  runSearch,
  clearSearch,
  collapsedFolders,
  setCollapsedFolders,
};
