const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_DIR = path.join(os.homedir(), '.ludi');

// Electron's app is used only to detect a packaged ("live") build. Guarded so
// this module can still be required outside Electron (e.g. unit tests).
let electronApp = null;
try {
  electronApp = require('electron').app;
} catch (e) {
  electronApp = null;
}

// The app runs in exactly one of three modes. Each gets its own database file
// AND its own music-library folder so dev, test, and live never collide.
function getMode() {
  if (process.env.NODE_ENV === 'test') return 'test';
  if (electronApp && electronApp.isPackaged) return 'live';
  return 'dev';
}

// Music-library folder name per mode. "live" is the user's real library.
const LIBRARY_FOLDER = {
  test: 'Ludi Library Test',
  dev: 'Ludi Library Dev',
  live: 'Ludi Library',
};

// Determine database filename based on mode.
// Can be overridden with LUDI_DB_PATH environment variable.
function getDbPath() {
  if (process.env.LUDI_DB_PATH) {
    return process.env.LUDI_DB_PATH;
  }
  return path.join(DB_DIR, `ludi-library-${getMode()}.sqlite`);
}

let db;

function initialize() {
  // Determine DB path now (after env vars are set)
  const dbPath = getDbPath();

  // Create directory if it doesn't exist
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Open database
  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  createTables();

  // Create default "Main Library" list if it doesn't exist
  const mainLibrary = db.prepare('SELECT * FROM lists WHERE id = 0').get();
  if (!mainLibrary) {
    db.prepare(`
      INSERT INTO lists (id, title, is_subfolder, sidebar_position, inserted_at, updated_at)
      VALUES (0, 'Main Library', 0, 0, datetime('now'), datetime('now'))
    `).run();
  }

  // Initialize default settings
  initializeDefaultSettings();
}

function initializeDefaultSettings() {
  const defaultLibraryPath = path.join(os.homedir(), 'Music', LIBRARY_FOLDER[getMode()]);

  const libraryPath = db.prepare('SELECT * FROM settings WHERE key = ?').get('library_path');
  if (!libraryPath) {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('library_path', ?, datetime('now'))
    `).run(defaultLibraryPath);
  }

  // Create library directory if it doesn't exist
  const currentLibraryPath = libraryPath ? libraryPath.value : defaultLibraryPath;
  if (!fs.existsSync(currentLibraryPath)) {
    fs.mkdirSync(currentLibraryPath, { recursive: true });
  }
}

function createTables() {
  // Lists table
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      is_subfolder INTEGER NOT NULL,
      sidebar_position INTEGER,
      is_expanded INTEGER DEFAULT 0,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // List items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_list_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      list_id INTEGER,
      song_id INTEGER,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_list_id) REFERENCES lists(id),
      FOREIGN KEY (list_id) REFERENCES lists(id),
      FOREIGN KEY (song_id) REFERENCES songs(id),
      CHECK ((list_id IS NULL) != (song_id IS NULL))
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items(list_id);
    CREATE INDEX IF NOT EXISTS idx_list_items_song_id ON list_items(song_id);
    CREATE INDEX IF NOT EXISTS idx_list_items_parent_position ON list_items(parent_list_id, position);
  `);

  // Songs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      file_path TEXT NOT NULL UNIQUE,
      duration_seconds INTEGER NOT NULL,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Tags table -- free-form, label-style tags (name + color). `position` gives a
  // manual drag-to-reorder sort order used wherever tags are listed. Name is
  // unique case-insensitively.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      position INTEGER NOT NULL,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Song<->tag associations (many-to-many). No ON DELETE CASCADE: per the
  // project convention, deletion cleanup is handled in JS app logic (see
  // deleteTag and deleteItemWithFiles).
  db.exec(`
    CREATE TABLE IF NOT EXISTS song_tags (
      song_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      inserted_at TEXT NOT NULL,
      PRIMARY KEY (song_id, tag_id),
      FOREIGN KEY (song_id) REFERENCES songs(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_song_tags_tag_id ON song_tags(tag_id);
  `);

  // Migrations - Add is_expanded column if it doesn't exist
  const columns = db.prepare("PRAGMA table_info(lists)").all();
  const hasExpandedColumn = columns.some(col => col.name === 'is_expanded');
  if (!hasExpandedColumn) {
    db.exec(`ALTER TABLE lists ADD COLUMN is_expanded INTEGER DEFAULT 0`);
  }

  // Migration - Add track_number column to songs table if it doesn't exist
  const songColumns = db.prepare("PRAGMA table_info(songs)").all();
  const hasTrackNumber = songColumns.some(col => col.name === 'track_number');
  if (!hasTrackNumber) {
    db.exec(`ALTER TABLE songs ADD COLUMN track_number INTEGER`);
  }

  // Drop the unique index if it was previously created (we want to allow duplicates for playlists)
  db.exec(`DROP INDEX IF EXISTS idx_list_items_unique_song_in_list`);
}

