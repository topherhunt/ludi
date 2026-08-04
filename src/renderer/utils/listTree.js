/**
 * Walking list_items back up to the root list it lives under.
 *
 * Folders nest arbitrarily deep, so "is this song in the Main Library" is a walk
 * up the parent chain, not a column comparison. Both the search and the sidebar
 * tag counts need the same answer -- if they disagreed, a search would show
 * songs the tag counts said weren't there.
 */

/**
 * Build a `rootOf(listId)` for one snapshot of getAllListItems(), memoized
 * across calls so a whole library is one pass, not one walk per song.
 *
 * @param {Array<{ id, list_id, parent_list_id }>} allItems
 * @returns {(listId: number|null) => number|null}
 */
export function buildRootResolver(allItems) {
  // list_id -> the list_items row representing that folder.
  const listIdToFolderItem = new Map();
  for (const item of allItems) {
    if (item.list_id !== null) listIdToFolderItem.set(item.list_id, item);
  }

  const cache = new Map();
  return function rootOf(listId) {
    if (cache.has(listId)) return cache.get(listId);
    const chain = [];
    let id = listId;
    while (id !== null && listIdToFolderItem.has(id)) {
      chain.push(id);
      id = listIdToFolderItem.get(id).parent_list_id;
    }
    for (const seen of chain) cache.set(seen, id);
    cache.set(listId, id);
    return id;
  };
}
