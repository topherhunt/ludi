const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_DIR = path.join(os.homedir(), '.ludi');

// The master library: the one mandatory root list that every song must appear in.
// This means "the master library" -- NOT "the first row of the sidebar" and NOT
// "the root of the sidebar tree". Keep those ideas separate.
const MAIN_LIBRARY_ID = 0;

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

  // A named search query pinned to the sidebar.
  //
  // Stored as the query string rather than as a resolved list of songs: the
  // point of saving "tag=jazz tag=live" is that a song acquiring both tags next
  // month joins it on its own. That also makes a saved search survive a tag
  // being recalculated, which a frozen song list would not.
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      position INTEGER NOT NULL,
      inserted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // The auto-generated groups. `id` is the same number as
  // `song_analysis.cluster_id`, so a cluster's membership lives with the
  // analysis and only its name lives here -- which is what makes renaming one
  // survive a re-clustering no worse than a saved search survives a retag.
  db.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      inserted_at TEXT NOT NULL
    )
  `);

  // Audio-analysis results, one row per analyzed song.
  //
  // `embedding` is 200 float32s (800 bytes) -- the model's fingerprint of the
  // track, and what every similarity feature runs on. `activations` is the raw
  // 50 float32s of genre/mood scores; it's kept so that re-deriving auto-tags
  // (which depends on the whole library's score distribution) never requires
  // re-analyzing audio. `axes` holds the classification-head scalars as JSON.
  //
  // `map_x`/`map_y` cache the UMAP projection and `cluster_id` the k-means
  // assignment; both are derived from `embedding` and get recomputed in bulk.
  db.exec(`
    CREATE TABLE IF NOT EXISTS song_analysis (
      song_id INTEGER PRIMARY KEY,
      model_version TEXT NOT NULL,
      embedding BLOB NOT NULL,
      activations BLOB NOT NULL,
      axes TEXT NOT NULL,
      map_x REAL,
      map_y REAL,
      cluster_id INTEGER,
      analyzed_at TEXT NOT NULL,
      FOREIGN KEY (song_id) REFERENCES songs(id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_song_analysis_cluster ON song_analysis(cluster_id);
  `);

  // Work list for the background analyzer. Persisted rather than held in memory
  // so a pass that takes hours survives quitting the app partway through.
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_queue (
      song_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT NOT NULL,
      FOREIGN KEY (song_id) REFERENCES songs(id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analysis_queue_state ON analysis_queue(state);
  `);

  // Migration - distinguish machine-applied tags from hand-applied ones.
  //
  // `source` lives on the association, not the tag: the same tag ("mellow") can
  // be machine-applied to one song and hand-applied to another, and only the
  // machine-applied rows may be rewritten by a re-analysis. `confidence` is the
  // model's score, kept for sorting and for explaining why a tag is there.
  //
  // `tags.is_auto` marks a tag *definition* the analyzer created, which is what
  // draws the gear badge on the pill.
  const songTagColumns = db.prepare('PRAGMA table_info(song_tags)').all();
  if (!songTagColumns.some(col => col.name === 'source')) {
    db.exec(`ALTER TABLE song_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
  }
  if (!songTagColumns.some(col => col.name === 'confidence')) {
    db.exec(`ALTER TABLE song_tags ADD COLUMN confidence REAL`);
  }
  const tagColumns = db.prepare('PRAGMA table_info(tags)').all();
  if (!tagColumns.some(col => col.name === 'is_auto')) {
    db.exec(`ALTER TABLE tags ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0`);
  }

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
      (SELECT json_group_array(json_object(
                'id', t.id, 'name', t.name, 'color', t.color, 'position', t.position,
                'is_auto', t.is_auto, 'source', st.source))
         FROM song_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id = s.id AND st.source != 'suppressed') as tags
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
      (SELECT json_group_array(json_object(
                'id', t.id, 'name', t.name, 'color', t.color, 'position', t.position,
                'is_auto', t.is_auto, 'source', st.source))
         FROM song_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id = s.id AND st.source != 'suppressed') as tags
    FROM list_items li
    LEFT JOIN lists l ON li.list_id = l.id
    LEFT JOIN songs s ON li.song_id = s.id
    ORDER BY li.parent_list_id, li.position
  `).all());
}

