const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut, protocol, net, shell, clipboard, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { parseFile } = require('music-metadata');
const { audioContentType } = require('./audio-mime');
const analysis = require('./analysis');
const similarity = require('./similarity');
const clusters = require('./clusters');
const musicMap = require('./music-map');
const { recalculateAutoTags } = require('./analysis/auto-tagger');
const { BUNDLE_SCHEME_PRIVILEGES, registerBundleProtocol } = require('./bundle-protocol');
const swinsianImport = require('./swinsian-import');

let mainWindow;
let settingsWindow;

// Check if running in development mode (with Vite dev server)
const isDev = process.env.VITE_DEV === 'true';
// The launcher passes the port it started Vite on via VITE_PORT, so we never
// load a stray dev server that happens to be listening somewhere else. See
// scripts/vite-server.js for the ports and why they aren't 5173.
const devPort = process.env.VITE_PORT || '5273';

// Suppress Electron security warnings in dev mode (CSP warnings from Vite's eval usage)
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Register custom protocol for serving local audio files
// Used in both dev and prod for consistent behavior and proper Range request support (needed for seeking)
protocol.registerSchemesAsPrivileged([
  // supportFetchAPI/corsEnabled are for the analyzer window, which reads library
  // files with fetch() rather than an <audio> element. Without them Chromium
  // rejects the request before it ever reaches our handler ("Failed to fetch");
  // with them it enforces CORS, which the handler answers -- see CORS_HEADERS.
  {
    scheme: 'ludi-audio',
    privileges: { standard: true, stream: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true },
  },
  BUNDLE_SCHEME_PRIVILEGES,
]);

