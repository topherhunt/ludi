const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database');

let mainWindow;

function createWindow() {
  const isTest = process.env.NODE_ENV === 'test';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: !isTest, // Don't show window during tests
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize database
  db.initialize();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('db:getLists', () => {
  return db.getLists();
});

ipcMain.handle('db:getListItems', (event, listId) => {
  return db.getListItems(listId);
});

ipcMain.handle('db:getSong', (event, songId) => {
  return db.getSong(songId);
});

ipcMain.handle('db:addFolder', (event, { parentListId, position, title }) => {
  return db.addFolder(parentListId, position, title);
});

ipcMain.handle('db:addSong', (event, { filePath, title, artist, album, durationSeconds }) => {
  return db.addSong(filePath, title, artist, album, durationSeconds);
});

ipcMain.handle('db:addSongToList', (event, { songId, parentListId, position }) => {
  return db.addSongToList(songId, parentListId, position);
});

ipcMain.handle('db:moveItem', (event, { itemId, newParentListId, newPosition }) => {
  return db.moveItem(itemId, newParentListId, newPosition);
});

ipcMain.handle('db:deleteItem', (event, itemId) => {
  return db.deleteItem(itemId);
});