/**
 * Song rows shaped like search results, for lists built from song ids rather
 * than from a placement (similarity results, clusters, map selections).
 *
 * Each song is paired with its Main Library placement, because that is the one
 * placement every song in the library is guaranteed to have -- it's what
 * selection, playback and drag-out all key off. Songs with no Main Library
 * placement are skipped rather than returned half-usable.
 */
function getSongsWithPlacements(songIds) {
  const rows = [];
  const stmt = db.prepare(`
    SELECT
      li.id as item_id,
      li.parent_list_id,
      li.position,
      s.id as song_id,
      s.title,
      s.artist,
      s.album,
      s.duration_seconds,
      s.track_number,
      (SELECT json_group_array(json_object(
                'id', t.id, 'name', t.name, 'color', t.color, 'position', t.position,
                'is_auto', t.is_auto, 'source', st.source))
         FROM song_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id = s.id AND st.source != 'suppressed') as tags
    FROM list_items li
    JOIN songs s ON li.song_id = s.id
    WHERE li.id = ?
  `);

  for (const songId of songIds) {
    const itemId = findSongPlacementInMainLibrary(songId);
    if (itemId === null) continue;
    rows.push(stmt.get(itemId));
  }
  return parseTagsColumn(rows);
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

// Walk up the folder chain to the root list (a playlist, or the Main Library)
// that ultimately contains `listId`. A list is a root when nothing places it
// inside another list.
function getRootListId(listId) {
  const stmt = db.prepare('SELECT parent_list_id FROM list_items WHERE list_id = ?');
  const seen = new Set();
  let currentId = listId;
  while (true) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle in list hierarchy at list ${currentId}`);
    }
    seen.add(currentId);
    const placement = stmt.get(currentId);
    if (!placement) return currentId;
    currentId = placement.parent_list_id;
  }
}

// Every song must live in the Main Library somewhere (playlists only reference
// songs). Placements under a playlist root don't count.
function isSongInMainLibrary(songId) {
  const placements = db.prepare('SELECT parent_list_id FROM list_items WHERE song_id = ?').all(songId);
  return placements.some(p => getRootListId(p.parent_list_id) === MAIN_LIBRARY_ID);
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
    const result = db.prepare(`
      INSERT INTO list_items (parent_list_id, position, list_id, song_id, inserted_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(parentListId, position, songId, now, now);

    return result.lastInsertRowid;
  })();
}

// The list_items row that places `songId` somewhere under the Main Library, or
// null if it isn't in the library. Used by import to reuse an existing placement
// instead of creating a second one.
function findSongPlacementInMainLibrary(songId) {
  const placements = db.prepare('SELECT id, parent_list_id FROM list_items WHERE song_id = ?').all(songId);
  const match = placements.find(p => getRootListId(p.parent_list_id) === MAIN_LIBRARY_ID);
  return match ? match.id : null;
}