function getLists() {
  return db.prepare('SELECT * FROM lists WHERE is_subfolder = 0 ORDER BY sidebar_position').all();
}

// Parse each row's `tags` JSON column (from json_group_array) into an array of
// {id, name, color, position} sorted by position. Mutates rows in place.
function parseTagsColumn(rows) {
  for (const row of rows) {
    const parsed = row.tags ? JSON.parse(row.tags) : [];
    parsed.sort((a, b) => a.position - b.position);
    row.tags = parsed;
  }
  return rows;
}

function getListItems(listId) {
  return parseTagsColumn(db.prepare(`
    SELECT
      li.*,
      l.title as list_title,
      l.is_expanded as list_is_expanded,
      s.title as song_title,
      s.artist,
      s.album,
      s.duration_seconds,
      s.track_number,
      (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'position', t.position))
         FROM song_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id = s.id) as tags
    FROM list_items li
    LEFT JOIN lists l ON li.list_id = l.id
    LEFT JOIN songs s ON li.song_id = s.id
    WHERE li.parent_list_id = ?
    ORDER BY li.position
  `).all(listId));
}

function getAllListItems() {
  return parseTagsColumn(db.prepare(`
    SELECT
      li.*,
      l.title as list_title,
      l.is_expanded as list_is_expanded,
      s.title as song_title,
      s.artist,
      s.album,
      s.duration_seconds,
      s.track_number,
      (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'position', t.position))
         FROM song_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id = s.id) as tags
    FROM list_items li
    LEFT JOIN lists l ON li.list_id = l.id
    LEFT JOIN songs s ON li.song_id = s.id
    ORDER BY li.parent_list_id, li.position
  `).all());
}

function getItem(itemId) {
  return db.prepare(`
    SELECT
      li.*,
      l.title as list_title,
      s.title as song_title,
      s.artist,
      s.album,
      s.duration_seconds,
      s.track_number
    FROM list_items li
    LEFT JOIN lists l ON li.list_id = l.id
    LEFT JOIN songs s ON li.song_id = s.id
    WHERE li.id = ?
  `).get(itemId);
}

function getSong(songId) {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId);
  if (song) {
    // Get library path from settings
    const settings = getSettings();
    // Convert relative path to absolute path
    song.file_path = path.join(settings.library_path, song.file_path);
  }
  return song;
}

function getSongByPath(filePath) {
  return db.prepare('SELECT * FROM songs WHERE file_path = ?').get(filePath);
}

// Returns every song's stored (library-relative) file_path. Used to diff the
// library folder against what's already ingested.
function getAllSongFilePaths() {
  return db.prepare('SELECT file_path FROM songs').all().map(row => row.file_path);
}

function isSongInList(songId, parentListId) {
  const item = db.prepare('SELECT * FROM list_items WHERE song_id = ? AND parent_list_id = ?').get(songId, parentListId);
  return item !== undefined;
}

function isSongInLibrary(songId) {
  // Check if the song exists anywhere in any list
  // For now, all lists are part of the Main Library
  // Later when playlists are added, this would need to filter by library vs playlist
  const item = db.prepare('SELECT 1 FROM list_items WHERE song_id = ? LIMIT 1').get(songId);
  return item !== undefined;
}

