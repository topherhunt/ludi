# Ludi

A fast, lightweight music library and player for macOS.

Ratings, tags, playlists and saved searches, plus an on-device audio model that finds similar songs, auto-tags by genre and mood, and maps your library. Everything runs locally.

Your library and playlists live in Ludi's database, independent of where the audio files sit on disk, so you can reorganize without moving files.

## Features

### Browse

- 🗂️ **Group and sort any list** by album, artist, genre or year added, and by any stack of fields. Each list remembers its own settings. Drag-reordering works in playlist order.
- 📦 **Collapsed groups show a summary** in each column: track range, total time, average rating, tags, and so on. Click a group to select its songs; its caret, or `→`/`←`, opens and closes it.
- 🧱 **Configurable columns.** Right-click a header to show or hide columns; drag its edge to resize.
- ↩️ **Back and forward** between screens.

### Organize

- 🎶 **Playlists** from anywhere: a lasso on the music map, a group of sound-alike songs, or songs dragged in. Each keeps its own grouping, search and scroll position.
- 🏷️ **Tags** on a song, a selection, or a whole album. Sidebar tag chips show counts and stack as filters.
- ⭐ **Star ratings.** Click a star, or press `1`-`5` (`0` clears) to rate the selection.
- ✏️ **Edit panel** for one song or many. Title, artist, album, track # and genre are written into the audio file too.

### Find

- 🔍 **Search** as you type, or build advanced queries on any field: `rating>=4`, `rating=none` (unrated), `plays=0`, `added>=2024-01-01`, with `AND`/`OR`/`NOT`.
- 📌 **Saved searches** in the sidebar stay live as your library changes.
- 📈 **Listening history.** Play counts and last-played dates, counted once you've heard half the track.

### Discover

Ludi analyzes every song locally with a MusiCNN model (no uploads, no API keys), in the background, resuming where it left off.

- 🧲 **Similar songs** for any song or selection.
- 🤖 **Auto-tags** for genre and mood, hidden unless you turn on "Show AI tags". Re-analysis never touches your own tags.
- 🫧 **Auto-playlists** (*Groups* in the sidebar): clusters of songs that sound alike, which you can save as playlists.
- 🗺️ **Music map.** A zoomable 2D map of your library. Double-click to play, or lasso a region into a playlist.
- 🔬 **Facet browser.** Drill into tags to see what else those songs tend to be.

### Listen

- ▶️ **Double-click to play** the list as shown, from a song or a group. Loop all loops the whole list.
- 🔀 **Shuffle and loop** apply to the very next song. Double-click the loop button to repeat one.
- ⌨️ **Keyboard and media keys** for playback, navigation, seeking and rating.
- ☕ **Keeps your Mac awake** through a playlist.

### Your files

- 📥 **Drag and drop import** copies files into your library folder.
- 🔄 **Library scan** imports files already in the library folder.
- 📤 **Copy files out** to any folder from the right-click menu, or Option-drag to Finder.
- 🗑️ **Deleted songs go to the Trash.**
- 🦢 **Swinsian import** brings over ratings, Grouping-field tags, date added and genre, with a preview first.

## Install

Requires an Apple Silicon Mac (M1 or later) running macOS 12 or later. There is no Intel build.