// The list_items row that places folder `listId` inside its parent.
function getFolderPlacementItemId(listId) {
  const placement = db.prepare('SELECT id FROM list_items WHERE list_id = ?').get(listId);
  return placement ? placement.id : null;
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

// Close position gaps so a list's positions stay dense (0..n-1).
function renumberList(parentListId) {
  const now = new Date().toISOString();
  const items = db.prepare(
    'SELECT id FROM list_items WHERE parent_list_id = ? ORDER BY position'
  ).all(parentListId);
  items.forEach((item, index) => {
    db.prepare('UPDATE list_items SET position = ?, updated_at = ? WHERE id = ?')
      .run(index, now, item.id);
  });
}

// Delete item and its associated audio files. This is the Main Library ("master")
// delete: the song is removed from every playlist that references it, the songs
// row goes, and the file is trashed. To remove a song from a playlist only, use
// removeItemsFromList.
function deleteItemWithFiles(itemId) {
  return db.transaction(() => {
    // First collect all songs to delete
    const { songIds, filePaths } = collectSongsToDelete(itemId);

    // Delete from database using the existing deleteItem function
    // This handles list_items, lists, and position adjustments
    deleteItem(itemId);

    const filesToDelete = [];
    const processed = new Set(); // a song can appear more than once under one item
    for (let i = 0; i < songIds.length; i++) {
      const songId = songIds[i];
      if (processed.has(songId)) continue;
      processed.add(songId);

      // Purge the song's remaining placements (playlists) so nothing dangles,
      // then close the gaps that leaves behind in those lists.
      const others = db.prepare('SELECT parent_list_id FROM list_items WHERE song_id = ?').all(songId);
      if (others.length > 0) {
        db.prepare('DELETE FROM list_items WHERE song_id = ?').run(songId);
        for (const parentListId of new Set(others.map(o => o.parent_list_id))) {
          renumberList(parentListId);
        }
      }

      // Remove tag associations first (FK; no DB-layer cascade by convention)
      db.prepare('DELETE FROM song_tags WHERE song_id = ?').run(songId);
      // Same for the analysis rows. The embedding is expensive to produce, but
      // it describes a file that no longer exists -- keeping it would leave a
      // ghost in every similarity search and on the music map.
      db.prepare('DELETE FROM song_analysis WHERE song_id = ?').run(songId);
      db.prepare('DELETE FROM analysis_queue WHERE song_id = ?').run(songId);
      db.prepare('DELETE FROM songs WHERE id = ?').run(songId);
      analysisRevision++;
      filesToDelete.push(filePaths[i]);
    }

    return filesToDelete;
  })();
}

// ---- Saved searches ------------------------------------------------------

function getSavedSearches() {
  return db.prepare('SELECT * FROM saved_searches ORDER BY position').all();
}

/** Save a query under a name, at the end of the sidebar list. */
function createSavedSearch(name, query) {
  const now = new Date().toISOString();
  const nextPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM saved_searches'
  ).get().pos;
  const result = db.prepare(`
    INSERT INTO saved_searches (name, query, position, inserted_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, query, nextPos, now, now);
  return db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(result.lastInsertRowid);
}

function renameSavedSearch(id, newName) {
  const now = new Date().toISOString();
  db.prepare('UPDATE saved_searches SET name = ?, updated_at = ? WHERE id = ?').run(newName, now, id);
}

function deleteSavedSearch(id) {
  db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
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

// Applying a tag by hand always wins: an association the analyzer created (or
// one you previously suppressed) is promoted to 'manual', which takes it
// permanently out of the analyzer's reach.
function addTagToSongs(tagId, songIds) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO song_tags (song_id, tag_id, inserted_at, source)
      VALUES (?, ?, ?, 'manual')
      ON CONFLICT(song_id, tag_id) DO UPDATE SET source = 'manual', confidence = NULL
    `);
    for (const songId of songIds) stmt.run(songId, tagId, now);
  })();
}

