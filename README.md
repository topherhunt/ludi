# LUDI music player

Claude agents: see @AGENTS.md

## Getting Started

```bash
# Install dependencies (automatically rebuilds native modules)
npm install

# Run the app (production mode)
npm start

# Run in development mode (with Vite hot reload + DevTools)
npm run dev

# Run integration tests
npm test
```

The integration tests use Playwright to launch the app, verify the UI is displayed correctly, and confirm no errors occurred during startup.

## VISION

Fast, intuitive, lightweight, deceptively powerful MacOS music library & player app built in Electron.

Architecture:

- Electron (Tauri was my first choice but it's not functional on MacOS yet)
- SolidJS for the UI layer
- SQLite for the music library DB
- Howler.js for audio playback
- music-metadata for extracting title/artist/album tags from audiofiles
- Thorough integration tests using Playwright for Electron

Features:

- Instead of a playlists sidebar in the style of iTunes or Swinsian, the main interface panel uses a "nested folders" metaphor, like a Finder / File Explorer window, where each folder can be expanded to reveal the subfolders. (This song explorer/organization view is virtual, stored in the .sqlite db, and does NOT correspond to where songs' audiofiles are stored on-disk.)
- Songs and folders can easily be rearranged via drag and drop to reorder them.
- There IS a left-hand sidebar, but it's only used for defining playlists and saved searches.
- You can right-click on any folder (either in the main view or within a playlist) and click "Play this folder".
- Changing shuffle and loop settings take effect immediately on next song play, unlike Swinsian which has a long-standing bug where those settings changes don't take effect until you select a different song to play.

## MILESTONES

- ✅ Basic Electron app skeleton, basic integration test harness
- ✅ Drag-and-drop import, playback, drag-and-drop reordering, selecting & deleting songs
- ✅ Media buttons support
- ✅ Folders
- ✅ Hotkeys for playlist navigation & playback
- ✅ Configurable columns for track #, duration, artist, album, and tags
- ✅ Refactor all UI to SolidJS for performance & easier maintenance
- [ ] Searching & filtering

## The SQLite DB schema:

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

## Wishlist (later steps)

"Utilities" menu with some useful utilities:

- Scan for any audiofiles in the audio library folder that aren't present as a song
- Scan for any songs in our DB whose audiofile can't be found
- Scan for any songs whose duration_seconds in the DB doesn't match the audiofile duration
- Scan for any songs that aren't in the "main library" list

Other:

- Detect/Prevent the app from being opened twice at the same time, to avoid conflicting writes to the sqlite DB.
- Add full support for playlists. In the proof-of-concept, the DB schema allows for this but there's no playlist creation/mgmt UI added.
- Sidebar section for editing title, artist, album, and "tags" -- comma-separated labels that I can use for rich searching.
- Support searching:
  - Support tagging songs (one, or a selection, or a whole folder at once)
  - Can filter by playlist inclusion/exclusion, artist / album / title has/doesn't have, tag inclusion/exclusion
  - Supports "and" and "or" nested subgroups
- Support playlists and saved searches.
- Volume equalizer - when enabled, per-song volume is adjusted so all songs have the same max volume.
- Ability to scan / autodetect all files in your Music Library path, and add them to your library DB.
- Right-click on a folder -> Scans -> "List duplicates of the same song" (in that list/folder). Opens a new window listing all duplicates found (for each, the song + the folder path). Click on any item to jump to it in the main window.
