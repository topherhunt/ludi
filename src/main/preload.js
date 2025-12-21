const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  getLists: () => ipcRenderer.invoke('db:getLists'),
  getListItems: (listId) => ipcRenderer.invoke('db:getListItems', listId),
  getSong: (songId) => ipcRenderer.invoke('db:getSong', songId),
  addFolder: (data) => ipcRenderer.invoke('db:addFolder', data),
  addSong: (data) => ipcRenderer.invoke('db:addSong', data),
  addSongToList: (data) => ipcRenderer.invoke('db:addSongToList', data),
  moveItem: (data) => ipcRenderer.invoke('db:moveItem', data),
  deleteItem: (itemId) => ipcRenderer.invoke('db:deleteItem', itemId),

  // File import operations
  importFiles: (data) => ipcRenderer.invoke('files:import', data),

  // Settings operations
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),
  closeSettings: () => ipcRenderer.invoke('settings:close')
});