// Removing a tag the analyzer applied leaves a 'suppressed' tombstone instead of
// deleting the row, so the next calibration pass doesn't put it straight back.
// Hand-applied associations are simply deleted -- there's nothing to suppress.
function removeTagFromSongs(tagId, songIds) {
  return db.transaction(() => {
    const suppress = db.prepare(
      `UPDATE song_tags SET source = 'suppressed' WHERE tag_id = ? AND song_id = ? AND source = 'auto'`
    );
    const remove = db.prepare(
      `DELETE FROM song_tags WHERE tag_id = ? AND song_id = ? AND source = 'manual'`
    );
    for (const songId of songIds) {
      suppress.run(tagId, songId);
      remove.run(tagId, songId);
    }
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

// ---- Playlists -----------------------------------------------------------
//
// A playlist is a root list: `is_subfolder = 0` plus a `sidebar_position`. It
// holds references to songs, never copies of them -- copying a folder into a
// playlist creates new `lists`/`list_items` rows that point at the SAME `songs`
// rows, and the audio files are untouched. Duplicates of one song within a
// playlist are allowed by design (see the DROP INDEX in createTables).
//
// `sidebar_position` is read and written ONLY here and in getLists(). If the
// sidebar ever grows folders-of-playlists, a `sidebar_items` placement table
// replaces the column and these two functions are the whole migration surface.

function createPlaylist(title) {
  const now = new Date().toISOString();
  const nextPos = db.prepare(
    'SELECT COALESCE(MAX(sidebar_position), -1) + 1 AS pos FROM lists WHERE is_subfolder = 0'
  ).get().pos;
  const result = db.prepare(`
    INSERT INTO lists (title, is_subfolder, sidebar_position, inserted_at, updated_at)
    VALUES (?, 0, ?, ?, ?)
  `).run(title, nextPos, now, now);
  return db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid);
}

// Delete a playlist and every placement inside it. Songs and audio files are
// never touched -- a playlist only ever held references.
function deletePlaylist(listId) {
  if (listId === MAIN_LIBRARY_ID) {
    throw new Error('The Main Library cannot be deleted');
  }
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!list) throw new Error(`No such list: ${listId}`);
  if (list.is_subfolder) throw new Error(`List ${listId} is a folder, not a playlist`);

  return db.transaction(() => {
    const items = db.prepare('SELECT id FROM list_items WHERE parent_list_id = ?').all(listId);
    for (const item of items) deleteItem(item.id);
    db.prepare('DELETE FROM lists WHERE id = ?').run(listId);
  })();
}

// Rewrite sidebar order from an ordered array of playlist ids. Main Library is
// pinned at position 0 and must not appear in `orderedIds`; the rest follow it.
// The array signature (rather than "set playlist X to position N") is what lets
// this become reorderSidebar({ parentFolderId, orderedIds }) later.
function reorderPlaylists(orderedIds) {
  if (orderedIds.includes(MAIN_LIBRARY_ID)) {
    throw new Error('The Main Library cannot be reordered');
  }
  const now = new Date().toISOString();
  return db.transaction(() => {
    orderedIds.forEach((listId, index) => {
      db.prepare('UPDATE lists SET sidebar_position = ?, updated_at = ? WHERE id = ?')
        .run(index + 1, now, listId);
    });
  })();
}

// Remove placements only. deleteItem already recurses into folders and never
// touches songs or files, which is exactly the playlist-removal semantics.
function removeItemsFromList(itemIds) {
  return db.transaction(() => {
    for (const itemId of itemIds) deleteItem(itemId);
  })();
}

// Every song reachable from `itemIds`, in depth-first display order. Songs
// appearing more than once are listed more than once.
function collectSongsInItems(itemIds) {
  const songs = [];
  const visit = (itemId) => {
    const item = db.prepare(`
      SELECT li.list_id, li.song_id, s.title AS song_title
      FROM list_items li LEFT JOIN songs s ON li.song_id = s.id
      WHERE li.id = ?
    `).get(itemId);
    if (!item) throw new Error(`No such list item: ${itemId}`);

    if (item.song_id !== null) {
      songs.push({ song_id: item.song_id, title: item.song_title });
    } else {
      const children = db.prepare(
        'SELECT id FROM list_items WHERE parent_list_id = ? ORDER BY position'
      ).all(item.list_id);
      for (const child of children) visit(child.id);
    }
  };
  for (const itemId of itemIds) visit(itemId);
  return songs;
}

// Absolute paths of every audio file reachable from `itemIds`, deduped and in
// depth-first display order. Backs the drag-out-to-Finder gesture: dragging the
// same song twice would still copy one file, so the same song is listed once.
function getSongFilePathsForItems(itemIds) {
  const settings = getSettings();
  const seen = new Set();
  const paths = [];
  for (const { song_id } of collectSongsInItems(itemIds)) {
    if (seen.has(song_id)) continue;
    seen.add(song_id);
    const song = db.prepare('SELECT file_path FROM songs WHERE id = ?').get(song_id);
    if (!song) throw new Error(`No such song: ${song_id}`);
    paths.push(path.join(settings.library_path, song.file_path));
  }
  return paths;
}

// Every song id anywhere under `listId`, recursing into folders.
function collectSongIdsInList(listId) {
  const ids = new Set();
  const visit = (id) => {
    const items = db.prepare('SELECT list_id, song_id FROM list_items WHERE parent_list_id = ?').all(id);
    for (const item of items) {
      if (item.song_id !== null) ids.add(item.song_id);
      else visit(item.list_id);
    }
  };
  visit(listId);
  return ids;
}

// What would copying `itemIds` into `targetListId` bring in, and which of those
// songs are already there? Drives the add/skip/cancel dialog. One row per
// duplicated song, however many times it appears in the source.
//
// "Already there" means anywhere in the whole playlist, not just in the target
// folder -- dropping into a subfolder of a playlist that already holds the song
// elsewhere is still a duplicate as the user sees it.
function previewCopyToList(itemIds, targetListId) {
  const songs = collectSongsInItems(itemIds);
  const existing = collectSongIdsInList(getRootListId(targetListId));

  const seen = new Set();
  const duplicates = [];
  for (const song of songs) {
    if (existing.has(song.song_id) && !seen.has(song.song_id)) {
      seen.add(song.song_id);
      duplicates.push(song);
    }
  }
  return { totalSongs: songs.length, duplicates };
}

// Append copies of `itemIds` to the end of `targetListId`. Songs become new
// placements pointing at the same `songs` row; folders get a brand-new `lists`
// row and are copied recursively. Songs in `skipSongIds` are omitted -- a folder
// left empty by that is still created, so the copied structure stays predictable.
function copyItemsToList(itemIds, targetListId, skipSongIds = []) {
  const now = new Date().toISOString();
  const skip = new Set(skipSongIds);

  return db.transaction(() => {
    let added = 0;

    const copyInto = (sourceItemId, parentListId, position) => {
      const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(sourceItemId);
      if (!item) throw new Error(`No such list item: ${sourceItemId}`);

      if (item.song_id !== null) {
        if (skip.has(item.song_id)) return false;
        db.prepare(`
          INSERT INTO list_items (parent_list_id, position, list_id, song_id, inserted_at, updated_at)
          VALUES (?, ?, NULL, ?, ?, ?)
        `).run(parentListId, position, item.song_id, now, now);
        added++;
        return true;
      }

      const source = db.prepare('SELECT title FROM lists WHERE id = ?').get(item.list_id);
      const newFolderId = db.prepare(`
        INSERT INTO lists (title, is_subfolder, sidebar_position, inserted_at, updated_at)
        VALUES (?, 1, NULL, ?, ?)
      `).run(source.title, now, now).lastInsertRowid;
      db.prepare(`
        INSERT INTO list_items (parent_list_id, position, list_id, song_id, inserted_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)
      `).run(parentListId, position, newFolderId, now, now);

      const children = db.prepare(
        'SELECT id FROM list_items WHERE parent_list_id = ? ORDER BY position'
      ).all(item.list_id);
      let childPosition = 0;
      for (const child of children) {
        if (copyInto(child.id, newFolderId, childPosition)) childPosition++;
      }
      return true;
    };

    let nextPosition = db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM list_items WHERE parent_list_id = ?'
    ).get(targetListId).pos;
    for (const itemId of itemIds) {
      if (copyInto(itemId, targetListId, nextPosition)) nextPosition++;
    }
    return added;
  })();
}

