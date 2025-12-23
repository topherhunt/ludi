const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { parseFile } = require('music-metadata');

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

  // Register media keys
  registerMediaKeys();
}

function registerMediaKeys() {
  // Register global shortcuts for media keys
  globalShortcut.register('MediaPlayPause', () => {
    if (mainWindow) {
      mainWindow.webContents.send('media-key', 'play-pause');
    }
  });

  globalShortcut.register('MediaNextTrack', () => {
    if (mainWindow) {
      mainWindow.webContents.send('media-key', 'next');
    }
  });

  globalShortcut.register('MediaPreviousTrack', () => {
    if (mainWindow) {
      mainWindow.webContents.send('media-key', 'previous');
    }
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
  try {
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
  } catch (error) {
    console.error('Fatal error during app startup:', error);
    console.error('Stack trace:', error.stack);
    app.quit();
  }
}).catch(error => {
  console.error('Fatal error in app.whenReady():', error);
  console.error('Stack trace:', error.stack);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// IPC handlers
ipcMain.handle('db:getLists', () => {
  return db.getLists();
});

ipcMain.handle('db:getListItems', (event, listId) => {
  return db.getListItems(listId);
});

ipcMain.handle('db:getItem', (event, itemId) => {
  return db.getItem(itemId);
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

ipcMain.handle('db:renameFolder', (event, { listId, newTitle }) => {
  return db.renameFolder(listId, newTitle);
});

ipcMain.handle('db:updateFolderExpanded', (event, { listId, isExpanded }) => {
  return db.updateFolderExpanded(listId, isExpanded);
});

ipcMain.handle('db:deleteItemWithFiles', (event, itemId) => {
  const fs = require('fs');

  // Get file paths and delete from database
  const filePaths = db.deleteItemWithFiles(itemId);

  // Delete the actual audio files
  const errors = [];
  let deletedCount = 0;
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  // TODO: Performance optimization - when deleting a large selection, we check each
  // parent folder multiple times if multiple files are from the same folder.
  // Should collect unique parent folders and check each only once.

  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted audio file:', filePath);
        deletedCount++;

        // Clean up empty parent directories
        let currentDir = path.dirname(filePath);
        console.log('Checking parent directories starting from:', currentDir);
        console.log('Library path:', libraryPath);

        while (currentDir !== libraryPath && currentDir.startsWith(libraryPath)) {
          try {
            const dirContents = fs.readdirSync(currentDir);
            console.log(`Directory ${currentDir} contains:`, dirContents);

            if (dirContents.length === 0) {
              fs.rmdirSync(currentDir);
              console.log('Deleted empty directory:', currentDir);
              currentDir = path.dirname(currentDir);
            } else {
              // Directory not empty, stop checking parents
              console.log('Directory not empty, stopping cleanup');
              break;
            }
          } catch (dirError) {
            console.warn('Could not check/delete directory:', currentDir, dirError.message);
            break;
          }
        }
      } else {
        console.warn('Audio file not found:', filePath);
        errors.push({ filePath, error: 'File not found' });
      }
    } catch (error) {
      console.error('Error deleting audio file:', filePath, error);
      errors.push({ filePath, error: error.message });
    }
  }

  return {
    totalFiles: filePaths.length,
    deletedFiles: deletedCount,
    errors: errors
  };
});

// File import IPC handler
ipcMain.handle('files:import', async (event, { filePaths, parentListId, position }) => {
  const supportedExtensions = ['.mp3', '.m4a', '.ogg'];
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  const results = {
    imported: [],
    unsupported: [],
    errors: []
  };

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const ext = path.extname(filePath).toLowerCase();

    // Check if file type is supported
    if (!supportedExtensions.includes(ext)) {
      results.unsupported.push(path.basename(filePath));
      continue;
    }

    try {
      // Extract metadata
      const metadata = await parseFile(filePath);
      const title = metadata.common.title || path.basename(filePath, ext);
      const artist = metadata.common.artist || 'Unknown';
      const album = metadata.common.album || 'Unknown';
      const durationSeconds = Math.floor(metadata.format.duration || 0);

      // Create destination directory
      const destDir = path.join(libraryPath, artist, album);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy file to library
      const fileName = path.basename(filePath);
      const destPath = path.join(destDir, fileName);

      // Get relative path from library root
      const relativePath = path.relative(libraryPath, destPath);

      // Copy file (skip if it already exists at destination)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(filePath, destPath);
      }

      let songId;
      let isNewSong = false;
      try {
        // Add song to database
        songId = db.addSong(relativePath, title, artist, album, durationSeconds);
        isNewSong = true;
      } catch (dbError) {
        // Check if this is a UNIQUE constraint error (song already exists)
        if (dbError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Get the existing song
          const existingSong = db.getSongByPath(relativePath);
          if (existingSong) {
            songId = existingSong.id;
          } else {
            throw dbError; // Re-throw if we can't find the song
          }
        } else {
          throw dbError; // Re-throw if it's not a UNIQUE constraint error
        }
      }

      // Check if the song is already in this list (prevents duplicates from concurrent imports)
      if (db.isSongInList(songId, parentListId)) {
        // Song already exists in this list, skip it
        if (!isNewSong) {
          results.errors.push({ file: path.basename(filePath), error: 'UNIQUE constraint failed: File already exists in this playlist' });
        }
        continue;
      }

      // Add song to list at the appropriate position
      db.addSongToList(songId, parentListId, position + i);

      results.imported.push({ songId, title, artist, album });
    } catch (error) {
      console.error('Error importing file:', filePath, error);
      results.errors.push({ file: path.basename(filePath), error: error.message });
    }
  }

  return results;
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
