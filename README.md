# Ludi

A fast, lightweight music library and player for macOS.

Ludi drops the iTunes playlist metaphor. Instead, your library is a tree of nested folders you arrange yourself, like a Finder window -- expand a folder to see what's inside, drag things around to reorganize. That tree is virtual: it lives in Ludi's database and has nothing to do with where the audio files actually sit on disk, so you can reorganize freely without moving a single file.

## Features

- **Folder-tree library.** Nest folders as deep as you like, drag and drop to reorder or reparent, sort a folder alphabetically, or flatten it. Right-click a folder to play the whole thing.
- **Playlists.** Reference-only song lists in the sidebar -- adding a song to a playlist copies the reference, never the file, and never moves it out of your library.
- **Tags.** Tag a song, a selection, or a whole folder at once. Tags show as colored pills in their own column and as chips in the sidebar; the chips are scoped to whatever you're looking at and carry a count, and clicking them stacks up as filters.
- **Star ratings.** A 1-5 star column in the song list. Click a star to rate, click the same star again to clear it, or press `1`-`5` (and `0` to clear) to rate everything you have selected. Ratings are searchable -- `rating>=4`, `rating=none` -- and available as a condition in the advanced-search composer. Settings can import the ratings out of an existing Swinsian library, showing you what it would match before writing anything.
- **Listening history.** Every song carries a play count and a last-played date, both searchable -- `plays>=5`, `plays=0` for everything you have never got to, `lastplayed>=2026-01-01` -- and both offered as conditions in the advanced-search composer. A play is counted once you have actually listened to half the track (30 seconds is enough for anything longer), so skipping down a list leaves the counts alone.
- **Search.** Filter as you type, or build advanced searches with conditions on title, artist, album, track number, rating, play count, last-played date, and tags. Numbers and dates compare rather than match, so a condition can say "is at least 4" or "is on or after June 1". Search can be scoped to a playlist, and any search can be **saved to the sidebar** -- saved as the query, so songs join and leave it on their own as your library changes.
- **Audio analysis.** Ludi listens to every song locally (no uploads, no API keys) with a MusiCNN model running on ONNX Runtime, and stores a 200-number fingerprint of how each track sounds. It runs in the background, backs off while you're playing music, and picks up where it left off if you quit. Everything below is built on it:
  - **Similar songs.** Right-click any song for the tracks that sound most like it.
  - **Auto-tags.** Genre and mood tags applied from the model's own scores, calibrated against your library rather than absolute thresholds. Machine-applied tags carry a gear badge so they're never confused with your own, and re-running the analysis only ever rewrites those.
  - **Auto-playlists.** Ludi clusters the library into groups, names each one after what makes it distinctive, and lets you save any of them as a real playlist.
  - **Music map.** Your whole library as a zoomable, pannable 2D landscape where similar music sits together. Hover for a title, double-click to play, or shift-drag a lasso around a region and save it as a playlist.
  - **Facet browser.** Every tag in the current view with how many songs carry it. Click one to drill in, and the list becomes "what else these songs tend to be", with the combinations that are unusually concentrated marked. Hand any drill-down to the search box to save it.
- **Import by drag and drop.** Drag audio files in from Finder and Ludi copies them into your library folder, reads their title/artist/album/duration tags, and files them where you dropped them.
- **Drag files back out.** Hold Option while dragging a selection to copy the underlying audio files out to the Desktop or a Finder folder.
- **Library scan.** Point Ludi at files already sitting in your library folder and it ingests them in place, grouped by artist and album.
- **Media keys.** The play/pause and next/previous keys on your keyboard work, along with hotkeys for navigation and playback.
- **Configurable columns** for track number, duration, rating, artist, album, and tags.
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

## License

[AGPL-3.0-or-later](LICENSE). Ludi was MIT until it grew audio analysis: essentia.js, which computes the mel-spectrograms the model runs on, is AGPL-3.0, and linking it makes the combined work AGPL too.

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
- essentia.js (mel-spectrograms) + ONNX Runtime Web (MusiCNN inference) for audio analysis, both running as WASM in a hidden renderer window
- umap-js for projecting the analysis embeddings down to the 2D music map
- Thorough integration tests using Playwright for Electron