// ---- Audio analysis ------------------------------------------------------
//
// Every song gets one song_analysis row holding the model's fingerprint of it.
// analysis_queue is the durable work list feeding that: a full-library pass takes
// hours, so it has to survive the app being quit halfway through.

/**
 * Bumped whenever an embedding is written or removed.
 *
 * similarity.js holds the whole library's embeddings in one in-memory matrix and
 * has no way to notice the table changing under it. Rather than making every
 * caller remember to invalidate that cache, they compare this number: if it
 * moved, the matrix is stale. A count of rows wouldn't do, since re-analyzing a
 * song leaves the count unchanged while changing where it sits in the space.
 */
let analysisRevision = 0;

function getAnalysisRevision() {
  return analysisRevision;
}

/**
 * Songs that have no analysis, or whose analysis came from a different model
 * version. Returned oldest-first so a big pass works through the library in
 * import order rather than jumping around.
 */
function getSongsNeedingAnalysis(modelVersion) {
  return db.prepare(`
    SELECT s.id
    FROM songs s
    LEFT JOIN song_analysis a ON a.song_id = s.id
    WHERE a.song_id IS NULL OR a.model_version != ?
    ORDER BY s.id
  `).all(modelVersion).map(row => row.id);
}

/**
 * Add songs to the work list. Already-queued songs are left alone so re-running
 * this doesn't reset attempt counts or resurrect a failure's error message.
 */
