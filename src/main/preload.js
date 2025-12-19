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
  deleteItem: (itemId) => ipcRenderer.invoke('db:deleteItem', itemId)
});