function addFolder(parentListId, position, title) {
  const now = new Date().toISOString();

  return db.transaction(() => {
    // Create the folder (list)
    const result = db.prepare(`
      INSERT INTO lists (title, is_subfolder, sidebar_position, inserted_at, updated_at)
      VALUES (?, 1, NULL, ?, ?)
    `).run(title, now, now);

    const folderId = result.lastInsertRowid;

    // Shift positions of items at or after the insertion position
    db.prepare(`
      UPDATE list_items
      SET position = position + 1
      WHERE parent_list_id = ? AND position >= ?
    `).run(parentListId, position);

    // Add the folder to the parent list
    db.prepare(`
      INSERT INTO list_items (parent_list_id, position, list_id, song_id, inserted_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(parentListId, position, folderId, now, now);

    return folderId;
  })();
}

function addSong(filePath, title, artist, album, durationSeconds, trackNumber = null) {
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO songs (title, artist, album, file_path, duration_seconds, track_number, inserted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, artist, album, filePath, durationSeconds, trackNumber, now, now);

  return result.lastInsertRowid;
}

function addSongToList(songId, parentListId, position) {
  const now = new Date().toISOString();

  return db.transaction(() => {
    // Shift positions of items at or after the insertion position
    db.prepare(`
      UPDATE list_items
      SET position = position + 1
      WHERE parent_list_id = ? AND position >= ?
    `).run(parentListId, position);

    // Add the song to the list
    db.prepare(`
      INSERT INTO list_items (parent_list_id, position, list_id, song_id, inserted_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(parentListId, position, songId, now, now);
  })();
}

function moveItem(itemId, newParentListId, newPosition) {
  const now = new Date().toISOString();

  return db.transaction(() => {
    const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId);

    if (!item) {
      throw new Error('Item not found');
    }

    const oldParentListId = item.parent_list_id;
    const oldPosition = item.position;

    // If moving within the same parent
    if (oldParentListId === newParentListId) {
      if (oldPosition === newPosition) {
        return; // No change needed
      }

      if (oldPosition < newPosition) {
        // Moving down: shift items between old and new position up
        db.prepare(`
          UPDATE list_items
          SET position = position - 1
          WHERE parent_list_id = ? AND position > ? AND position <= ?
        `).run(newParentListId, oldPosition, newPosition);
      } else {
        // Moving up: shift items between new and old position down
        db.prepare(`
          UPDATE list_items
          SET position = position + 1
          WHERE parent_list_id = ? AND position >= ? AND position < ?
        `).run(newParentListId, newPosition, oldPosition);
      }
    } else {
      // Moving to a different parent

      // Shift items after old position up in old parent
      db.prepare(`
        UPDATE list_items
        SET position = position - 1
        WHERE parent_list_id = ? AND position > ?
      `).run(oldParentListId, oldPosition);

      // Shift items at or after new position down in new parent
      db.prepare(`
        UPDATE list_items
        SET position = position + 1
        WHERE parent_list_id = ? AND position >= ?
      `).run(newParentListId, newPosition);
    }

    // Update the item itself
    db.prepare(`
      UPDATE list_items
      SET parent_list_id = ?, position = ?, updated_at = ?
      WHERE id = ?
    `).run(newParentListId, newPosition, now, itemId);
  })();
}

function deleteItem(itemId) {
  return db.transaction(() => {
    const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId);

    if (!item) {
      // Item already deleted (e.g., as child of a deleted parent folder) - nothing to do
      return;
    }

    // If it's a folder, recursively delete all items inside
    if (item.list_id !== null) {
      const childItems = db.prepare('SELECT id FROM list_items WHERE parent_list_id = ?').all(item.list_id);

      for (const child of childItems) {
        deleteItem(child.id);
      }
    }

    // Delete the list_item entry first (before deleting the list itself to avoid FK constraint)
    db.prepare('DELETE FROM list_items WHERE id = ?').run(itemId);

    // If it's a folder, delete the folder (list) itself after the list_item is gone
    if (item.list_id !== null) {
      db.prepare('DELETE FROM lists WHERE id = ?').run(item.list_id);
    }

    // Shift positions of items after this one up
    db.prepare(`
      UPDATE list_items
      SET position = position - 1
      WHERE parent_list_id = ? AND position > ?
    `).run(item.parent_list_id, item.position);
  })();
}