function enqueueForAnalysis(songIds) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO analysis_queue (song_id, state, attempts, queued_at)
      VALUES (?, 'pending', 0, ?)
    `);
    let added = 0;
    for (const songId of songIds) added += stmt.run(songId, now).changes;
    return added;
  })();
}

/**
 * Claim up to `limit` pending songs, marking them running and returning absolute
 * file paths. Songs whose file has gone missing are still returned -- the
 * analyzer reports the read failure, which surfaces a real error rather than
 * silently skipping.
 */
function claimAnalysisTasks(limit) {
  const settings = getSettings();
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT q.song_id, s.file_path, s.title
      FROM analysis_queue q
      JOIN songs s ON s.id = q.song_id
      WHERE q.state = 'pending'
      ORDER BY q.song_id
      LIMIT ?
    `).all(limit);

    const claim = db.prepare(
      `UPDATE analysis_queue SET state = 'running', attempts = attempts + 1 WHERE song_id = ?`
    );
    for (const row of rows) claim.run(row.song_id);

    return rows.map(row => ({
      songId: row.song_id,
      title: row.title,
      filePath: path.join(settings.library_path, row.file_path),
    }));
  })();
}

/**
 * Store a finished analysis and drop the song from the queue. Re-analysis of an
 * already-analyzed song replaces the old row, so the embedding a song is matched
 * on is always the one the current model produced.
 */
function saveAnalysis(songId, { modelVersion, embedding, activations, axes }) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    db.prepare(`
      INSERT INTO song_analysis (song_id, model_version, embedding, activations, axes, analyzed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_id) DO UPDATE SET
        model_version = excluded.model_version,
        embedding = excluded.embedding,
        activations = excluded.activations,
        axes = excluded.axes,
        analyzed_at = excluded.analyzed_at,
        map_x = NULL,
        map_y = NULL,
        cluster_id = NULL
    `).run(songId, modelVersion, embedding, activations, JSON.stringify(axes), now);
    db.prepare('DELETE FROM analysis_queue WHERE song_id = ?').run(songId);
    analysisRevision++;
  })();
}

/**
 * Record a failure. After MAX_ATTEMPTS the song stays in the queue as 'failed'
 * so it's visible and retryable, but stops being handed out -- a file the codec
 * can't read would otherwise spin forever.
 */
const MAX_ANALYSIS_ATTEMPTS = 3;

function failAnalysis(songId, error) {
  const row = db.prepare('SELECT attempts FROM analysis_queue WHERE song_id = ?').get(songId);
  if (!row) return;
  const state = row.attempts >= MAX_ANALYSIS_ATTEMPTS ? 'failed' : 'pending';
  db.prepare('UPDATE analysis_queue SET state = ?, error = ? WHERE song_id = ?')
    .run(state, String(error), songId);
}

/**
 * Reset songs left mid-flight by a crash or quit. Called at startup: a 'running'
 * row with nothing running is a lie, and would never be handed out again.
 */
function requeueStaleAnalysisTasks() {
  return db.prepare(`UPDATE analysis_queue SET state = 'pending' WHERE state = 'running'`).run().changes;
}

/** Move every failed song back to pending, for a user-triggered retry. */
function retryFailedAnalysis() {
  return db.prepare(
    `UPDATE analysis_queue SET state = 'pending', attempts = 0, error = NULL WHERE state = 'failed'`
  ).run().changes;
}

