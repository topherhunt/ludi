/**
 * The sidebar tag list, scoped to whatever the explorer is currently showing.
 *
 * A global tag list is close to useless once a library has a few hundred tags on
 * it: most of them describe music you aren't looking at. Scoping turns the
 * sidebar into a description of the view -- switch to a playlist and you see
 * what that playlist is made of, search and the list narrows again, with a count
 * on each chip saying how much of what you're looking at carries it.
 *
 * That also makes the chips compose: each click adds one more `tag=` term, and
 * the remaining chips are exactly the tags that would still match something.
 */

import { createMemo, createResource, createRoot } from 'solid-js';
import { getAllListItems } from '../utils/api.js';
import { currentListId } from './navigation.js';
import { tags, libraryVersion } from './tags.js';
import { isSearching, searchQuery, searchResults } from './search.js';
import { isShowingSimilar, similarResults } from './similar.js';
import { buildRootResolver } from '../utils/listTree.js';
import { tagTermsIn } from '../utils/tagFilter.js';

const { visibleSongs, tagCounts, activeTagNames, scopedTags } = createRoot(() => {
  // Every song under the list being viewed, folders included. The tree only
  // renders expanded folders, but a tag on a collapsed one is still a tag in
  // this playlist, so the count has to come from the whole subtree.
  const [listSongs] = createResource(
    () => ({ listId: currentListId(), version: libraryVersion() }),
    async ({ listId }) => {
      if (listId === null || listId === undefined) return [];
      const allItems = await getAllListItems();
      const rootOf = buildRootResolver(allItems);
      return allItems.filter(item => item.song_id !== null && rootOf(item.parent_list_id) === listId);
    }
  );

  // Search and similarity results already carry their tags, so no second fetch.
  const visibleSongs = createMemo(() => {
    if (isShowingSimilar()) return similarResults() || [];
    if (isSearching()) return searchResults() || [];
    return listSongs() || [];
  });

  const tagCounts = createMemo(() => {
    const counts = new Map();
    for (const song of visibleSongs()) {
      for (const tag of song.tags || []) {
        counts.set(tag.id, (counts.get(tag.id) || 0) + 1);
      }
    }
    return counts;
  });

  const activeTagNames = createMemo(
    () => new Set(tagTermsIn(searchQuery()).map(name => name.toLowerCase()))
  );

  const scopedTags = createMemo(() => {
    const counts = tagCounts();
    const active = activeTagNames();
    // An active filter keeps its chip even at zero: combining two tags that
    // share no songs empties the view, and a chip that vanished at that moment
    // would leave no way to click the filter back off.
    return tags()
      .filter(tag => counts.has(tag.id) || active.has(tag.name.toLowerCase()))
      .map(tag => ({ ...tag, count: counts.get(tag.id) || 0 }));
  });

  return { visibleSongs, tagCounts, activeTagNames, scopedTags };
});

/** Is this tag one of the filters currently applied? */
function isTagFiltered(tag) {
  return activeTagNames().has(tag.name.toLowerCase());
}

export { visibleSongs, tagCounts, activeTagNames, scopedTags, isTagFiltered };
