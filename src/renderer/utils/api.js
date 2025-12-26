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
    importFiles: async () => ({ imported: [], unsupported: [], errors: [] }),
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

// File operations

/**
 * Import files into a list
 * @param {string[]} filePaths
 * @param {number} parentListId
 * @param {number} position
 * @returns {Promise<{ imported: Array, unsupported: Array, errors: Array }>}
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
 * Get all songs in a list (recursively including subfolders)
 * @param {number} listId
 * @returns {Promise<Array<{ id: number, title: string, artist: string, file_path: string }>>}
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
 * @returns {Promise<void>}
 */
export async function addSongsToList(listId, filePaths) {
  const items = await getListItems(listId);
  const position = items.length;

  await importFiles(filePaths, listId, position);
}
