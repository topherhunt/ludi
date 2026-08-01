const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Resolve the absolute filesystem path for a dropped File object.
  // Electron 32+ removed File.path; webUtils.getPathForFile is the replacement.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Database operations
  getLists: () => ipcRenderer.invoke('db:getLists'),
  getListItems: (listId) => ipcRenderer.invoke('db:getListItems', listId),
  getAllListItems: () => ipcRenderer.invoke('db:getAllListItems'),
  getItem: (itemId) => ipcRenderer.invoke('db:getItem', itemId),
  getSong: (songId) => ipcRenderer.invoke('db:getSong', songId),
  addFolder: (data) => ipcRenderer.invoke('db:addFolder', data),
  addSong: (data) => ipcRenderer.invoke('db:addSong', data),
  addSongToList: (data) => ipcRenderer.invoke('db:addSongToList', data),
  moveItem: (data) => ipcRenderer.invoke('db:moveItem', data),
  deleteItem: (itemId) => ipcRenderer.invoke('db:deleteItem', itemId),
  renameFolder: (data) => ipcRenderer.invoke('db:renameFolder', data),
  updateFolderExpanded: (data) => ipcRenderer.invoke('db:updateFolderExpanded', data),
  sortFolderContents: (listId, sortBy) => ipcRenderer.invoke('db:sortFolderContents', { listId, sortBy }),
  flattenFolder: (listId) => ipcRenderer.invoke('db:flattenFolder', listId),
  getRootListId: (listId) => ipcRenderer.invoke('db:getRootListId', listId),
  deleteItemWithFiles: (itemId) => ipcRenderer.invoke('db:deleteItemWithFiles', itemId),
  getSongFilePathsForItems: (itemIds) => ipcRenderer.invoke('db:getSongFilePathsForItems', itemIds),

  // Native drag-out to Finder. `send`, not `invoke`: it has to run synchronously
  // inside the renderer's dragstart while the mouse is still down.
  startFileDragForItems: (itemIds) => ipcRenderer.send('drag:startForItems', itemIds),

  // Playlist operations (rename goes through renameFolder -- same UPDATE)
  createPlaylist: (title) => ipcRenderer.invoke('db:createPlaylist', title),
  deletePlaylist: (listId) => ipcRenderer.invoke('db:deletePlaylist', listId),
  reorderPlaylists: (orderedIds) => ipcRenderer.invoke('db:reorderPlaylists', orderedIds),
  removeItemsFromList: (itemIds) => ipcRenderer.invoke('db:removeItemsFromList', itemIds),
  previewCopyToList: (data) => ipcRenderer.invoke('db:previewCopyToList', data),
  copyItemsToList: (data) => ipcRenderer.invoke('db:copyItemsToList', data),

  // Tag operations
  getAllTags: () => ipcRenderer.invoke('db:getAllTags'),
  createTag: (data) => ipcRenderer.invoke('db:createTag', data),
  renameTag: (data) => ipcRenderer.invoke('db:renameTag', data),
  setTagColor: (data) => ipcRenderer.invoke('db:setTagColor', data),
  deleteTag: (tagId) => ipcRenderer.invoke('db:deleteTag', tagId),
  reorderTags: (orderedIds) => ipcRenderer.invoke('db:reorderTags', orderedIds),
  addTagToSongs: (data) => ipcRenderer.invoke('db:addTagToSongs', data),
  removeTagFromSongs: (data) => ipcRenderer.invoke('db:removeTagFromSongs', data),
  updateSong: (data) => ipcRenderer.invoke('db:updateSong', data),

  // File import operations
  importFiles: (data) => ipcRenderer.invoke('files:import', data),

  // Library scan (find audio files in the library folder not yet in the DB)
  scanLibraryForNewFiles: () => ipcRenderer.invoke('library:scanMissing'),
  ingestFilesInPlace: (relativePaths) => ipcRenderer.invoke('library:ingestMissing', relativePaths),

  // Settings operations
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),
  closeSettings: () => ipcRenderer.invoke('settings:close'),
  notifyColumnSettingsChanged: (settings) => ipcRenderer.invoke('settings:columnsChanged', settings),
  showInFinder: (filePath) => ipcRenderer.invoke('shell:showInFinder', filePath),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  fileExists: (filePath) => ipcRenderer.invoke('fs:fileExists', filePath),

  // Media key events
  onMediaKey: (callback) => {
    ipcRenderer.on('media-key', (event, action) => callback(action));
  },

  // Column settings refresh
  onColumnSettingsChanged: (callback) => {
    ipcRenderer.on('column-settings-changed', (event, settings) => callback(settings));
  },

  // Library changed (e.g. songs ingested from the Settings window) - refresh the tree
  onLibraryChanged: (callback) => {
    ipcRenderer.on('library-changed', () => callback());
  }
});
