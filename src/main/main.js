const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { parseFile } = require('music-metadata');

let mainWindow;
let settingsWindow;

// Check if running in SolidJS development mode
const isSolidDev = process.env.SOLID_DEV === 'true';

// Suppress Electron security warnings in dev mode (CSP warnings from Vite's eval usage)
if (isSolidDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Register custom protocol for serving local audio files
// Used in both dev and prod for consistent behavior and proper Range request support (needed for seeking)
protocol.registerSchemesAsPrivileged([
  { scheme: 'ludi-audio', privileges: { stream: true, bypassCSP: true } }
]);

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

  // Load from Vite dev server in Solid development mode, otherwise load static file
  if (isSolidDev) {
    mainWindow.loadURL('http://localhost:5173/solid.html');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development (but not during tests, as it interferes with Playwright)
  if ((process.argv.includes('--enable-logging') || isSolidDev) && !isTest) {
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

  // Load from Vite dev server in Solid development mode, otherwise load static file
  if (isSolidDev) {
    settingsWindow.loadURL('http://localhost:5173/settings.solid.html');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  }

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
    // Register custom protocol handler for local audio files
    // Used in both dev and prod for consistent behavior
    //
    // ============================================================================
    // CRITICAL: RANGE REQUEST HANDLING IS REQUIRED FOR AUDIO SEEKING
    // ============================================================================
    // When HTML5 Audio elements seek to a position, they send HTTP Range requests
    // (e.g., "Range: bytes=1000000-") expecting a 206 Partial Content response.
    //
    // A naive implementation like `return net.fetch('file://' + filePath)` will
    // NOT handle Range requests - it returns the entire file with 200 OK.
    // This causes a subtle but severe bug:
    //   - The seek bar UI updates correctly (shows the target position)
    //   - But the actual audio plays from the WRONG position (often much earlier)
    //   - The mismatch worsens with longer files (3+ minutes)
    //
    // The fix: Manually parse Range headers and return proper 206 responses with
    // Content-Range headers. This is how real HTTP servers serve streamable media.
    //
    // DO NOT simplify this to just `net.fetch()` - it will break seeking!
    // ============================================================================
    protocol.handle('ludi-audio', async (request) => {
      const filePath = decodeURIComponent(request.url.replace('ludi-audio://', ''));

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Check for Range header - this is how HTML5 Audio implements seeking
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        // Parse range header: "bytes=start-end" or "bytes=start-"
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          // Read the requested portion of the file
          const buffer = Buffer.alloc(chunkSize);
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buffer, 0, chunkSize, start);
          fs.closeSync(fd);

          // Return 206 Partial Content with proper headers
          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      // No range header - return full file with Accept-Ranges header
      const buffer = fs.readFileSync(filePath);
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    });

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

ipcMain.handle('db:addSong', (event, { filePath, title, artist, album, durationSeconds, trackNumber }) => {
  return db.addSong(filePath, title, artist, album, durationSeconds, trackNumber);
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
      const trackNumber = metadata.common.track?.no || null;

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
        songId = db.addSong(relativePath, title, artist, album, durationSeconds, trackNumber);
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

      // For Main Library (and its subfolders), don't allow duplicate songs anywhere
      // Later when playlists are added (id > 0, non-subfolder), they will allow duplicates
      if (!isNewSong && db.isSongInLibrary(songId)) {
        results.errors.push({ file: path.basename(filePath), error: 'Song already exists in library' });
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

ipcMain.handle('settings:columnsChanged', (event, settings) => {
  if (mainWindow) {
    mainWindow.webContents.send('column-settings-changed', settings);
  }
});

ipcMain.handle('shell:showInFinder', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});