### Releasing

Push a version tag and GitHub Actions builds the `.dmg` and opens a draft release for review:

```bash
npm version 0.3.0 --no-git-tag-version   # keep package.json in sync with the tag
git commit -am "Release v0.3.0" && git tag v0.3.0
git push && git push origin v0.3.0
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
  - track_number
  - rating (int, nullable 1-5 -- null means "never rated", which is a different fact from a deliberate 1 star, so ratings never default to 0)
  - play_count (int not null, default 0 -- bumped once you have listened to half the track, capped at 30 seconds of accumulated listening, so clicking down a list never inflates it)
  - last_played_at (text, nullable ISO timestamp -- null until that first counted play)
  - file_path (text not null, unique constraint)
  - duration_seconds (int not null)
  - inserted_at
  - updated_at

- `tags`
  - id
  - name (text not null, unique COLLATE NOCASE)
  - color (text not null)
  - position (int not null -- the manual drag-to-reorder order used wherever tags are listed)
  - is_auto (int not null, default 0 -- a tag *definition* the analyzer created; draws the gear badge)
  - inserted_at
  - updated_at

- `song_tags`
  *Song<->tag associations (many-to-many). PK (song_id, tag_id).*
  - song_id (FK not null)
  - tag_id (FK not null, indexed)
  - source (text not null, default 'manual' -- 'auto' rows are the only ones a re-analysis may rewrite; the same tag can be machine-applied to one song and hand-applied to another, which is why this lives on the association)
  - confidence (real -- the model's score, kept for sorting and for explaining why a tag is there)
  - inserted_at

- `saved_searches`
  *A named query pinned to the sidebar. Stored as the query string, not a resolved song list, so a song that acquires the right tags next month joins it on its own.*
  - id
  - name (text not null)
  - query (text not null)
  - position (int not null)
  - inserted_at
  - updated_at

- `song_analysis`
  *One row per analyzed song.*
  - song_id (PK, FK)
  - model_version (text not null)
  - embedding (blob not null -- 200 float32s, the model's fingerprint of the track; every similarity feature runs on this)
  - activations (blob not null -- the raw 50 genre/mood float32s, kept so re-deriving auto-tags never requires re-analyzing audio)
  - axes (text not null -- classification-head scalars as JSON)
  - map_x, map_y (real -- cached UMAP projection, recomputed in bulk)
  - cluster_id (int, indexed -- cached k-means assignment)
  - analyzed_at

- `analysis_queue`
  *Work list for the background analyzer, persisted so a pass that takes hours survives quitting the app.*
  - song_id (PK, FK)
  - state (text not null -- 'pending' | 'running' | 'failed')
  - error (text)
  - attempts (int not null, default 0 -- after 3 the song stays as 'failed', visible and retryable, but stops being handed out)
  - queued_at

- `clusters`
  *Names for the auto-generated groups. `id` is the same number as `song_analysis.cluster_id`, so membership lives with the analysis and only the name lives here -- which is what lets a rename survive a re-clustering.*
  - id
  - name (text not null)
  - inserted_at

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
- ✅ Local audio analysis (MusiCNN embeddings, mood/genre scores)
- ✅ Similar songs, auto-tags, auto-playlists, the music map, and the facet browser
- ✅ Saved searches

## Wishlist (later steps)

"Utilities" menu with some useful utilities:

- Scan for any audiofiles in the audio library folder that aren't present as a song
- Scan for any songs in our DB whose audiofile can't be found
- Scan for any songs whose duration_seconds in the DB doesn't match the audiofile duration
- Scan for any songs that aren't in the "main library" list

Other:

- Detect/Prevent the app from being opened twice at the same time, to avoid conflicting writes to the sqlite DB.
- Volume equalizer - when enabled, per-song volume is adjusted so all songs have the same max volume.
- Right-click on a folder -> Scans -> "List duplicates of the same song" (in that list/folder). Opens a new window listing all duplicates found (for each, the song + the folder path). Click on any item to jump to it in the main window.
