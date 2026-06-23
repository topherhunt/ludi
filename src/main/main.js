const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { parseFile } = require('music-metadata');
const { audioContentType } = require('./audio-mime');

let mainWindow;
let settingsWindow;

// Check if running in development mode (with Vite dev server)
const isDev = process.env.VITE_DEV === 'true';
// Vite picks the next free port if 5173 is taken; the launcher passes the actual
// port via VITE_PORT so we never load a stray server squatting on 5173.
const devPort = process.env.VITE_PORT || '5173';

// Suppress Electron security warnings in dev mode (CSP warnings from Vite's eval usage)
if (isDev) {
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
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load from Vite dev server in development mode, otherwise load static file
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${devPort}/index.html`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  // Open DevTools in development (but not during tests, as it interferes with Playwright)
  if ((process.argv.includes('--enable-logging') || isDev) && !isTest) {
    mainWindow.webContents.openDevTools();
  }

  // On macOS the window's X should hide the window (so playback keeps running in
  // the background) instead of destroying it. The dock icon re-shows it via the
  // 'activate' handler. A real quit (Cmd+Q) sets app.isQuitting in 'before-quit'
  // so the window is allowed to actually close.
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

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
    width: 900,
    height: 500,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    },
    parent: mainWindow,
    modal: false
  });

  // Load from Vite dev server in development mode, otherwise load static file
  if (isDev) {
    settingsWindow.loadURL(`http://localhost:${devPort}/settings.html`);
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../../dist/renderer/settings.html'));
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
      // Strip any cache-busting query string (e.g. "?_=123") before touching disk.
      // The renderer appends one per load so Chromium treats each playback as a
      // distinct request rather than reusing/aborting an identical in-flight URL.
      const withoutScheme = request.url.replace('ludi-audio://', '').split('?')[0];
      const filePath = decodeURIComponent(withoutScheme);
      const contentType = audioContentType(filePath);

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
              'Content-Type': contentType,
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
          'Content-Type': contentType,
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
      // Re-show the hidden window (or recreate it if it was actually destroyed).
      if (mainWindow) {
        mainWindow.show();
      } else {
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

// Mark a genuine quit so the window's 'close' handler stops hiding and lets it close.
app.on('before-quit', () => {
  app.isQuitting = true;
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

ipcMain.handle('db:getAllListItems', () => {
  return db.getAllListItems();
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

ipcMain.handle('db:sortFolderContents', (event, { listId, sortBy }) => {
  return db.sortFolderContents(listId, sortBy);
});

ipcMain.handle('db:flattenFolder', (event, listId) => {
  return db.flattenFolder(listId);
});

ipcMain.handle('db:deleteItemWithFiles', async (event, itemId) => {
  // Remove from the database first, then move the now-orphaned audio files to
  // the OS Trash (recoverable, unlike a permanent delete).
  const filePaths = db.deleteItemWithFiles(itemId);

  const errors = [];
  let trashedCount = 0;
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  // TODO: Performance optimization - when deleting a large selection, we check each
  // parent folder multiple times if multiple files are from the same folder.
  // Should collect unique parent folders and check each only once.

  for (const filePath of filePaths) {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn('Audio file not found:', filePath);
        errors.push({ filePath, error: 'File not found' });
        continue;
      }

      await shell.trashItem(filePath);
      console.log('Moved audio file to Trash:', filePath);
      trashedCount++;

      // Clean up now-empty parent directories up to the library root.
      let currentDir = path.dirname(filePath);
      while (currentDir !== libraryPath && currentDir.startsWith(libraryPath)) {
        try {
          if (fs.readdirSync(currentDir).length === 0) {
            fs.rmdirSync(currentDir);
            currentDir = path.dirname(currentDir);
          } else {
            break;
          }
        } catch (dirError) {
          console.warn('Could not check/delete directory:', currentDir, dirError.message);
          break;
        }
      }
    } catch (error) {
      console.error('Error trashing audio file:', filePath, error);
      errors.push({ filePath, error: error.message });
    }
  }

  return {
    totalFiles: filePaths.length,
    deletedFiles: trashedCount,
    errors: errors
  };
});

// Supported audio extensions for import
const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.ogg'];

/**
 * Check if a file extension is a supported audio format
 * @param {string} filePath
 * @returns {boolean}
 */
function isSupportedAudio(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Recursively scan a folder for audio files, returning a tree structure
 * @param {string} folderPath - Absolute path to the folder
 * @returns {{ name: string, files: string[], subfolders: object[], unsupported: string[] }}
 */
function scanFolderForAudio(folderPath) {
  const result = {
    name: path.basename(folderPath),
    files: [],
    subfolders: [],
    unsupported: []
  };

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  // Sort alphabetically
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      const subfolder = scanFolderForAudio(entryPath);
      // Only include subfolders that have audio content (files or subfolders with content)
      if (subfolder.files.length > 0 || subfolder.subfolders.length > 0) {
        result.subfolders.push(subfolder);
        // Bubble up unsupported files
        result.unsupported.push(...subfolder.unsupported);
      } else if (subfolder.unsupported.length > 0) {
        // Folder only had unsupported files
        result.unsupported.push(...subfolder.unsupported);
      }
    } else if (entry.isFile()) {
      if (isSupportedAudio(entryPath)) {
        result.files.push(entryPath);
      } else {
        // Track unsupported files (skip hidden files like .DS_Store)
        if (!entry.name.startsWith('.')) {
          result.unsupported.push(entryPath);
        }
      }
    }
  }

  return result;
}

/**
 * Recursively collect absolute paths of all supported audio files under a folder.
 * Flat list (no tree); skips unsupported/hidden files via isSupportedAudio.
 * @param {string} folderPath - Absolute path to the folder
 * @returns {string[]} Absolute file paths
 */
function walkAudioFiles(folderPath) {
  const found = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkAudioFiles(entryPath));
    } else if (entry.isFile() && isSupportedAudio(entryPath)) {
      found.push(entryPath);
    }
  }

  return found;
}