// Helper function to collect all song IDs and file paths that will be deleted
function collectSongsToDelete(itemId, results = { songIds: [], filePaths: [] }) {
  const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId);

  if (!item) {
    return results;
  }

  if (item.song_id !== null) {
    // This is a song - collect its ID and file path
    const song = db.prepare('SELECT file_path FROM songs WHERE id = ?').get(item.song_id);
    if (song) {
      results.songIds.push(item.song_id);
      const settings = getSettings();
      const absolutePath = path.join(settings.library_path, song.file_path);
      results.filePaths.push(absolutePath);
    }
  } else if (item.list_id !== null) {
    // This is a folder - recursively collect from children
    const childItems = db.prepare('SELECT id FROM list_items WHERE parent_list_id = ?').all(item.list_id);
    for (const child of childItems) {
      collectSongsToDelete(child.id, results);
    }
  }

  return results;
}

// Delete item and its associated audio files
function deleteItemWithFiles(itemId) {
  return db.transaction(() => {
    // First collect all songs to delete
    const { songIds, filePaths } = collectSongsToDelete(itemId);

    // Delete from database using the existing deleteItem function
    // This handles list_items, lists, and position adjustments
    deleteItem(itemId);

    // Now delete the song records from the songs table
    // Only delete songs that have no remaining list_item references
    const filesToDelete = [];
    for (let i = 0; i < songIds.length; i++) {
      const songId = songIds[i];
      const refCount = db.prepare('SELECT COUNT(*) as count FROM list_items WHERE song_id = ?').get(songId);
      if (refCount.count === 0) {
        // Remove tag associations first (FK; no DB-layer cascade by convention)
        db.prepare('DELETE FROM song_tags WHERE song_id = ?').run(songId);
        db.prepare('DELETE FROM songs WHERE id = ?').run(songId);
        filesToDelete.push(filePaths[i]);
      }
    }

    // Return only the file paths for songs that were actually deleted
    return filesToDelete;
  })();
}

// ---- Tags ----------------------------------------------------------------

function getAllTags() {
  return db.prepare('SELECT * FROM tags ORDER BY position').all();
}

// Create a tag at the end of the sort order. Throws on a duplicate name
// (case-insensitive) via the UNIQUE constraint -- callers should pre-check.
function createTag(name, color) {
  const now = new Date().toISOString();
  const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tags').get().pos;
  const result = db.prepare(`
    INSERT INTO tags (name, color, position, inserted_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, color, nextPos, now, now);
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
}

function renameTag(tagId, newName) {
  const now = new Date().toISOString();
  db.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(newName, now, tagId);
}

function setTagColor(tagId, color) {
  const now = new Date().toISOString();
  db.prepare('UPDATE tags SET color = ?, updated_at = ? WHERE id = ?').run(color, now, tagId);
}

// Delete a tag and all of its song associations.
function deleteTag(tagId) {
  return db.transaction(() => {
    db.prepare('DELETE FROM song_tags WHERE tag_id = ?').run(tagId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  })();
}

// Rewrite tag positions to match the given order of tag ids.
function reorderTags(orderedIds) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    orderedIds.forEach((tagId, index) => {
      db.prepare('UPDATE tags SET position = ?, updated_at = ? WHERE id = ?').run(index, now, tagId);
    });
  })();
}

function addTagToSongs(tagId, songIds) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO song_tags (song_id, tag_id, inserted_at) VALUES (?, ?, ?)');
    for (const songId of songIds) stmt.run(songId, tagId, now);
  })();
}

function removeTagFromSongs(tagId, songIds) {
  return db.transaction(() => {
    const stmt = db.prepare('DELETE FROM song_tags WHERE tag_id = ? AND song_id = ?');
    for (const songId of songIds) stmt.run(tagId, songId);
  })();
}

// ---- Song metadata -------------------------------------------------------

// Update editable song metadata. Only the provided fields are changed. Writes
// to the DB only; the audio file's embedded tags are NOT updated (see TASKS.md).
function updateSong(songId, fields) {
  const allowed = ['title', 'artist', 'album', 'track_number'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (keys.length === 0) return;
  const now = new Date().toISOString();
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  db.prepare(`UPDATE songs SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values, now, songId);
}

function getSettings() {
  const settings = {};
  const rows = db.prepare('SELECT key, value FROM settings').all();
  rows.forEach(row => {
    settings[row.key] = row.value;
  });

  // Add non-editable settings
  settings.database_path = getDbPath();

  return settings;
}

function updateSetting(key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `).run(key, value, now, value, now);
}

function renameFolder(listId, newTitle) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE lists
    SET title = ?, updated_at = ?
    WHERE id = ?
  `).run(newTitle, now, listId);
}

