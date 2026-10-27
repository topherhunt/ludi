/**
 * Walking list_items back up to the root list it lives under.
 *
 * Folders nest arbitrarily deep, so "is this song in the Main Library" is a walk
 * up the parent chain, not a column comparison. Both the search and the sidebar
 * tag counts need the same answer -- if they disagreed, a search would show
 * songs the tag counts said weren't there.
 */

/**
 * Every song placed under `rootListId`, at any depth, in library order (each
 * folder's contents where the folder sits). Rows are what the song lists render.
 * `ancestor_folder_names` keeps the (deprecated, now hidden) folders searchable.
 *
 * @param {Array} allItems - one snapshot of getAllListItems(), ordered by parent and position
 */
export function songRowsUnder(allItems, rootListId) {
  const childrenByParent = new Map();
  for (const item of allItems) {
    if (!childrenByParent.has(item.parent_list_id)) childrenByParent.set(item.parent_list_id, []);
    childrenByParent.get(item.parent_list_id).push(item);
  }

  const rows = [];
  const walk = (listId, folderNames) => {
    for (const item of childrenByParent.get(listId) || []) {
      if (item.list_id !== null) {
        walk(item.list_id, [...folderNames, item.list_title]);
        continue;
      }
      rows.push({
        item_id: item.id,
        song_id: item.song_id,
        title: item.song_title,
        artist: item.artist,
        album: item.album,
        track_number: item.track_number,
        rating: item.rating,
        duration_seconds: item.duration_seconds,
        play_count: item.play_count,
        last_played_at: item.last_played_at,
        genre: item.genre,
        date_added: item.date_added,
        parent_list_id: item.parent_list_id,
        position: item.position,
        tags: item.tags,
        ancestor_folder_names: folderNames,
      });
    }
  };
  walk(rootListId, []);
  return rows;
}

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
