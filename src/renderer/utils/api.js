/**
 * Wrapper around window.electronAPI for cleaner imports
 * and to provide a consistent interface that can be mocked in tests
 */

/**
 * Get the electronAPI object, or a mock for testing
 * @returns {object}
 */
function getAPI() {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI;
  }
  // Return a mock API for testing or when not in Electron
  return {
    getLists: async () => [],
    getListItems: async () => [],
    getAllListItems: async () => [],
    getRootListId: async (listId) => listId,
    getItem: async () => null,
    getSong: async () => null,
    addFolder: async () => ({ id: 0 }),
    addSong: async () => 0,
    addSongToList: async () => ({ id: 0 }),
    moveItem: async () => true,
    deleteItem: async () => true,
    renameFolder: async () => true,
    updateFolderExpanded: async () => true,
    deleteItemWithFiles: async () => ({ totalFiles: 0, deletedFiles: 0, errors: [] }),
    createPlaylist: async (title) => ({ id: 0, title, is_subfolder: 0, sidebar_position: 0 }),
    deletePlaylist: async () => {},
    reorderPlaylists: async () => {},
    removeItemsFromList: async () => {},
    previewCopyToList: async () => ({ totalSongs: 0, duplicates: [] }),
    copyItemsToList: async () => 0,
    getAllTags: async () => [],
    createTag: async ({ name, color }) => ({ id: 0, name, color, position: 0 }),
    renameTag: async () => {},
    setTagColor: async () => {},
    deleteTag: async () => {},
    reorderTags: async () => {},
    addTagToSongs: async () => {},
    removeTagFromSongs: async () => {},
    updateSong: async () => {},
    importFiles: async () => ({ imported: [], unsupported: [], errors: [], targetIsPlaylist: false, itemIds: [] }),
    getSettings: async () => ({ library_path: '', database_path: '' }),
    saveSettings: async () => true,
    selectDirectory: async () => null,
    closeSettings: async () => {},
    notifyColumnSettingsChanged: async () => {},
    onMediaKey: () => {},
    onColumnSettingsChanged: () => {},
  };
}

// Database operations

/**
 * Get all lists (playlists/folders)
 * @returns {Promise<Array<{ id: number, title: string, parent_list_id: number|null }>>}
 */
export async function getLists() {
  return getAPI().getLists();
}

/**
 * Get items in a list
 * @param {number} listId
 * @returns {Promise<Array>}
 */
export async function getListItems(listId) {
  return getAPI().getListItems(listId);
}

export async function getAllListItems() {
  return getAPI().getAllListItems();
}

/**
 * Walk up to the root list a (possibly nested) list belongs to -- i.e. which
 * sidebar playlist a folder lives in. A root list returns its own id.
 * @param {number} listId
 * @returns {Promise<number>}
 */
export async function getRootListId(listId) {
  return getAPI().getRootListId(listId);
}

/**
 * Get a single item by ID
 * @param {number} itemId
 * @returns {Promise<object|null>}
 */
export async function getItem(itemId) {
  return getAPI().getItem(itemId);
}

/**
 * Get a song by ID
 * @param {number} songId
 * @returns {Promise<object|null>}
 */
export async function getSong(songId) {
  return getAPI().getSong(songId);
}

/**
 * Add a new folder
 * @param {number} parentListId
 * @param {number} position
 * @param {string} title
 * @returns {Promise<{ id: number, list_id: number }>}
 */
export async function addFolder(parentListId, position, title) {
  return getAPI().addFolder({ parentListId, position, title });
}

/**
 * Add a song to the database
 * @param {string} filePath
 * @param {string} title
 * @param {string} artist
 * @param {string} album
 * @param {number} durationSeconds
 * @param {number|null} trackNumber
 * @returns {Promise<number>} Song ID
 */
export async function addSong(filePath, title, artist, album, durationSeconds, trackNumber) {
  return getAPI().addSong({ filePath, title, artist, album, durationSeconds, trackNumber });
}

/**
 * Add a song to a list
 * @param {number} songId
 * @param {number} parentListId
 * @param {number} position
 * @returns {Promise<{ id: number }>}
 */
export async function addSongToList(songId, parentListId, position) {
  return getAPI().addSongToList({ songId, parentListId, position });
}

/**
 * Move an item to a new position
 * @param {number} itemId
 * @param {number} newParentListId
 * @param {number} newPosition
 * @returns {Promise<boolean>}
 */
