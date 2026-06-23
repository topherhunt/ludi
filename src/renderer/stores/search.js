import { createSignal, createMemo, createRoot } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { parseQuery, evaluateSong, isInvalidQuery } from '../utils/searchParser.js';

const {
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  searchError,
  setSearchError,
  searchViewMode,
  setSearchViewMode,
  isSearching,
} = createRoot(() => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal(null); // null = not searching
  const [searchError, setSearchError] = createSignal(null);     // null | 'invalid_syntax'
  const [searchViewMode, setSearchViewMode] = createSignal('nested');
  const isSearching = createMemo(() => searchResults() !== null);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchError,
    setSearchError,
    searchViewMode,
    setSearchViewMode,
    isSearching,
  };
});

/**
 * Run a search against the full library.
 * Loads all list items, parses the query, filters songs, stores results.
 * @param {string} queryString
 */
async function runSearch(queryString) {
  const trimmed = (queryString || '').trim();
  if (!trimmed) {
    clearSearch();
    return;
  }

  setSearchQuery(trimmed);

  if (isInvalidQuery(trimmed)) {
    setSearchError('invalid_syntax');
    setSearchResults([]);
    return;
  }

  setSearchError(null);

  const allItems = await getAllListItems();

  // map: list_id -> the list_items row for that folder (for walking the ancestor chain)
  const listIdToFolderItem = new Map();
  for (const item of allItems) {
    if (item.list_id !== null) {
      listIdToFolderItem.set(item.list_id, item);
    }
  }

  function getAncestorFolders(item) {
    const ancestors = [];
    let currentListId = item.parent_list_id;
    while (currentListId !== 0 && currentListId !== null) {
      const folderItem = listIdToFolderItem.get(currentListId);
      if (!folderItem) break;
      ancestors.unshift({
        list_id: currentListId,
        title: folderItem.list_title,
        position: folderItem.position,
      });
      currentListId = folderItem.parent_list_id;
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

    const ancestorFolders = getAncestorFolders(item);
    const songData = {
      title: item.song_title || '',
      artist: item.artist || '',
      album: item.album || '',
      track_number: item.track_number,
      ancestorFolderNames: ancestorFolders.map(f => f.title),
    };

    if (evaluateSong(ast, songData)) {
      results.push({
        item_id: item.id,
        song_id: item.song_id,
        title: item.song_title || '',
        artist: item.artist || '',
        album: item.album || '',
        track_number: item.track_number,
        duration_seconds: item.duration_seconds,
        parent_list_id: item.parent_list_id,
        position: item.position,
        ancestor_folders: ancestorFolders,
      });
    }
  }

  setSearchResults(results);
}

/**
 * Clear search state and return to normal library view.
 */
function clearSearch() {
  setSearchResults(null);
  setSearchQuery('');
  setSearchError(null);
}

export {
  searchQuery,
  setSearchQuery,
  searchResults,
  searchError,
  searchViewMode,
  setSearchViewMode,
  isSearching,
  runSearch,
  clearSearch,
};
