# Ludi

A fast, lightweight music library and player for macOS.

Ludi drops the iTunes playlist metaphor. Instead, your library is a tree of nested folders you arrange yourself, like a Finder window -- expand a folder to see what's inside, drag things around to reorganize. That tree is virtual: it lives in Ludi's database and has nothing to do with where the audio files actually sit on disk, so you can reorganize freely without moving a single file.

## Features

- **Folder-tree library.** Nest folders as deep as you like, drag and drop to reorder or reparent, sort a folder alphabetically, or flatten it. Right-click a folder to play the whole thing.
- **Playlists.** Reference-only song lists in the sidebar -- adding a song to a playlist copies the reference, never the file, and never moves it out of your library.
- **Tags.** Tag a song, a selection, or a whole folder at once. Tags show as colored pills in their own column and as chips in the sidebar; click a chip to search for it.
- **Search.** Filter as you type, or build advanced searches with conditions on title, artist, album, and tags. Search can be scoped to a playlist.
- **Import by drag and drop.** Drag audio files in from Finder and Ludi copies them into your library folder, reads their title/artist/album/duration tags, and files them where you dropped them.
- **Drag files back out.** Hold Option while dragging a selection to copy the underlying audio files out to the Desktop or a Finder folder.
- **Library scan.** Point Ludi at files already sitting in your library folder and it ingests them in place, grouped by artist and album.
- **Media keys.** The play/pause and next/previous keys on your keyboard work, along with hotkeys for navigation and playback.
- **Configurable columns** for track number, duration, artist, album, and tags.
- **Shuffle and loop that take effect immediately** on the next song, rather than waiting until you manually pick a different track.

Deleting a song moves its audio file to the macOS Trash rather than destroying it.

## Install

Requires an Apple Silicon Mac (M1 or later) running macOS 12 or later. There is no Intel build.

1. Download `Ludi-<version>-arm64.dmg` from the [Releases page](../../releases).
2. Open the `.dmg` and drag **Ludi** into your Applications folder.
3. The first time you open it, **Control-click (or right-click) Ludi in Applications and choose Open**, then confirm in the dialog. Double-clicking it the normal way will be blocked.

Step 3 is a one-time thing. Ludi is code signed, but with an ad-hoc signature rather than a paid Apple Developer ID certificate, which means it isn't notarized by Apple -- so macOS asks you to confirm you meant to open it. After the first launch it opens normally.

If macOS refuses to open it at all, clear the quarantine flag that Safari attaches to downloads:

```bash
xattr -dr com.apple.quarantine /Applications/Ludi.app
```

Ludi keeps your music in `~/Music/Ludi Library` and its database in `~/.ludi/`.

See [CHANGELOG.md](CHANGELOG.md) for what's changed in each version.

## Development

Claude agents: see @AGENTS.md

```bash
# Install dependencies (automatically rebuilds native modules)
npm install

# Run the app (production mode). Rebuilds the renderer bundle first (via the
# `prestart` hook), so it always reflects the current source. For live, instant
# updates while developing, use `npm run dev` instead.
npm start

# Run in development mode (Vite live reload + DevTools). Reflects source changes
# immediately -- prefer this while iterating on the UI.
npm run dev

# Run integration tests (NOTE: starting the test suite RESETS the test DB! No concurrent runs!)
npm test

# Build a packaged macOS app + .dmg (output in release/)
npm run release
```

The integration tests use Playwright to launch the app, verify the UI is displayed correctly, and confirm no errors occurred during startup.

### Architecture

- Electron (Tauri was my first choice but it's not functional on MacOS yet)
- SolidJS for the UI layer
- SQLite for the music library DB
- Howler.js for audio playback
- music-metadata for extracting title/artist/album tags from audiofiles
- Thorough integration tests using Playwright for Electron

### Releasing

Push a version tag and GitHub Actions builds the `.dmg` and opens a draft release for review:

```bash
npm version 0.2.0 --no-git-tag-version   # keep package.json in sync with the tag
git commit -am "Release v0.2.0" && git tag v0.2.0
git push && git push origin v0.2.0
```

`npm run release` ad-hoc signs the app (`build.mac.identity: "-"`), then verifies the signature via the `afterSign` hook in `scripts/verify-signature.js`, which fails the build rather than shipping a bundle macOS will reject. This matters: without an explicit identity, electron-builder finds no Developer ID cert, silently skips signing, and leaves the stock Electron linker signature attached to a bundle it then rewrites. macOS reads that as tampering and tells the user the app is "damaged and can't be opened" -- with no way to override, which is strictly worse than being unsigned. `tests/e2e/packaged-app.spec.js` covers both halves: that the signature seals the bundle, and that the signed app actually launches.

### Data locations

The app runs in one of three isolated modes, so dev/test/live never share a database or music folder:

| Mode | Trigger | Database (`~/.ludi/`) | Music library (`~/Music/`) |
|------|---------|-----------------------|----------------------------|
| live | packaged `.dmg` | `ludi-library-live.sqlite` | `Ludi Library` |
| dev  | `npm run dev`, `npm start` | `ludi-library-dev.sqlite` | `Ludi Library Dev` |
| test | `npm test` (reset each run) | `ludi-library-test.sqlite` | `Ludi Library Test` |

### The SQLite DB schema

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

## Milestones

- ✅ Basic Electron app skeleton, basic integration test harness
- ✅ Drag-and-drop import, playback, drag-and-drop reordering, selecting & deleting songs
- ✅ Media buttons support
- ✅ Folders
- ✅ Hotkeys for playlist navigation & playback
- ✅ Configurable columns for track #, duration, artist, album, and tags
- ✅ Refactor all UI to SolidJS for performance & easier maintenance
- ✅ Searching & filtering
- ✅ Song tagging
- ✅ Playlists

## Wishlist (later steps)

"Utilities" menu with some useful utilities:

- Scan for any audiofiles in the audio library folder that aren't present as a song
- Scan for any songs in our DB whose audiofile can't be found
- Scan for any songs whose duration_seconds in the DB doesn't match the audiofile duration
- Scan for any songs that aren't in the "main library" list

Other:

- Saved searches in the sidebar, alongside playlists.
- Detect/Prevent the app from being opened twice at the same time, to avoid conflicting writes to the sqlite DB.
- Volume equalizer - when enabled, per-song volume is adjusted so all songs have the same max volume.
- Right-click on a folder -> Scans -> "List duplicates of the same song" (in that list/folder). Opens a new window listing all duplicates found (for each, the song + the folder path). Click on any item to jump to it in the main window.