// The <audio> element doesn't care about CORS (media elements skip the check
// unless they carry a crossorigin attribute), but the analyzer window reads the
// same files with fetch(), which does. Its origin is http://localhost:PORT in dev
// and file:// in prod -- neither matches ludi-audio://, so without these headers
// every analysis fetch fails opaquely. Allowing * is safe: the scheme only ever
// resolves paths on this machine, and only our own windows can request it.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
};

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
      // Ludi plays for hours with its window behind everything else or the
      // display asleep. Chromium throttles timers in an occluded window, which
      // would blunt the playback watchdog exactly when it is needed most.
      backgroundThrottling: false,
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
          id: 'about',
          label: 'About Ludi',
          click: () => {
            mainWindow.webContents.send('menu:about');
          }
        },
        { type: 'separator' },
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
    // Custom protocol handler for serving local audio files (dev + prod).
    //
    // ============================================================================
    // TWO things are required for HTML5 Audio SEEKING to work over this protocol:
    // ============================================================================
    // 1. SCHEME PRIVILEGES: the scheme MUST be registered with `standard: true`
    //    (see protocol.registerSchemesAsPrivileged near the top of this file).
    //    Without it, Chromium's media stack treats ludi-audio:// as a non-standard
    //    stream: it caps the forward buffer (~3MB here) and then FAILS to fetch
    //    beyond it on seek -- the audio element fires MEDIA_ERR_NETWORK (code 2)
    //    and freezes. Symptom: seek toward the end of a long song -> "Error loading
    //    audio: 2" and playback stops (and, depending on bitrate, the song appears
    //    truncated, e.g. only the first ~43s of a 192kbps track plays).
    //    `standard: true` makes Chromium treat it like http and seek properly.
    //
    // 2. RANGE REQUESTS: HTML5 Audio seeks by sending "Range: bytes=START-" and
    //    expects a 206 Partial Content response with a Content-Range header. We
    //    parse the range and stream exactly those bytes. A naive full-file 200 for
    //    every request makes the seek bar move while audio plays the wrong spot.
    //
    // Note: the initial request is the open-ended "bytes=0-" -- we answer it with a
    // 206 spanning the whole file, which is correct. Chromium estimates duration
    // from the bytes it actually receives, so we must NOT cap/truncate responses --
    // doing so corrupts the reported duration (a capped 1MB chunk made a 2:33 song
    // report as 0:32). (Both behaviors are covered by tests/e2e/seek-near-end.spec.js.)
    protocol.handle('ludi-audio', async (request) => {
      // With `standard: true`, the URL parses as ludi-audio://<authority>/<path>.
      // Our URLs are ludi-audio:///abs/path (empty authority), so strip the scheme
      // and ensure a leading slash. Drop any "?_=N" cache-buster before touching disk.
      const withoutScheme = request.url.replace(/^ludi-audio:\/\//, '').split('?')[0];
      const filePath = decodeURIComponent(withoutScheme.startsWith('/') ? withoutScheme : '/' + withoutScheme);
      const contentType = audioContentType(filePath);
      const toWeb = require('stream').Readable.toWeb;

      let fileSize;
      try {
        fileSize = (await fs.promises.stat(filePath)).size;
      } catch (err) {
        console.error('ludi-audio: file not found:', filePath, err.message);
        return new Response(null, { status: 404, headers: CORS_HEADERS });
      }

      // Range request (seeking, and the initial open-ended bytes=0-): 206 partial.
      const rangeHeader = request.headers.get('Range');
      const match = rangeHeader && rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        // Guard a range starting past EOF (e.g. stored duration slightly long).
        if (start >= fileSize) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}`, ...CORS_HEADERS },
          });
        }
        const clampedEnd = Math.min(end, fileSize - 1);
        return new Response(toWeb(fs.createReadStream(filePath, { start, end: clampedEnd })), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(clampedEnd - start + 1),
            'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            ...CORS_HEADERS,
          },
        });
      }

      // No Range header: stream the whole file.
      return new Response(toWeb(fs.createReadStream(filePath)), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          ...CORS_HEADERS,
        },
      });
    });

    // Lets the analyzer window fetch models and wasm in packaged builds.
    registerBundleProtocol();

    // Initialize database
    db.initialize();

    // Create menu
    createMenu();

    createWindow();

    // After createWindow so a pass resumed from a previous session has a window
    // to report progress to.
    analysis.initAnalysis({ isDev, devPort });

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

// The root list a (possibly nested) list belongs to -- i.e. which sidebar
// playlist a folder lives in.
ipcMain.handle('db:getRootListId', (event, listId) => {
  return db.getRootListId(listId);
});

// ---- Playlists ----
// Note: playlist rename goes through db:renameFolder -- it's the same UPDATE.
ipcMain.handle('db:createPlaylist', (event, title) => {
  return db.createPlaylist(title);
});

ipcMain.handle('db:deletePlaylist', (event, listId) => {
  return db.deletePlaylist(listId);
});

ipcMain.handle('db:reorderPlaylists', (event, orderedIds) => {
  return db.reorderPlaylists(orderedIds);
});

ipcMain.handle('db:removeItemsFromList', (event, itemIds) => {
  return db.removeItemsFromList(itemIds);
});

ipcMain.handle('db:previewCopyToList', (event, { itemIds, targetListId }) => {
  return db.previewCopyToList(itemIds, targetListId);
});

ipcMain.handle('db:copyItemsToList', (event, { itemIds, targetListId, skipSongIds }) => {
  return db.copyItemsToList(itemIds, targetListId, skipSongIds);
});

// ---- Saved searches ----
ipcMain.handle('db:getSavedSearches', () => {
  return db.getSavedSearches();
});

ipcMain.handle('db:createSavedSearch', (event, { name, query }) => {
  return db.createSavedSearch(name, query);
});

ipcMain.handle('db:renameSavedSearch', (event, { id, newName }) => {
  return db.renameSavedSearch(id, newName);
});

ipcMain.handle('db:deleteSavedSearch', (event, id) => {
  return db.deleteSavedSearch(id);
});

// ---- Tags ----
ipcMain.handle('db:getAllTags', () => {
  return db.getAllTags();
});

ipcMain.handle('db:createTag', (event, { name, color }) => {
  return db.createTag(name, color);
});

ipcMain.handle('db:renameTag', (event, { tagId, newName }) => {
  return db.renameTag(tagId, newName);
});

ipcMain.handle('db:setTagColor', (event, { tagId, color }) => {
  return db.setTagColor(tagId, color);
});

ipcMain.handle('db:deleteTag', (event, tagId) => {
  return db.deleteTag(tagId);
});

ipcMain.handle('db:reorderTags', (event, orderedIds) => {
  return db.reorderTags(orderedIds);
});

ipcMain.handle('db:addTagToSongs', (event, { tagId, songIds }) => {
  return db.addTagToSongs(tagId, songIds);
});

ipcMain.handle('db:removeTagFromSongs', (event, { tagId, songIds }) => {
  return db.removeTagFromSongs(tagId, songIds);
});

ipcMain.handle('db:updateSong', (event, { songId, fields }) => {
  return db.updateSong(songId, fields);
});

ipcMain.handle('db:setSongRating', (event, { songIds, rating }) => {
  return db.setSongRating(songIds, rating);
});

ipcMain.handle('db:recordSongPlay', (event, songId) => {
  return db.recordSongPlay(songId);
});

// ---- Star-rating import from a Swinsian library --------------------------

ipcMain.handle('ratings:chooseSwinsianLibrary', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Select Swinsian Library',
    message: 'Choose the Swinsian library file to read star ratings from.',
    filters: [{ name: 'Swinsian library', extensions: ['sqlite', 'db', 'swinsianlibrary'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Read-only: reports what the import would change so the user approves counts
// rather than a black box.
ipcMain.handle('ratings:previewSwinsian', (event, swinsianDbPath) => {
  return swinsianImport.previewImport(swinsianDbPath, db.getSongsForRatingMatch());
});

ipcMain.handle('ratings:applySwinsian', (event, swinsianDbPath) => {
  const { writes, songsRated } = swinsianImport.resolveImport(swinsianDbPath, db.getSongsForRatingMatch());
  for (const { rating, songIds } of writes) {
    db.setSongRating(songIds, rating);
  }

  // The import runs from the Settings window, so the main window has to be told
  // its stars just changed.
  if (songsRated > 0 && mainWindow) {
    mainWindow.webContents.send('library-changed');
  }
  return { songsRated };
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
 * Import a single audio file and add to a list.
 * `itemId` is the list_items row the song now sits in -- for an already-imported
 * song that's its existing Main Library placement, which lets a playlist drop
 * reference it without creating a second library placement.
 * @returns {{ songId, itemId, title, artist, album } | { skipped, songId, itemId, file, error }}
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

  // Every song lives in the Main Library exactly once. If it's already there,
  // hand back the existing placement rather than creating a second one.
  if (!isNewSong && db.isSongInMainLibrary(songId)) {
    return {
      skipped: true,
      songId,
      itemId: db.findSongPlacementInMainLibrary(songId),
      file: path.basename(filePath),
      error: 'Song already exists in library',
    };
  }

  // Add song to list at the appropriate position
  const itemId = db.addSongToList(songId, parentListId, position);

  return { songId, itemId, title, artist, album };
}

/**
 * Recursively import a folder tree structure, creating folders and importing audio
 * @returns {{ imported: Array, errors: Array, folderId: number | null }}
 */
async function importFolderTree(folderTree, parentListId, startPosition, libraryPath) {
  const results = {
    imported: [],
    errors: [],
    folderId: null,
    folderItemId: null
  };

  // Create the folder in the database
  const folderId = db.addFolder(parentListId, startPosition, folderTree.name);
  results.folderId = folderId;
  results.folderItemId = db.getFolderPlacementItemId(folderId);

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

  // Every song must land in the Main Library. A drop onto a playlist (or a
  // folder inside one) therefore imports into the Main Library and hands back
  // the resulting item ids, so the renderer can copy them into the playlist via
  // the same path an in-app drag takes -- duplicates dialog included.
  const targetIsPlaylist = db.getRootListId(parentListId) !== db.MAIN_LIBRARY_ID;
  const importParentListId = targetIsPlaylist ? db.MAIN_LIBRARY_ID : parentListId;
  const importPosition = targetIsPlaylist
    ? db.getListItems(db.MAIN_LIBRARY_ID).length
    : position;

  const results = {
    imported: [],
    unsupported: [],
    errors: [],
    targetIsPlaylist,
    itemIds: []  // top-level Main Library items this import created or reused
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
        const folderResults = await importFolderTree(folderTree, importParentListId, importPosition + i, libraryPath);
        results.imported.push(...folderResults.imported);
        results.errors.push(...folderResults.errors);
        if (folderResults.folderItemId !== null) results.itemIds.push(folderResults.folderItemId);
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
        const result = await importSingleFile(filePath, importParentListId, importPosition + i, libraryPath);
        if (result.itemId) results.itemIds.push(result.itemId);
        if (result.skipped) {
          // Already in the library. That's an error for a library drop, but not
          // for a playlist drop -- there the song still gets added below.
          if (!targetIsPlaylist) results.errors.push({ file: result.file, error: result.error });
        } else {
          results.imported.push(result);
        }
      } catch (error) {
        console.error('Error importing file:', filePath, error);
        results.errors.push({ file: path.basename(filePath), error: error.message });
      }
    }
  }

  analysis.analyzeNewSongs(results.imported.map(song => song.songId));
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

  // Append each group as a new folder at the end of the Main Library.
  let folderPosition = db.getListItems(db.MAIN_LIBRARY_ID).length;
  for (const [folderTitle, songs] of groups) {
    const folderId = db.addFolder(db.MAIN_LIBRARY_ID, folderPosition, folderTitle);
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
          songId,
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

  analysis.analyzeNewSongs(results.imported.map(song => song.songId));
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

// Open a URL in the user's browser. Renderer links must route through here --
// following an href in the window itself would navigate the app away.
ipcMain.handle('shell:openExternal', (event, url) => {
  if (!url.startsWith('https://')) throw new Error(`Refusing to open non-https URL: ${url}`);
  return shell.openExternal(url);
});

ipcMain.handle('shell:showInFinder', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// Which audio files a selection of tree items resolves to. Exposed on its own
// (rather than only inside the drag handler below) so the resolution -- folder
// recursion, dedupe, order -- is testable without starting a real drag session.
ipcMain.handle('db:getSongFilePathsForItems', (event, itemIds) => {
  return db.getSongFilePathsForItems(itemIds);
});

// Hand the selection to the OS as a native file drag, so dropping on the Desktop
// or a Finder folder copies the audio files there.
//
// This must be `send`, not `invoke`: startDrag only works while the mouse is
// still down, so the renderer calls it synchronously from `dragstart` and cannot
// await anything first. Resolving the paths here (better-sqlite3 is synchronous)
// keeps the whole round trip inside that window.
ipcMain.on('drag:startForItems', (event, itemIds) => {
  const filePaths = db.getSongFilePathsForItems(itemIds).filter((p) => fs.existsSync(p));
  if (filePaths.length === 0) return;

  // startDrag rejects an empty icon, and the drag image is what the user sees
  // following the cursor. NSImageNameMultipleDocuments is available synchronously;
  // app.getFileIcon is not, and awaiting it would outlive the drag gesture.
  const icon = process.platform === 'darwin'
    ? nativeImage.createFromNamedImage('NSImageNameMultipleDocuments', [0, 0, 1])
    : nativeImage.createEmpty();

  event.sender.startDrag({ files: filePaths, icon });
});

ipcMain.handle('clipboard:writeText', (event, text) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle('fs:fileExists', (event, filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
});

// While a song is playing, keep macOS from suspending the app under an
// unattended playlist. 'prevent-app-suspension' still lets the display sleep --
// it only keeps the system, and us, running.
let powerBlockerId = null;

ipcMain.handle('power:setPlaybackActive', (event, active) => {
  if (active && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!active && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  // The same signal tells the analyzer to back off to one worker, so a
  // background analysis pass never makes playback stutter.
  analysis.setPlaybackActive(active);
  return powerBlockerId !== null;
});

ipcMain.handle('power:isPlaybackActive', () => (
  powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)
));

// ---- Audio analysis ------------------------------------------------------

ipcMain.handle('analysis:start', () => analysis.analyzeLibrary());
ipcMain.handle('analysis:stop', () => analysis.stopAnalysis());
ipcMain.handle('analysis:getProgress', () => analysis.getAnalysisProgress());
ipcMain.handle('analysis:getFailed', () => db.getFailedAnalyses());

ipcMain.handle('analysis:retryFailed', () => {
  db.retryFailedAnalysis();
  return analysis.resumeAnalysis();
});

ipcMain.handle('analysis:recalculateTags', () => recalculateAutoTags());

ipcMain.handle('analysis:clearAutoTags', () => {
  db.clearAutoTags();
  return true;
});

ipcMain.handle('analysis:getSongAnalysis', (event, songId) => db.getAnalysis(songId));

// ---- Similarity ----------------------------------------------------------

ipcMain.handle('similarity:find', (event, seedSongIds, options) => (
  similarity.findSimilar(seedSongIds, options)
));

// ---- Clusters ------------------------------------------------------------

ipcMain.handle('clusters:recalculate', () => clusters.recalculateClusters());
ipcMain.handle('clusters:list', () => db.getClusters());
ipcMain.handle('clusters:songs', (event, clusterId) => clusters.getClusterSongs(clusterId));
ipcMain.handle('clusters:rename', (event, { clusterId, newName }) => db.renameCluster(clusterId, newName));

ipcMain.handle('clusters:saveAsPlaylist', (event, { clusterId, title }) => (
  clusters.saveClusterAsPlaylist(clusterId, title)
));

// ---- Music map -----------------------------------------------------------

ipcMain.handle('map:recalculate', () => musicMap.recalculateMap());
ipcMain.handle('map:points', () => musicMap.getMapPoints());

ipcMain.handle('map:saveAsPlaylist', (event, { songIds, title }) => (
  musicMap.saveSelectionAsPlaylist(songIds, title)
));
