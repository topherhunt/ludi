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
import { tags, libraryVersion, showAiTags, isYourTag } from './tags.js';
import { isSearching, searchQuery, searchResults } from './search.js';
import { isShowingSimilar, similarResults } from './similar.js';
import { buildRootResolver } from '../utils/listTree.js';
import { tagTermsIn } from '../utils/tagFilter.js';

/**
 * Sidebar chip order: your own tags first, alphabetically, then the analyzer's
 * (is_auto here means "not yours"), commonest here first.
 *
 * The two halves are looked at differently, so they're sorted differently. A tag
 * you applied by hand is one you go looking for by name, and there are few
 * enough of them to scan -- alphabetical is the order that lets you find one.
 * Auto tags arrive fifty at a time and you don't know their names, so the useful
 * question is "what is this view mostly made of", which is frequency order. The
 * long descending tail of one-song genre tags then sits at the bottom, out of
 * the way, rather than interleaved with everything.
 *
 * Takes tags carrying a `count` (as scopedTags builds them). Pure, so it's unit
 * tested directly.
 */
function sortTagsForSidebar(scoped) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [...scoped].sort((a, b) => {
    if (!a.is_auto !== !b.is_auto) return a.is_auto ? 1 : -1;
    if (!a.is_auto) return byName(a, b);
    return b.count - a.count || byName(a, b);
  });
}

const { visibleSongs, tagCounts, aiTagsInView, activeTagNames, scopedTags } = createRoot(() => {
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

  // With AI tags hidden, a chip counts only the songs you tagged by hand.
  const tagCounts = createMemo(() => {
    const counts = new Map();
    const includeAuto = showAiTags();
    for (const song of visibleSongs()) {
      for (const tag of song.tags || []) {
        if (tag.source === 'auto' && !includeAuto) continue;
        counts.set(tag.id, (counts.get(tag.id) || 0) + 1);
      }
    }
    return counts;
  });

  const aiTagsInView = createMemo(() =>
    visibleSongs().some(song => (song.tags || []).some(tag => tag.source === 'auto'))
  );

  const activeTagNames = createMemo(
    () => new Set(tagTermsIn(searchQuery()).map(name => name.toLowerCase()))
  );

  const scopedTags = createMemo(() => {
    const counts = tagCounts();
    const active = activeTagNames();
    // An active filter keeps its chip even at zero: combining two tags that
    // share no songs empties the view, and a chip that vanished at that moment
    // would leave no way to click the filter back off.
    return sortTagsForSidebar(
      tags()
        .filter(tag => counts.has(tag.id) || active.has(tag.name.toLowerCase()))
        .map(tag => ({ ...tag, is_auto: !isYourTag(tag), count: counts.get(tag.id) || 0 }))
    );
  });

  return { visibleSongs, tagCounts, aiTagsInView, activeTagNames, scopedTags };
});

/** Is this tag one of the filters currently applied? */
function isTagFiltered(tag) {
  return activeTagNames().has(tag.name.toLowerCase());
}

export { visibleSongs, tagCounts, aiTagsInView, activeTagNames, scopedTags, isTagFiltered, sortTagsForSidebar };