export async function moveItem(itemId, newParentListId, newPosition) {
  return getAPI().moveItem({ itemId, newParentListId, newPosition });
}

/**
 * Delete an item (and its children if it's a folder)
 * @param {number} itemId
 * @returns {Promise<boolean>}
 */
export async function deleteItem(itemId) {
  return getAPI().deleteItem(itemId);
}

/**
 * Rename a folder
 * @param {number} listId
 * @param {string} newTitle
 * @returns {Promise<boolean>}
 */
export async function renameFolder(listId, newTitle) {
  return getAPI().renameFolder({ listId, newTitle });
}

/**
 * Update folder expanded state
 * @param {number} listId
 * @param {boolean} isExpanded
 * @returns {Promise<boolean>}
 */
export async function updateFolderExpanded(listId, isExpanded) {
  return getAPI().updateFolderExpanded({ listId, isExpanded });
}

/**
 * Delete an item and its associated files
 * @param {number} itemId
 * @returns {Promise<{ totalFiles: number, deletedFiles: number, errors: Array }>}
 */
export async function deleteItemWithFiles(itemId) {
  return getAPI().deleteItemWithFiles(itemId);
}

// Playlist operations
//
// A playlist is a root list holding references to songs. Copying into one never
// touches audio files. Playlist rename goes through renameFolder -- same UPDATE.

/** Create an empty playlist at the end of the sidebar. Returns the new list row. */
export async function createPlaylist(title) {
  return getAPI().createPlaylist(title);
}

/** Delete a playlist and its placements. Songs and files are untouched. */
export async function deletePlaylist(listId) {
  return getAPI().deletePlaylist(listId);
}

/**
 * Rewrite sidebar order from an ordered array of playlist ids.
 * Must NOT include the Main Library -- it stays pinned at the top.
 */
export async function reorderPlaylists(orderedIds) {
  return getAPI().reorderPlaylists(orderedIds);
}

/** Remove placements from their list. Never deletes songs or audio files. */
export async function removeItemsFromList(itemIds) {
  return getAPI().removeItemsFromList(itemIds);
}

/**
 * What copying these items into a list would bring in, and which songs are
 * already there. Drives the add/skip/cancel duplicates dialog.
 * @returns {Promise<{ totalSongs: number, duplicates: Array<{ song_id, title }> }>}
 */
export async function previewCopyToList(itemIds, targetListId) {
  return getAPI().previewCopyToList({ itemIds, targetListId });
}

/**
 * Append copies of these items to the end of a list. Folders are recreated;
 * songs become new references to the same song rows.
 * @returns {Promise<number>} how many songs were added
 */
export async function copyItemsToList(itemIds, targetListId, skipSongIds = []) {
  return getAPI().copyItemsToList({ itemIds, targetListId, skipSongIds });
}

// Tag operations

/** Get all defined tags, ordered by position. */
export async function getAllTags() {
  return getAPI().getAllTags();
}

/** Create a tag (name + color). Returns the created tag row. */
export async function createTag(name, color) {
  return getAPI().createTag({ name, color });
}

/** Rename a tag (applies to all its usages). */
export async function renameTag(tagId, newName) {
  return getAPI().renameTag({ tagId, newName });
}

/** Change a tag's color. */
export async function setTagColor(tagId, color) {
  return getAPI().setTagColor({ tagId, color });
}

/** Delete a tag and all its song associations. */
export async function deleteTag(tagId) {
  return getAPI().deleteTag(tagId);
}

/** Rewrite tag sort order to match the given array of tag ids. */
export async function reorderTags(orderedIds) {
  return getAPI().reorderTags(orderedIds);
}

/** Apply a tag to the given songs. */
export async function addTagToSongs(tagId, songIds) {
  return getAPI().addTagToSongs({ tagId, songIds });
}

/** Remove a tag from the given songs. */
export async function removeTagFromSongs(tagId, songIds) {
  return getAPI().removeTagFromSongs({ tagId, songIds });
}

/** Update editable song metadata (title/artist/album/track_number). DB only. */
export async function updateSong(songId, fields) {
  return getAPI().updateSong({ songId, fields });
}

// File operations

/**
 * Import files into a list
 * @param {string[]} filePaths
 * @param {number} parentListId
 * @param {number} position
 * When parentListId resolves to a playlist, files are imported into the Main
 * Library instead and `itemIds` holds the resulting library items, so the caller
 * can copy them into the playlist.
 * @returns {Promise<{ imported: Array, unsupported: Array, errors: Array, targetIsPlaylist: boolean, itemIds: number[] }>}
 */
