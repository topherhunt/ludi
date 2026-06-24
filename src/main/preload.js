const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
  deleteItemWithFiles: (itemId) => ipcRenderer.invoke('db:deleteItemWithFiles', itemId),

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
