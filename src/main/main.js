const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const db = require('./database');

let mainWindow;
let settingsWindow;

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

function createSettingsWindow() {
  // Don't create multiple settings windows
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    minWidth: 500,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    parent: mainWindow,
    modal: false
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: 'Ludi',
      submenu: [
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Initialize database
  db.initialize();

  // Create menu
  createMenu();

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

// Settings IPC handlers
ipcMain.handle('settings:get', () => {
  return db.getSettings();
});

ipcMain.handle('settings:save', (event, settings) => {
  if (settings.library_path) {
    db.updateSetting('library_path', settings.library_path);
  }
  return true;
});

ipcMain.handle('settings:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Library Path'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('settings:close', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});