function getAnalysisStats() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM songs').get().n;
  const analyzed = db.prepare('SELECT COUNT(*) AS n FROM song_analysis').get().n;
  const queue = db.prepare('SELECT state, COUNT(*) AS n FROM analysis_queue GROUP BY state').all();
  const byState = Object.fromEntries(queue.map(row => [row.state, row.n]));
  return {
    total,
    analyzed,
    pending: (byState.pending || 0) + (byState.running || 0),
    failed: byState.failed || 0,
  };
}

/** The failed songs, with titles, for the "N songs couldn't be analyzed" list. */
function getFailedAnalyses() {
  return db.prepare(`
    SELECT q.song_id, q.error, s.title, s.artist
    FROM analysis_queue q JOIN songs s ON s.id = q.song_id
    WHERE q.state = 'failed'
    ORDER BY s.artist, s.title
  `).all();
}

/**
 * Every embedding in the library, as raw blobs. The caller decodes them into one
 * big Float32Array (see similarity.js) -- at 800 bytes per song even a 100k-track
 * library is 76 MB, which brute-force cosine search scans in ~15 ms.
 */
function getAllEmbeddings() {
  return db.prepare('SELECT song_id, embedding FROM song_analysis ORDER BY song_id').all();
}

function getAnalysis(songId) {
  const row = db.prepare('SELECT * FROM song_analysis WHERE song_id = ?').get(songId);
  if (row) row.axes = JSON.parse(row.axes);
  return row;
}

/** All stored axis vectors, for percentile calibration and the facet browser. */
function getAllAxes() {
  return db.prepare('SELECT song_id, axes FROM song_analysis').all()
    .map(row => ({ song_id: row.song_id, axes: JSON.parse(row.axes) }));
}

/** All stored activation blobs, for percentile calibration of the MSD labels. */
function getAllActivations() {
  return db.prepare('SELECT song_id, activations FROM song_analysis').all();
}

/** Write back the 2D map projection computed in bulk from the embeddings. */
function saveMapCoordinates(coords) {
  return db.transaction(() => {
    const stmt = db.prepare('UPDATE song_analysis SET map_x = ?, map_y = ? WHERE song_id = ?');
    for (const { songId, x, y } of coords) stmt.run(x, y, songId);
  })();
}

/** Write back k-means cluster assignments computed in bulk. */
function saveClusterAssignments(assignments) {
  return db.transaction(() => {
    const stmt = db.prepare('UPDATE song_analysis SET cluster_id = ? WHERE song_id = ?');
    for (const { songId, clusterId } of assignments) stmt.run(clusterId, songId);
  })();
}

/** song_id -> {x, y, cluster} for every song that has a cached projection. */
function getMapPoints() {
  return db.prepare(`
    SELECT a.song_id, a.map_x, a.map_y, a.cluster_id, s.title, s.artist, s.album
    FROM song_analysis a JOIN songs s ON s.id = a.song_id
    WHERE a.map_x IS NOT NULL
  `).all();
}

// ---- Clusters ------------------------------------------------------------

/** song_id -> the names of the tags on it, for naming clusters after them. */
function getSongTagNames() {
  const rows = db.prepare(`
    SELECT st.song_id, t.name
    FROM song_tags st JOIN tags t ON t.id = st.tag_id
    WHERE st.source IN ('manual', 'auto')
  `).all();
  const bySongId = new Map();
  for (const { song_id, name } of rows) {
    if (!bySongId.has(song_id)) bySongId.set(song_id, []);
    bySongId.get(song_id).push(name);
  }
  return bySongId;
}

/** Replace the whole set of cluster names. Ids are the array positions. */
function replaceClusters(names) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    db.prepare('DELETE FROM clusters').run();
    const stmt = db.prepare('INSERT INTO clusters (id, name, inserted_at) VALUES (?, ?, ?)');
    names.forEach((name, id) => stmt.run(id, name, now));
  })();
}

/**
 * Every cluster with its current membership count, biggest first. The count is
 * computed rather than stored so deleting songs can't leave it lying.
 */
function getClusters() {
  return db.prepare(`
    SELECT c.id, c.name, COUNT(a.song_id) AS size
    FROM clusters c
    LEFT JOIN song_analysis a ON a.cluster_id = c.id
    GROUP BY c.id, c.name
    ORDER BY size DESC, c.id
  `).all();
}

