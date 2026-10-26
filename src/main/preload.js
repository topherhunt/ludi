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
  getSongsInListDeep: (listId) => ipcRenderer.invoke('db:getSongsInListDeep', listId),
  getRootListId: (listId) => ipcRenderer.invoke('db:getRootListId', listId),
  deleteItemWithFiles: (itemId) => ipcRenderer.invoke('db:deleteItemWithFiles', itemId),
  getSongFilePathsForItems: (itemIds) => ipcRenderer.invoke('db:getSongFilePathsForItems', itemIds),

  // Copy a selection's audio files into a folder the user picks. Same result as
  // dragging out to the Finder, without needing the Option key.
  copyItemsToFolder: (itemIds) => ipcRenderer.invoke('files:copyItemsToFolder', itemIds),

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

  // Saved searches
  getSavedSearches: () => ipcRenderer.invoke('db:getSavedSearches'),
  createSavedSearch: (data) => ipcRenderer.invoke('db:createSavedSearch', data),
  renameSavedSearch: (data) => ipcRenderer.invoke('db:renameSavedSearch', data),
  deleteSavedSearch: (id) => ipcRenderer.invoke('db:deleteSavedSearch', id),

  // Tag operations
  getAllTags: () => ipcRenderer.invoke('db:getAllTags'),
  createTag: (data) => ipcRenderer.invoke('db:createTag', data),
  renameTag: (data) => ipcRenderer.invoke('db:renameTag', data),
  setTagColor: (data) => ipcRenderer.invoke('db:setTagColor', data),
  deleteTag: (tagId) => ipcRenderer.invoke('db:deleteTag', tagId),
  addTagToSongs: (data) => ipcRenderer.invoke('db:addTagToSongs', data),
  removeTagFromSongs: (data) => ipcRenderer.invoke('db:removeTagFromSongs', data),
  updateSong: (data) => ipcRenderer.invoke('db:updateSong', data),
  setSongRating: (data) => ipcRenderer.invoke('db:setSongRating', data),
  recordSongPlay: (songId) => ipcRenderer.invoke('db:recordSongPlay', songId),

  // Star-rating import from another music app's library
  chooseSwinsianLibrary: () => ipcRenderer.invoke('ratings:chooseSwinsianLibrary'),
  previewSwinsianRatings: (dbPath) => ipcRenderer.invoke('ratings:previewSwinsian', dbPath),
  applySwinsianRatings: (dbPath) => ipcRenderer.invoke('ratings:applySwinsian', dbPath),

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
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  fileExists: (filePath) => ipcRenderer.invoke('fs:fileExists', filePath),

  // Keep the app from being suspended while a song is playing.
  setPlaybackActive: (active) => ipcRenderer.invoke('power:setPlaybackActive', active),
  isPlaybackPreventingSuspension: () => ipcRenderer.invoke('power:isPlaybackActive'),

  // Audio analysis
  startAnalysis: () => ipcRenderer.invoke('analysis:start'),
  stopAnalysis: () => ipcRenderer.invoke('analysis:stop'),
  getAnalysisProgress: () => ipcRenderer.invoke('analysis:getProgress'),
  getFailedAnalyses: () => ipcRenderer.invoke('analysis:getFailed'),
  retryFailedAnalyses: () => ipcRenderer.invoke('analysis:retryFailed'),
  recalculateAutoTags: () => ipcRenderer.invoke('analysis:recalculateTags'),
  clearAutoTags: () => ipcRenderer.invoke('analysis:clearAutoTags'),
  getSongAnalysis: (songId) => ipcRenderer.invoke('analysis:getSongAnalysis', songId),

  // Similarity
  findSimilarSongs: (seedSongIds, options) => ipcRenderer.invoke('similarity:find', seedSongIds, options),

  // Clusters
  recalculateClusters: () => ipcRenderer.invoke('clusters:recalculate'),
  getClusters: () => ipcRenderer.invoke('clusters:list'),
  getClusterSongs: (clusterId) => ipcRenderer.invoke('clusters:songs', clusterId),
  renameCluster: (data) => ipcRenderer.invoke('clusters:rename', data),
  saveClusterAsPlaylist: (data) => ipcRenderer.invoke('clusters:saveAsPlaylist', data),

  // Music map
  recalculateMap: () => ipcRenderer.invoke('map:recalculate'),
  getMapPoints: () => ipcRenderer.invoke('map:points'),
  saveMapSelectionAsPlaylist: (data) => ipcRenderer.invoke('map:saveAsPlaylist', data),

  onAnalysisProgress: (callback) => {
    ipcRenderer.on('analysis:progress', (event, progress) => callback(progress));
  },
  onAnalysisComplete: (callback) => {
    ipcRenderer.on('analysis:complete', (event, summary) => callback(summary));
  },
  onAnalysisError: (callback) => {
    ipcRenderer.on('analysis:error', (event, error) => callback(error));
  },

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
  },

  // "About Ludi" in the app menu
  onShowAbout: (callback) => {
    ipcRenderer.on('menu:about', () => callback());
  }
});