/**
 * Import a single audio file and add to a list
 * @returns {{ songId, title, artist, album } | null}
 */
async function importSingleFile(filePath, parentListId, position, libraryPath) {
  const ext = path.extname(filePath).toLowerCase();

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
        throw dbError;
      }
    } else {
      throw dbError;
    }
  }

  // For Main Library (and its subfolders), don't allow duplicate songs anywhere
  if (!isNewSong && db.isSongInLibrary(songId)) {
    return { skipped: true, file: path.basename(filePath), error: 'Song already exists in library' };
  }

  // Add song to list at the appropriate position
  db.addSongToList(songId, parentListId, position);

  return { songId, title, artist, album };
}

/**
 * Recursively import a folder tree structure, creating folders and importing audio
 * @returns {{ imported: Array, errors: Array, folderId: number | null }}
 */
async function importFolderTree(folderTree, parentListId, startPosition, libraryPath) {
  const results = {
    imported: [],
    errors: [],
    folderId: null
  };

  // Create the folder in the database
  const folderId = db.addFolder(parentListId, startPosition, folderTree.name);
  results.folderId = folderId;

  let currentPosition = 0;

  // Import files in this folder (already sorted alphabetically)
  for (const filePath of folderTree.files) {
    try {
      const result = await importSingleFile(filePath, folderId, currentPosition, libraryPath);
      if (result.skipped) {
        results.errors.push({ file: result.file, error: result.error });
      } else {
        results.imported.push(result);
      }
      currentPosition++;
    } catch (error) {
      console.error('Error importing file:', filePath, error);
      results.errors.push({ file: path.basename(filePath), error: error.message });
      currentPosition++;
    }
  }

  // Recursively import subfolders
  for (const subfolder of folderTree.subfolders) {
    const subResults = await importFolderTree(subfolder, folderId, currentPosition, libraryPath);
    results.imported.push(...subResults.imported);
    results.errors.push(...subResults.errors);
    currentPosition++;
  }

  return results;
}

