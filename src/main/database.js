const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_DIR = path.join(os.homedir(), '.ludi');
const DB_PATH = path.join(DB_DIR, 'db.sqlite');

let db;

function initialize() {
  // Create directory if it doesn't exist
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // Open database
  db = new Database(DB_PATH);

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
}

function createTables() {
  // Lists table
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      is_subfolder INTEGER NOT NULL,
      sidebar_position INTEGER,
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
}

function getLists() {
  return db.prepare('SELECT * FROM lists WHERE is_subfolder = 0 ORDER BY sidebar_position').all();
}

function getListItems(listId) {
  return db.prepare(`
    SELECT
      li.*,
      l.title as list_title,
      s.title as song_title,
      s.artist,
      s.album,
      s.duration_seconds
    FROM list_items li
    LEFT JOIN lists l ON li.list_id = l.id
    LEFT JOIN songs s ON li.song_id = s.id
    WHERE li.parent_list_id = ?
    ORDER BY li.position
  `).all(listId);
}

function getSong(songId) {
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(songId);
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

function addSong(filePath, title, artist, album, durationSeconds) {
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO songs (title, artist, album, file_path, duration_seconds, inserted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, artist, album, filePath, durationSeconds, now, now);

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
      throw new Error('Item not found');
    }

    // If it's a folder, recursively delete all items inside
    if (item.list_id !== null) {
      const childItems = db.prepare('SELECT id FROM list_items WHERE parent_list_id = ?').all(item.list_id);

      for (const child of childItems) {
        deleteItem(child.id);
      }

      // Delete the folder (list) itself
      db.prepare('DELETE FROM lists WHERE id = ?').run(item.list_id);
    }

    // Delete the list_item entry
    db.prepare('DELETE FROM list_items WHERE id = ?').run(itemId);

    // Shift positions of items after this one up
    db.prepare(`
      UPDATE list_items
      SET position = position - 1
      WHERE parent_list_id = ? AND position > ?
    `).run(item.parent_list_id, item.position);
  })();
}

module.exports = {
  initialize,
  getLists,
  getListItems,
  getSong,
  addFolder,
  addSong,
  addSongToList,
  moveItem,
  deleteItem
};
