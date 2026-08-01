import { createSignal, createMemo, createRoot } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { currentListId } from './navigation.js';
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
  searchRootListId,
  setSearchRootListId,
  isSearching,
} = createRoot(() => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal(null); // null = not searching
  const [searchError, setSearchError] = createSignal(null);     // null | 'invalid_syntax'
  const [searchViewMode, setSearchViewMode] = createSignal('nested');
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
    searchViewMode,
    setSearchViewMode,
    searchRootListId,
    setSearchRootListId,
    isSearching,
  };
});

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

  const rootListId = currentListId();
  setSearchQuery(trimmed);
  setSearchRootListId(rootListId);

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

  // Which root list (Main Library or playlist) an item ultimately sits under.
  const rootCache = new Map();
  function rootOf(listId) {
    if (rootCache.has(listId)) return rootCache.get(listId);
    const chain = [];
    let id = listId;
    while (id !== null && listIdToFolderItem.has(id)) {
      chain.push(id);
      id = listIdToFolderItem.get(id).parent_list_id;
    }
    for (const seen of chain) rootCache.set(seen, id);
    rootCache.set(listId, id);
    return id;
  }

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
      ancestorFolderNames: ancestorFolders.map(f => f.title),
      tags: (item.tags || []).map(t => t.name),
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
        tags: item.tags || [],
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
  setSearchRootListId(null);
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
  runSearch,
  clearSearch,
};