// File import IPC handler
ipcMain.handle('files:import', async (event, { filePaths, parentListId, position }) => {
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  const results = {
    imported: [],
    unsupported: [],
    errors: []
  };

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];

    // Check if this is a directory
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      // Scan the folder for audio files
      const folderTree = scanFolderForAudio(filePath);

      // Collect unsupported files
      results.unsupported.push(...folderTree.unsupported.map(p => path.basename(p)));

      // Skip if no audio content
      if (folderTree.files.length === 0 && folderTree.subfolders.length === 0) {
        continue;
      }

      // Import the folder tree
      try {
        const folderResults = await importFolderTree(folderTree, parentListId, position + i, libraryPath);
        results.imported.push(...folderResults.imported);
        results.errors.push(...folderResults.errors);
      } catch (error) {
        console.error('Error importing folder:', filePath, error);
        results.errors.push({ file: path.basename(filePath), error: error.message });
      }
    } else {
      // It's a file
      if (!isSupportedAudio(filePath)) {
        results.unsupported.push(path.basename(filePath));
        continue;
      }

      try {
        const result = await importSingleFile(filePath, parentListId, position + i, libraryPath);
        if (result.skipped) {
          results.errors.push({ file: result.file, error: result.error });
        } else {
          results.imported.push(result);
        }
      } catch (error) {
        console.error('Error importing file:', filePath, error);
        results.errors.push({ file: path.basename(filePath), error: error.message });
      }
    }
  }

  return results;
});

// Scan the library folder for audio files that aren't yet in the database.
// Returns library-relative paths (sorted) so the renderer can list them.
ipcMain.handle('library:scanMissing', () => {
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  const ingested = new Set(db.getAllSongFilePaths());

  const missing = walkAudioFiles(libraryPath)
    .map(absPath => path.relative(libraryPath, absPath))
    .filter(relativePath => !ingested.has(relativePath));

  missing.sort((a, b) => a.localeCompare(b));
  return missing;
});

// Ingest already-in-library files (given as library-relative paths) WITHOUT
// copying or moving them. Songs are grouped into freshly created
// "{artist} - {album}" folders appended to the Main Library.
ipcMain.handle('library:ingestMissing', async (event, relativePaths) => {
  const settings = db.getSettings();
  const libraryPath = settings.library_path;

  const results = { imported: [], errors: [] };

  // Read metadata first so we can group by artist/album before touching the DB.
  const parsed = [];
  for (const relativePath of relativePaths) {
    try {
      const absPath = path.join(libraryPath, relativePath);
      const metadata = await parseFile(absPath);
      const ext = path.extname(relativePath);
      parsed.push({
        relativePath,
        title: metadata.common.title || path.basename(relativePath, ext),
        artist: metadata.common.artist || 'Unknown',
        album: metadata.common.album || 'Unknown',
        durationSeconds: Math.floor(metadata.format.duration || 0),
        trackNumber: metadata.common.track?.no || null,
      });
    } catch (error) {
      console.error('Error reading metadata for:', relativePath, error);
      results.errors.push({ file: path.basename(relativePath), error: error.message });
    }
  }

  // Group by "{artist} - {album}", preserving first-seen (alphabetical) order.
  const groups = new Map();
  for (const song of parsed) {
    const key = `${song.artist} - ${song.album}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(song);
  }

  // Append each group as a new folder at the end of the Main Library (list 0).
  let folderPosition = db.getListItems(0).length;
  for (const [folderTitle, songs] of groups) {
    const folderId = db.addFolder(0, folderPosition, folderTitle);
    folderPosition++;

    let songPosition = 0;
    for (const song of songs) {
      try {
        const songId = db.addSong(
          song.relativePath, song.title, song.artist, song.album,
          song.durationSeconds, song.trackNumber
        );
        db.addSongToList(songId, folderId, songPosition);
        songPosition++;
        results.imported.push({
          title: song.title,
          artist: song.artist,
          album: song.album,
          file_path: song.relativePath,
        });
      } catch (error) {
        // A UNIQUE violation means it was ingested between scan and import.
        console.error('Error ingesting file:', song.relativePath, error);
        results.errors.push({ file: path.basename(song.relativePath), error: error.message });
      }
    }
  }

  // Tell the main window to refresh its tree so the new songs appear.
  if (results.imported.length > 0 && mainWindow) {
    mainWindow.webContents.send('library-changed');
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

ipcMain.handle('clipboard:writeText', (event, text) => {
  clipboard.writeText(String(text));
  return true;
});