function renameCluster(clusterId, newName) {
  db.prepare('UPDATE clusters SET name = ? WHERE id = ?').run(newName, clusterId);
}

/** The song ids in one cluster, in library order. */
function getClusterSongIds(clusterId) {
  return db.prepare('SELECT song_id FROM song_analysis WHERE cluster_id = ? ORDER BY song_id').all(clusterId)
    .map(row => row.song_id);
}

// ---- Auto tags -----------------------------------------------------------
//
// `song_tags.source` is the pivot the whole auto/manual distinction turns on:
//
//   'manual'     -- you put it there. The analyzer never touches it.
//   'auto'       -- the analyzer put it there, and may replace it next pass.
//   'suppressed' -- the analyzer put it there and you took it off. The row stays
//                   as a tombstone so re-running the analyzer doesn't bring it
//                   back; without it, every recalibration would undo your edits.
//
// Everything that reads a song's tags filters to ('manual', 'auto').

/** Find or create the tag definition an auto-tag writes into. */
function getOrCreateAutoTag(name, color) {
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(name);
  if (existing) return existing;
  const tag = createTag(name, color);
  db.prepare('UPDATE tags SET is_auto = 1 WHERE id = ?').run(tag.id);
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(tag.id);
}

/**
 * Replace the machine-applied tags for the whole library in one transaction.
 *
 * `assignments` is [{ songId, tagId, confidence }]. Rows you applied or removed
 * by hand survive untouched: the delete only takes source='auto', and the insert
 * is OR IGNORE so it can't overwrite a 'manual' or 'suppressed' row.
 */
function replaceAutoTags(assignments) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    db.prepare(`DELETE FROM song_tags WHERE source = 'auto'`).run();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO song_tags (song_id, tag_id, inserted_at, source, confidence)
      VALUES (?, ?, ?, 'auto', ?)
    `);
    let applied = 0;
    for (const { songId, tagId, confidence } of assignments) {
      applied += stmt.run(songId, tagId, now, confidence).changes;
    }
    return applied;
  })();
}

/** Remove every auto tag and every auto-created tag definition that's now unused. */
function clearAutoTags() {
  return db.transaction(() => {
    db.prepare(`DELETE FROM song_tags WHERE source IN ('auto', 'suppressed')`).run();
    db.prepare(`
      DELETE FROM tags
      WHERE is_auto = 1 AND id NOT IN (SELECT tag_id FROM song_tags)
    `).run();
  })();
}

module.exports = {
  MAIN_LIBRARY_ID,
  MAX_ANALYSIS_ATTEMPTS,
  initialize,
  getLists,
  getListItems,
  getAllListItems,
  getSongsWithPlacements,
  getItem,
  getSong,
  getSongByPath,
  getAllSongFilePaths,
  getSongFilePathsForItems,
  isSongInList,
  isSongInMainLibrary,
  findSongPlacementInMainLibrary,
  getFolderPlacementItemId,
  getRootListId,
  createPlaylist,
  deletePlaylist,
  reorderPlaylists,
  removeItemsFromList,
  previewCopyToList,
  copyItemsToList,
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
  getSavedSearches,
  createSavedSearch,
  renameSavedSearch,
  deleteSavedSearch,
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
  // Audio analysis
  getSongsNeedingAnalysis,
  enqueueForAnalysis,
  claimAnalysisTasks,
  saveAnalysis,
  failAnalysis,
  requeueStaleAnalysisTasks,
  retryFailedAnalysis,
  getAnalysisStats,
  getFailedAnalyses,
  getAllEmbeddings,
  getAnalysisRevision,
  getAnalysis,
  getAllAxes,
  getAllActivations,
  saveMapCoordinates,
  saveClusterAssignments,
  getMapPoints,
  getSongTagNames,
  replaceClusters,
  getClusters,
  renameCluster,
  getClusterSongIds,
  getOrCreateAutoTag,
  replaceAutoTags,
  clearAutoTags,
};
