import { createSignal, createRoot } from 'solid-js';
import * as api from '../utils/api.js';

// Saved searches: named queries pinned to the sidebar. What's stored is the
// query text, not the songs it matched, so a saved search keeps answering the
// question -- a song that picks up "jazz" tomorrow joins "Jazz + Live" on its
// own, and a tag recalculation reshuffles every saved search for free.
const { savedSearches, setSavedSearches } = createRoot(() => {
  const [savedSearches, setSavedSearches] = createSignal([]);
  return { savedSearches, setSavedSearches };
});

/** Reload the saved searches from the database. */
async function refreshSavedSearches() {
  setSavedSearches(await api.getSavedSearches());
}

/** Save a query under a name, then refresh. Returns the created row. */
async function saveSearch(name, query) {
  const saved = await api.createSavedSearch(name, query);
  await refreshSavedSearches();
  return saved;
}

/** Rename a saved search (the query it runs is unchanged), then refresh. */
async function renameSavedSearch(id, newName) {
  await api.renameSavedSearch(id, newName);
  await refreshSavedSearches();
}

/** Delete a saved search, then refresh. The songs it matched are untouched. */
async function deleteSavedSearch(id) {
  await api.deleteSavedSearch(id);
  await refreshSavedSearches();
}

export {
  savedSearches,
  refreshSavedSearches,
  saveSearch,
  renameSavedSearch,
  deleteSavedSearch,
};
