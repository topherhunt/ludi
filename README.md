# LUDI music player

## Getting Started

```bash
# Install dependencies (automatically rebuilds native modules)
npm install

# Run the app
npm start

# Run in development mode (with DevTools)
npm run dev

# Run integration tests
npm test
```

The integration tests use Playwright to launch the app, verify the UI is displayed correctly, and confirm no errors occurred during startup.

## VISION

Fast, intuitive, lightweight, deceptively powerful MacOS music library & player app built in Electron.

Architecture:

- Electron (Tauri was my first choice but it's not functional on MacOS yet)
- SQLite for the music library DB
- Howler.js for audio playback
- ?? (TODO) for extracting title/artist/album tags from audiofiles
- Thorough integration tests using Playwright for Electron

Features:

- Instead of a playlists sidebar in the style of iTunes or Swinsian, the main interface panel uses a "nested folders" metaphor, like a Finder / File Explorer window, where each folder can be expanded to reveal the subfolders
- Songs and folders can easily be rearranged via drag and drop to reorder them.
- There IS a left-hand sidebar, but it's only used for defining playlists and saved searches.
- You can right-click on any folder (either in the main view or within a playlist) and click "Play this folder".
- Changing shuffle and loop settings take effect immediately on next song play, unlike Swinsian which has a long-standing bug where those settings changes don't take effect until you select a different song to play.

## MILESTONES

- ✅ Basic Electron app skeleton, basic integration test harness
- [ ]

### 1. Proof-of-concept

Before I stress about nailing down the UI details, I should first do a spike to confirm that the basic mechanic works. This proof-of-concept should support:

- It's a lightweight Electron app, with the music library stored as a .sqlite DB at ~/.ludi/db.sqlite
- No "playlists" or "searching". Just a main panel which has a nested Explorer view of collapsible folders with all songs listed, like VS Code's File Explorer sidebar.
  - Supports drag-and-drop to move or reorder songs & folders.
  - Right-click on a list -> "Add folder inside" to add a folder as 1st child inside it.
  - Right-click on a song or folder -> "Add folder after" to add a folder AFTER it.
  - Right-click on a list or folder -> "Collapse all" and "Expand all" options, collapse/expand all (sub)folders in that item.
  - This organizes songs' "virtual locations" in the app, is stored in the .sqlite DB and DOES NOT REFLECT the underlying audiofiles' actual on-disk paths.
- Drag songs into the main panel in order to import them. Doing so will:
  - Make a COPY of each audiofile in ~/.ludi/library/{ARTIST_NAME}/{ALBUM_NAME}/. Artist & album should default to "Unknown" if blank. (NOTE: This is the audiofile organization structure which is mostly irrelevant, and is NOT REFLECTED in the in-app tree folder structure.)
  - Insert the song record, and add it to the main nested-list structure (in the .sqlite db) at the position the user dragged it to. Store the RELATIVE path to the song within the music library.
  - When dragging songs (from inside the app or from an external app) a blue line indicates where the item(s) will be dropped.
  - Warning message if any unsupported filetypes were dragged in, listing them and saying they'll be ignored.
  - Supports the common song formats (case-insensitive): .mp3, .m4a, .ogg.
- Double-click any SONG in the Explorer to start playback at that point, looping through my whole collection. Or double-click a FOLDER to start playback of just the songs in that folder (incl subfolders).
  - Playback traverses depth-first. So if the playback cursor reaches a folder, it enters the folder and plays the first item inside it.

#### The SQLite DB schema:

- `lists`
  *Represents a playlist (such as the mandatory "Main Library" list) or a subfolder within a list. The app auto-creates one mandatory playlist with id=0, position=0, and title="Main Library". For now, root-level playlists will be ordered in the sidebar using the `sidebar_position` field but long-term we may need a `sidebar_items` table.*
  - id
  - title
  - is_subfolder (not null)
  - sidebar_position (null if is_subfolder)
  - inserted_at
  - updated_at

- `list_items`
  *Represents a song's or folder's placement in a playlist or subfolder.*
  - id
  - parent_list_id (FK not null, represents the parent list/folder)
  - position (int not null)
  - list_id (FK, indexed, validate must be null if song_id is present)
  - song_id (FK, indexed, validate must be null if list_id is present)
  - inserted_at
  - updated_at

- `songs`
  - id
  - title (text not null)
  - artist
  - album
  - file_path (text not null, unique constraint)
  - duration_seconds (int not null)
  - inserted_at
  - updated_at

Notes on implementation:

- No DB-layer deletion cascade. Handle this via JS app logic.

### Wishlist (later steps)

"Utilities" menu with some useful utilities:

- Scan for any audiofiles in the audio library folder that aren't present as a song
- Scan for any songs in our DB whose audiofile can't be found
- Scan for any songs whose duration_seconds in the DB doesn't match the audiofile duration
- Scan for any songs that aren't in the "main library" list

Other:

- Right-click a selection of songs/folders -> "Move into new subfolder", opens a pop-up to type in the new folder's name. The new folder will be inserted above the 1st selected item, and then all selected items will be moved into it.
- Shuffle and loop functions. Shuffle just takes the current scope as a flat list, randomly shuffles all songs, and plays in that order.
- Detect/Prevent the app from being opened twice at the same time, to avoid conflicting writes to the sqlite DB.
- Add full support for playlists. In the proof-of-concept, the DB schema allows for this but there's no playlist creation/mgmt UI added.
- Right-hand sidebar for editing title, artist, album, and "tags" -- comma-separated labels that I can use for rich searching.
- Support searching:
  - Support tagging songs (one, or a selection, or a whole folder at once)
  - Can filter by playlist inclusion/exclusion, artist / album / title has/doesn't have, tag inclusion/exclusion
  - Supports "and" and "or" nested subgroups
- Support playlists and saved searches.
- Volume equalizer - when enabled, per-song volume is adjusted so all songs have the same max volume.
- Ability to customize the path to your audio library, and scan / autodetect all files in that path and add them to your main playlist.
- Right-click on a folder -> Scans -> "List duplicates of the same song" (in that list/folder). Opens a new window listing all duplicates found (for each, the song + the folder path). Click on any item to jump to it in the main window.