export async function importFiles(filePaths, parentListId, position) {
  return getAPI().importFiles({ filePaths, parentListId, position });
}

// Settings operations

/**
 * Get application settings
 * @returns {Promise<{ library_path: string, database_path: string }>}
 */
export async function getSettings() {
  return getAPI().getSettings();
}

/**
 * Save application settings
 * @param {object} settings
 * @returns {Promise<boolean>}
 */
export async function saveSettings(settings) {
  return getAPI().saveSettings(settings);
}

/**
 * Open directory picker dialog
 * @returns {Promise<string|null>}
 */
export async function selectDirectory() {
  return getAPI().selectDirectory();
}

/**
 * Close the settings window
 */
export async function closeSettings() {
  return getAPI().closeSettings();
}

/**
 * Notify main window of column settings changes
 * @param {object} settings
 */
export async function notifyColumnSettingsChanged(settings) {
  return getAPI().notifyColumnSettingsChanged(settings);
}

// Event listeners

/**
 * Register a callback for media key events
 * @param {Function} callback
 */
export function onMediaKey(callback) {
  getAPI().onMediaKey(callback);
}

/**
 * Register a callback for column settings changes
 * @param {Function} callback
 */
export function onColumnSettingsChanged(callback) {
  getAPI().onColumnSettingsChanged(callback);
}

// Helper functions

/**
 * Get an item by ID (alias for getItem for consistency)
 * @param {number} itemId
 * @returns {Promise<object|null>}
 */
export async function getItemById(itemId) {
  return getItem(itemId);
}

/**
 * Get the file path for a song
 * @param {number} songId
 * @returns {Promise<string|null>}
 */
export async function getSongPath(songId) {
  const song = await getSong(songId);
  return song?.file_path || null;
}

/**
 * Get all songs in a list (recursively including subfolders).
 * `item_id` identifies the placement, and is what playback keys off -- the same
 * song can appear more than once in a playlist, so `id` alone is ambiguous.
 * @param {number} listId
 * @returns {Promise<Array<{ item_id: number, id: number, title: string, artist: string, file_path: string }>>}
 */
export async function getSongsInList(listId) {
  const items = await getListItems(listId);
  const songs = [];

  for (const item of items) {
    if (item.list_id !== null) {
      // This is a folder, recurse into it
      const subSongs = await getSongsInList(item.list_id);
      songs.push(...subSongs);
    } else if (item.song_id !== null) {
      // This is a song
      const song = await getSong(item.song_id);
      if (song) {
        songs.push({
          item_id: item.id,
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          file_path: song.file_path,
          duration_seconds: song.duration_seconds,
        });
      }
    }
  }

  return songs;
}

/**
 * Count all songs in a list (recursively including subfolders)
 * More efficient than getSongsInList when you only need the count
 * @param {number} listId
 * @returns {Promise<number>}
 */
export async function countSongsInList(listId) {
  const items = await getListItems(listId);
  let count = 0;

  for (const item of items) {
    if (item.list_id !== null) {
      // This is a folder, recurse into it
      count += await countSongsInList(item.list_id);
    } else if (item.song_id !== null) {
      // This is a song
      count++;
    }
  }

  return count;
}

/**
 * Check if a folder contains a specific song (recursively)
 * @param {number} listId
 * @param {number|null} songId
 * @returns {Promise<boolean>}
 */
export async function folderContainsSong(listId, songId) {
  if (!songId) return false;

  const items = await getListItems(listId);

  for (const item of items) {
    if (item.song_id === songId) {
      return true;
    }
    if (item.list_id !== null) {
      // Check subfolders
      const contains = await folderContainsSong(item.list_id, songId);
      if (contains) return true;
    }
  }

  return false;
}

/**
 * Add songs to a list by file paths
 * @param {number} listId
 * @param {string[]} filePaths
 * @param {number} [position] - Optional position to insert at (defaults to end)
 * @returns {Promise<{ imported: Array, unsupported: Array, errors: Array }>}
 */
export async function addSongsToList(listId, filePaths, position) {
  if (position === undefined) {
    const items = await getListItems(listId);
    position = items.length;
  }

  return importFiles(filePaths, listId, position);
}
