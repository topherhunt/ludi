import { createMemo, createResource, createRoot, createSignal } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { buildRootResolver } from '../utils/listTree.js';
import { currentListId } from './navigation.js';
import { libraryVersion } from './tags.js';
import { facetsFor } from '../utils/facets.js';
import { addTagTerm } from '../utils/tagFilter.js';
import { clearSearch } from './search.js';
import { clearSimilar } from './similar.js';
import { clearCluster, closeGroups } from './clusters.js';
import { closeMap } from './musicMap.js';

/**
 * The facet browser: the list you're looking at described by its tags, drilled
 * one tag at a time.
 *
 * Scoped to the current list for the same reason the sidebar chips are -- and so
 * that the counts here mean the same thing the search does. "Show these songs"
 * turns the path into an ordinary query, and a query is scoped to the list it
 * was run from, so a library-wide facet count next to a playlist-wide result
 * list would be a lie. Viewing the Main Library gives the whole library.
 *
 * The counting happens here rather than in SQL because the numbers are small --
 * one row per song, a handful of tags each -- and because every step of a
 * drill-down would otherwise be a round trip. The songs are fetched when the
 * view opens and re-fetched only when the list or the library changes.
 */
const { facetsOpen, setFacetsOpen, facetPath, setFacetPath, librarySongs, facetRows, facetMatches } =
  createRoot(() => {
    const [facetsOpen, setFacetsOpen] = createSignal(false);
    const [facetPath, setFacetPath] = createSignal([]);

    // Only fetched while the view is open: a Solid resource with a falsy source
    // never runs its fetcher.
    const [items] = createResource(
      () => (facetsOpen() ? { listId: currentListId(), version: libraryVersion() } : false),
      async ({ listId }) => {
        // Every song under the list being viewed, folders included -- a tag on a
        // collapsed folder is still a tag in this playlist.
        const allItems = await getAllListItems();
        const rootOf = buildRootResolver(allItems);
        return allItems
          .filter(item => item.song_id !== null && rootOf(item.parent_list_id) === listId)
          .map(item => ({ id: item.song_id, title: item.song_title, tags: item.tags || [] }));
      }
    );

    const librarySongs = () => items() || [];

    const drilled = createMemo(() => facetsFor(librarySongs(), facetPath().map(tag => tag.id)));
    const facetRows = () => drilled().facets;
    const facetMatches = () => drilled().matching;

    return { facetsOpen, setFacetsOpen, facetPath, setFacetPath, librarySongs, facetRows, facetMatches };
  });

/** Open the facet browser, replacing whatever the explorer was showing. */
function openFacets() {
  clearSearch();
  clearSimilar();
  clearCluster();
  closeGroups();
  closeMap();
  setFacetsOpen(true);
}

function closeFacets() {
  setFacetsOpen(false);
}

/** Narrow the drill-down by one more tag. */
function drillInto(tag) {
  if (facetPath().some(picked => picked.id === tag.id)) return;
  setFacetPath([...facetPath(), tag]);
}

/** Back up to the first `depth` tags of the path; 0 is "all songs". */
function backTo(depth) {
  setFacetPath(facetPath().slice(0, depth));
}

/** The search query equivalent to the current drill-down. */
function facetQuery() {
  return facetPath().reduce((query, tag) => addTagTerm(query, tag.name), '');
}

export {
  facetsOpen,
  facetPath,
  facetRows,
  facetMatches,
  librarySongs,
  openFacets,
  closeFacets,
  drillInto,
  backTo,
  facetQuery,
};