1. Download `Ludi-<version>-arm64.dmg` from the [Releases page](https://github.com/topherhunt/ludi/releases).
2. Open the `.dmg` and drag **Ludi** into your Applications folder.
3. **Allow it to open.** Ludi is signed with a self-signed certificate rather than a paid Apple Developer ID, so it isn't notarized and the first launch is blocked with a message that Apple could not verify it. Double-click Ludi, click **Done** on the warning, then open **System Settings › Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to the message about Ludi. Confirm with your password or Touch ID, then click **Open**.

   Alternatively, in Terminal: `xattr -dr com.apple.quarantine /Applications/Ludi.app`, then open it normally.

**Updating:** download the new `.dmg`, replace the app in Applications, and allow it to open as in step 3 (each new download is blocked once). Releases after 0.6.0 are all signed with the same certificate, so permissions you've granted (such as Accessibility, for the media keys) carry over. The first update from 0.6.0 or earlier asks for them once more; if the media keys stop working after an update anyway, remove Ludi from **Privacy & Security › Accessibility** with the **−** button and add it again.

Ludi keeps your music in `~/Music/Ludi Library` and its database in `~/.ludi/`.

Each release on the [Releases page](https://github.com/topherhunt/ludi/releases) links to the commits since the one before it.

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
# immediately -- prefer this while iterating on the UI. Serves on port 5273
# (tests use 5274), and reaps any dev server a previous run left behind.
npm run dev

# Run the e2e tests (Playwright, 5 parallel workers). Each worker gets a fresh
# throwaway database and library. Don't start a second run while one is going:
# they share the test Vite server, and the new run reaps the old one's.
npm test

# Run the unit tests (Vitest, watch mode)
npm run test:unit

# Build a packaged macOS app + .dmg (output in release/), without publishing
npm run release
```

The e2e tests drive the real app through Playwright for Electron. In test mode its windows stay hidden, its audio is muted, and it leaves your media keys, clipboard and Trash alone.

### Architecture

- Electron (Tauri was my first choice but it's not functional on MacOS yet)
- SolidJS for the UI layer
- SQLite for the music library DB
- Howler.js for audio playback
- music-metadata for reading tags from audio files, and taglib-wasm for writing edits back into them
- essentia.js (mel-spectrograms) + ONNX Runtime Web (MusiCNN inference) for audio analysis, both running as WASM in a hidden renderer window
- umap-js for projecting the analysis embeddings down to the 2D music map
- Thorough integration tests using Playwright for Electron

### What bounds the audio analysis

A library-wide pass is the most memory-hungry thing Ludi does, and it has to stay bounded by constants rather than by how big your library is. Every number lives in `src/renderer/analysis/limits.js`:

- **Workers**: `min(6, budget / 256 MB, cores - 2, songs left to do)`, where the budget is `min(1024 MB, 12% of system RAM)`. On a 16 GB Mac that's 4 workers holding at most 1 GB between them, whatever the queue looks like.
- **Worker lifetime**: retired and replaced after 200 tracks, or as soon as it reports an essentia heap over 192 MB, or on any error at all. An Emscripten `abort()` poisons the WASM module permanently, so a worker that has failed once will fail for every song after it -- retiring it is what stops one bad track becoming thousands of failures.
- **Per track**: files over 512 MB are skipped, and only the first 10 minutes of any track is analyzed (long enough for the fingerprint to be stable, short enough to cap the spectrogram).
- **Decoding is serialized.** Decoding is the page's own allocation, not a worker's, and running six at once was enough to push the renderer over on its own.

The pass reports the essentia heap size with every result, which is how the pool notices a worker growing. That growth used to be guaranteed: essentia.js's own `computeFrameWise()` leaks three WASM handles per frame, about 35 MB per four-minute track, and an Emscripten heap never shrinks. `src/renderer/analysis/mel-spectrogram.js` is that function rewritten to free what it allocates, with `tests/unit/mel-spectrogram.test.js` driving a real essentia build to prove both that the output is byte-identical and that the heap comes back flat.

### Releasing

Don't bump the version yourself; just commit and push. Run `npm test` and, within the hour, run:

```bash
bash scripts/release.sh
```

It refuses unless you're on a clean `main` that matches `origin/main`, `package.json` holds the latest released version, and the full e2e suite passed within the last hour (`tests/e2e/pass-stamp-reporter.js` records each passing run). It asks for the new version, runs the unit tests, then commits the version bump as "Cut vX.Y.Z" and pushes it. If a later step fails, rerunning with that commit at HEAD resumes. It then builds the `.dmg`, tests the packaged app, and asks before publishing it with `gh release create`, which also creates the tag. The release notes are a link comparing the previous tag with this one. The GitHub Actions workflow is manual-only, for checking that the build works on a clean runner.

`npm run release` signs the app with the self-signed "Ludi Signing" certificate (`build.mac.identity`), so every release has the same code identity and macOS keeps users' permission grants across updates. Create the cert once with `bash scripts/make-signing-cert.sh` (writes to your login keychain), and back it up by exporting it from Keychain Access as a `.p12`: releases signed with a different cert make every user re-grant permissions. Without the cert, `npm run release` fails (`forceCodeSigning`); the CI workflow signs ad-hoc with `-c.mac.identity=-` instead.

The `afterSign` hook in `scripts/verify-signature.js` then verifies the signature, failing the build rather than shipping a bundle macOS will reject. This matters: if electron-builder skips signing, it leaves the stock Electron linker signature attached to a bundle it then rewrites. macOS reads that as tampering and tells the user the app is "damaged and can't be opened" -- with no way to override, which is strictly worse than being unsigned. `tests/e2e/packaged-app.spec.js` checks that the signature seals the bundle, that it comes from the "Ludi Signing" cert, and that the signed app actually launches.

### Data locations

The app runs in one of three isolated modes, so dev/test/live never share a database or music folder (`LUDI_DB_PATH` overrides the database path):

| Mode | Trigger | Database (`~/.ludi/`) | Music library (`~/Music/`) |
| --- | --- | --- | --- |
| live | packaged `.dmg` | `ludi-library-live.sqlite` | `Ludi Library` |
| dev | `npm run dev`, `npm start` | `ludi-library-dev.sqlite` | `Ludi Library Dev` |
| test | `npm test` | a temp dir per test worker (`LUDI_TEST_HOME`) | the same temp dir |

### The SQLite DB schema

- `lists`\
  *Represents a playlist (such as the mandatory "Main Library" list) or a subfolder within a list. Subfolders are deprecated: song lists group by album instead, and the folder code is due for removal (see TASKS.md). The app auto-creates one mandatory playlist with id=0, position=0, and title="Main Library". For now, root-level playlists will be ordered in the sidebar using the* `sidebar_position` *field but long-term we may need a* `sidebar_items` *table.*
  - id
  - title
  - is_subfolder (not null)
  - sidebar_position (null if is_subfolder)
  - inserted_at
  - updated_at

- `list_items`\
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
  - genre (text, nullable -- mirrors the file's genre tag)
  - date_added (text, YYYY-MM-DD in local time -- Ludi-only, editable, distinct from inserted_at)
  - file_path (text not null, unique constraint)
  - duration_seconds (int not null)
  - inserted_at
  - updated_at

- `tags`
  - id
  - name (text not null, unique COLLATE NOCASE)
  - color (text not null)
  - position (int not null -- creation order; the sidebar sorts chips itself, hand-applied ones alphabetically and auto ones by count)
  - is_auto (int not null, default 0 -- a tag *definition* the analyzer created; draws the gear badge)
  - inserted_at
  - updated_at

- `song_tags`\
  *Song<->tag associations (many-to-many). PK (song_id, tag_id).*
  - song_id (FK not null)
  - tag_id (FK not null, indexed)
  - source (text not null, default 'manual' -- 'auto' rows are the only ones a re-analysis may rewrite; the same tag can be machine-applied to one song and hand-applied to another, which is why this lives on the association)
  - confidence (real -- the model's score, kept for sorting and for explaining why a tag is there)
  - inserted_at

- `saved_searches`\
  *A named query pinned to the sidebar. Stored as the query string, not a resolved song list, so a song that acquires the right tags next month joins it on its own.*
  - id
  - name (text not null)
  - query (text not null)
  - position (int not null)
  - inserted_at
  - updated_at

- `song_analysis`\
  *One row per analyzed song.*
  - song_id (PK, FK)
  - model_version (text not null)
  - embedding (blob not null -- 200 float32s, the model's fingerprint of the track; every similarity feature runs on this)
  - activations (blob not null -- the raw 50 genre/mood float32s, kept so re-deriving auto-tags never requires re-analyzing audio)
  - axes (text not null -- classification-head scalars as JSON)
  - map_x, map_y (real -- cached UMAP projection, recomputed in bulk)
  - cluster_id (int, indexed -- cached k-means assignment)
  - analyzed_at

- `analysis_queue`\
  *Work list for the background analyzer, persisted so a pass that takes hours survives quitting the app.*
  - song_id (PK, FK)
  - state (text not null -- 'pending' | 'running' | 'failed')
  - error (text)
  - attempts (int not null, default 0 -- after 3 the song stays as 'failed', visible and retryable, but stops being handed out)
  - queued_at

- `clusters`\
  *Names for the auto-generated groups.* `id` *is the same number as* `song_analysis.cluster_id`*, so membership lives with the analysis and only the name lives here -- which is what lets a rename survive a re-clustering.*
  - id
  - name (text not null)
  - inserted_at

Notes on implementation:

- No DB-layer deletion cascade. Handle this via JS app logic.

## Milestones

- ✅ Basic Electron app skeleton, basic integration test harness
- ✅ Drag-and-drop import, playback, drag-and-drop reordering, selecting & deleting songs
- ✅ Media buttons support
- ✅ Folders (since replaced by grouping)
- ✅ Hotkeys for playlist navigation & playback
- ✅ Configurable columns for track #, duration, artist, album, and tags
- ✅ Refactor all UI to SolidJS for performance & easier maintenance
- ✅ Searching & filtering
- ✅ Song tagging
- ✅ Playlists
- ✅ Local audio analysis (MusiCNN embeddings, mood/genre scores)
- ✅ Similar songs, auto-tags, auto-playlists, the music map, and the facet browser
- ✅ Saved searches
- ✅ Star ratings, listening history, and the Swinsian import
- ✅ Edits written back into the audio files
- ✅ Grouping and sorting every song list, with genre and date added

## Wishlist (later steps)

"Utilities" menu with some useful utilities:

- Scan for any songs in our DB whose audiofile can't be found
- Scan for any songs whose duration_seconds in the DB doesn't match the audiofile duration
- Scan for any songs that aren't in the "main library" list

Other:

- Detect/Prevent the app from being opened twice at the same time, to avoid conflicting writes to the sqlite DB.
- Volume equalizer - when enabled, per-song volume is adjusted so all songs have the same max volume.
- Right-click on a playlist -> Scans -> "List duplicates of the same song" (in that playlist). Opens a new window listing all duplicates found. Click on any item to jump to it in the main window.
