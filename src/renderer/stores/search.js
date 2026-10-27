import { createSignal, createMemo, createRoot, createEffect, on } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { currentListId } from './navigation.js';
import { parseQuery, evaluateSong, isInvalidQuery } from '../utils/searchParser.js';
import { clearSimilar } from './similar.js';
import { clearCluster, closeGroups } from './clusters.js';
import { closeMap } from './musicMap.js';
import { closeFacets } from './facets.js';
import { libraryVersion } from './tags.js';
import { songRowsUnder } from '../utils/listTree.js';
import { resetSearchCollapse } from './listView.js';

const {
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  searchError,
  setSearchError,
  searchRootListId,
  setSearchRootListId,
  isSearching,
} = createRoot(() => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal(null); // null = not searching
  const [searchError, setSearchError] = createSignal(null);     // null | 'invalid_syntax'
  // The root list the current results came from -- results are scoped to the
  // list you were viewing when you searched.
  const [searchRootListId, setSearchRootListId] = createSignal(null);
  const isSearching = createMemo(() => searchResults() !== null);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchError,
    setSearchError,
    searchRootListId,
    setSearchRootListId,
    isSearching,
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
  resetSearchCollapse();
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

  let ast;
  try {
    ast = parseQuery(trimmed);
  } catch (e) {
    console.error('Search parse error:', e);
    setSearchResults([]);
    return;
  }

  const results = songRowsUnder(allItems, rootListId).filter((row) => {
    if (keepItemIds) return keepItemIds.has(row.item_id);
    return evaluateSong(ast, {
      title: row.title || '',
      artist: row.artist || '',
      album: row.album || '',
      genre: row.genre || '',
      track_number: row.track_number,
      rating: row.rating,
      play_count: row.play_count,
      last_played_at: row.last_played_at,
      date_added: row.date_added,
      ancestorFolderNames: row.ancestor_folder_names,
      tags: row.tags.map(t => t.name),
    });
  });

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

export {
  searchQuery,
  setSearchQuery,
  searchResults,
  searchError,
  searchRootListId,
  isSearching,
  runSearch,
  clearSearch,
};
