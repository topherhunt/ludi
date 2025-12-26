import { getListItems } from './api.js';

/**
 * Check if targetListId is a descendant of sourceListId (or is sourceListId itself)
 * Used to prevent circular folder moves
 * @param {number} sourceListId - The parent folder to check from
 * @param {number} targetListId - The folder to find in descendants
 * @returns {Promise<boolean>}
 */
export async function isDescendantFolder(sourceListId, targetListId) {
  if (sourceListId === targetListId) {
    return true;  // A folder is considered its own descendant for this check
  }

  const items = await getListItems(sourceListId);

  for (const item of items) {
    if (item.list_id !== null) {
      if (item.list_id === targetListId) {
        return true;
      }
      if (await isDescendantFolder(item.list_id, targetListId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a folder contains a specific song (recursively checking subfolders)
 * Used to show playing indicator on parent folders
 * @param {number} folderId
 * @param {number} songId
 * @returns {Promise<boolean>}
 */
export async function folderContainsSong(folderId, songId) {
  if (!songId) return false;

  const items = await getListItems(folderId);

  for (const item of items) {
    if (item.song_id === songId) {
      return true;
    }
    if (item.list_id !== null) {
      if (await folderContainsSong(item.list_id, songId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Count all items in a folder recursively (including items in subfolders)
 * @param {number} folderId
 * @returns {Promise<number>}
 */
export async function getFolderItemCount(folderId) {
  const items = await getListItems(folderId);
  let count = items.length;

  for (const item of items) {
    if (item.list_id !== null) {
      count += await getFolderItemCount(item.list_id);
    }
  }

  return count;
}

/**
 * Build a flat playlist of song IDs from a folder (recursively)
 * @param {number} folderId
 * @returns {Promise<number[]>} Array of song IDs
 */
export async function buildPlaylistFromFolder(folderId) {
  const playlist = [];
  const items = await getListItems(folderId);

  for (const item of items) {
    if (item.song_id) {
      playlist.push(item.song_id);
    } else if (item.list_id) {
      const subPlaylist = await buildPlaylistFromFolder(item.list_id);
      playlist.push(...subPlaylist);
    }
  }

  return playlist;
}

/**
 * Get all visible item IDs in tree order (for range selection)
 * @param {number} listId - The root list ID
 * @param {Set<number>} expandedFolders - Set of expanded folder list IDs
 * @returns {Promise<number[]>} Flat array of item IDs in visible order
 */
export async function getVisibleItemIds(listId, expandedFolders) {
  const result = [];
  const items = await getListItems(listId);

  for (const item of items) {
    result.push(item.id);

    // If this is an expanded folder, recursively get its visible items
    if (item.list_id !== null && expandedFolders.has(item.list_id)) {
      const childIds = await getVisibleItemIds(item.list_id, expandedFolders);
      result.push(...childIds);
    }
  }

  return result;
}

/**
 * Find the parent list ID for an item
 * @param {number} itemId
 * @param {number} rootListId - The root list to search from
 * @returns {Promise<number|null>} The parent list ID, or null if not found
 */
export async function findParentListId(itemId, rootListId) {
  const items = await getListItems(rootListId);

  for (const item of items) {
    if (item.id === itemId) {
      return rootListId;
    }
    if (item.list_id !== null) {
      const found = await findParentListId(itemId, item.list_id);
      if (found !== null) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Get the path to an item (list of folder titles from root to item)
 * @param {number} itemId
 * @param {number} rootListId
 * @returns {Promise<string[]>} Array of folder titles
 */
export async function getItemPath(itemId, rootListId) {
  const items = await getListItems(rootListId);

  for (const item of items) {
    if (item.id === itemId) {
      return [];
    }
    if (item.list_id !== null) {
      const subPath = await getItemPath(itemId, item.list_id);
      if (subPath !== null) {
        return [item.list_title, ...subPath];
      }
    }
  }

  return null;
}