function updateFolderExpanded(listId, isExpanded) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE lists
    SET is_expanded = ?, updated_at = ?
    WHERE id = ?
  `).run(isExpanded ? 1 : 0, now, listId);
}

// Reorder a folder's direct contents. Folders always come first (alphabetical by
// title); songs are ordered by `sortBy`:
//   'title'  -> song title (alphabetical)
//   'artist' -> artist, then album, then track number, then title
// Only reassigns positions.
function sortFolderContents(parentListId, sortBy = 'title') {
  const now = new Date().toISOString();

  const cmpStr = (x, y) => (x || '').localeCompare(y || '', undefined, { sensitivity: 'base' });
  const trackOf = (n) => (n == null ? Number.MAX_SAFE_INTEGER : n);

  return db.transaction(() => {
    const items = db.prepare(`
      SELECT li.id, li.list_id, li.song_id,
             l.title AS folder_title,
             s.title AS song_title, s.artist, s.album, s.track_number
      FROM list_items li
      LEFT JOIN lists l ON li.list_id = l.id
      LEFT JOIN songs s ON li.song_id = s.id
      WHERE li.parent_list_id = ?
    `).all(parentListId);

    items.sort((a, b) => {
      const aIsFolder = a.list_id !== null;
      const bIsFolder = b.list_id !== null;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1; // folders above songs
      if (aIsFolder) return cmpStr(a.folder_title, b.folder_title);

      // Both are songs.
      if (sortBy === 'artist') {
        return cmpStr(a.artist, b.artist)
          || cmpStr(a.album, b.album)
          || (trackOf(a.track_number) - trackOf(b.track_number))
          || cmpStr(a.song_title, b.song_title);
      }
      return cmpStr(a.song_title, b.song_title);
    });

    items.forEach((item, index) => {
      db.prepare('UPDATE list_items SET position = ?, updated_at = ? WHERE id = ?')
        .run(index, now, item.id);
    });
  })();
}

// Flatten a folder: move every descendant song directly into this folder
// (depth-first, so the visible top-to-bottom order is preserved), then delete
// all of the now-empty subfolders.
function flattenFolder(folderListId) {
  const now = new Date().toISOString();

  return db.transaction(() => {
    const songItemIds = [];        // song list_item ids, in DFS order
    const subfolderItemIds = [];   // list_item ids pointing at subfolders (to delete)
    const subfolderListIds = [];    // the subfolder list ids themselves (to delete)

    const traverse = (listId) => {
      const items = db.prepare(
        'SELECT id, list_id, song_id FROM list_items WHERE parent_list_id = ? ORDER BY position'
      ).all(listId);
      for (const item of items) {
        if (item.song_id !== null) {
          songItemIds.push(item.id);
        } else if (item.list_id !== null) {
          traverse(item.list_id);          // collect the subfolder's songs first
          subfolderItemIds.push(item.id);
          subfolderListIds.push(item.list_id);
        }
      }
    };
    traverse(folderListId);

    // Reparent every song directly under this folder, in DFS order.
    songItemIds.forEach((itemId, index) => {
      db.prepare('UPDATE list_items SET parent_list_id = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(folderListId, index, now, itemId);
    });

    // Remove the subfolder placements first (FK), then the subfolder lists.
    for (const itemId of subfolderItemIds) {
      db.prepare('DELETE FROM list_items WHERE id = ?').run(itemId);
    }
    for (const listId of subfolderListIds) {
      db.prepare('DELETE FROM lists WHERE id = ?').run(listId);
    }
  })();
}

module.exports = {
  initialize,
  getLists,
  getListItems,
  getAllListItems,
  getItem,
  getSong,
  getSongByPath,
  getAllSongFilePaths,
  isSongInList,
  isSongInLibrary,
  addFolder,
  addSong,
  addSongToList,
  moveItem,
  deleteItem,
  deleteItemWithFiles,
  renameFolder,
  updateFolderExpanded,
  sortFolderContents,
  flattenFolder,
  getAllTags,
  createTag,
  renameTag,
  setTagColor,
  deleteTag,
  reorderTags,
  addTagToSongs,
  removeTagFromSongs,
  updateSong,
  getSettings,
  updateSetting,
  getDbPath,
};
