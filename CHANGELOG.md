# Changelog

Notable changes at each version checkpoint. Dates are the release build dates.

## Unreleased

**Ludi now listens to your music.** A local audio-analysis pass (essentia.js for mel-spectrograms, a MusiCNN model on ONNX Runtime, both as WASM in a hidden window) fingerprints every song into 200 numbers plus genre, mood, and energy scores. Nothing leaves your machine and there are no API keys. It runs in the background from Settings -> Audio analysis, drops to a single worker while you're playing music, and its queue is persisted so quitting mid-pass loses nothing. Everything below is built on that:

- **Similar songs.** Right-click a song (or a selection) for the tracks that sound most like it.
- **Auto-tags.** Genre and mood tags applied from the model's scores, with thresholds calibrated against your own library's distribution rather than absolute cutoffs -- so "mellow" means mellow *for you*. Machine-applied tags carry a gear badge, and re-running the analysis only ever rewrites those; your hand-applied tags are never touched.
- **Auto-playlists.** Ludi clusters the library into groups, picks the number of groups by silhouette score, names each after the tags that are most over-represented in it, and lets you save any cluster as a real playlist.
- **Music map.** The whole library as a zoomable, pannable 2D landscape (UMAP over the embeddings) where similar music sits together, colored by cluster. Hover for a title, double-click to play, or shift-drag a lasso around a region and save what it caught as a playlist.
- **Facet browser.** Every tag in the current view with how many songs carry it. Click one to drill in and the list becomes "what else these songs tend to be", with unusually concentrated combinations marked by how much more common they are here than in the library at large. Hand any drill-down to the search box to refine or save it.
- **Saved searches.** Pin a query to the sidebar. It's saved as the query, not as a frozen list, so songs join and leave it on their own as tags change.
- **Sidebar tag chips are now scoped and counted.** They show only the tags present in what you're looking at, with a count each, and clicking them stacks up as filters instead of replacing each other.
- **Analysis progress** shows in the main window's sidebar while a pass runs, and Settings lists which songs failed and why.

Ludi is now **AGPL-3.0-or-later** rather than MIT: essentia.js is AGPL, and linking it makes the combined work AGPL too.

## 0.2.0 -- 2026-08-02

**Fixed: macOS reported the app as "damaged and can't be opened".** The 0.1.0 `.dmg` was unusable for anyone who downloaded it. electron-builder found no Developer ID certificate, silently skipped signing, and left the stock Electron binary's signature attached to a bundle it went on to rewrite -- so macOS saw a signature that no longer described the app and reported it as tampered-with, offering no way to override. Ludi is now ad-hoc signed, and the build fails outright if the signature doesn't seal the bundle. First launch still needs a one-time Control-click -> Open, since an ad-hoc signature isn't Apple-notarized.

Added:

- **Playlists.** Reference-only song lists in the sidebar. Dragging a song or folder into a playlist copies the reference rather than moving the file, so the same song can sit in the library and any number of playlists at once. Playlists are created from the sidebar's + menu, reordered by dragging, and played from the top on double-click. Deleting inside a playlist removes the reference; deleting in the Main Library is the permanent one, and it also pulls the song out of every playlist that referenced it.
- **Song tagging.** Free-form, color-coded tags. Tag chips live in the sidebar and colored pills in their own column; tag a song, a selection, or a whole folder (which applies to every song inside, recursively). Rename, recolor, reorder, and delete tags, or click a chip to search for it.
- **Tag and boolean search.** `tag=name` matches a tag exactly, and a new `NOT` operator (or `-` shorthand) supports absence queries like `tag=fav AND NOT tag=live`. Advanced Search gained a Tag condition with an is / is-not toggle.
- **A song edit panel** below the sidebar, for editing title, track number, artist, and album across a whole selection at once. It shows the total playtime of a multi-song selection, so selecting a folder answers "how long is this".
- **Drag songs out to Finder.** Hold Option while dragging a selection to copy the underlying audio files to the Desktop or a Finder folder.
- **Selectable, draggable search results** -- search results now behave like the main tree instead of being read-only, and carry a whole selection into a playlist.
- **Search is scoped to the list you were viewing** when you searched, and the header says so ("Search Results in {list}").
- **An About dialog** (Ludi -> About Ludi) showing the version and the git commit the build came from, plus a link to the README.
- The sidebar shows which playlist is currently playing, including when the queue started from a folder nested inside it.
- Times an hour or longer are shown as `1:04:09` instead of `64:09`, in the player and in the duration column.

Fixed:

- **Playback no longer dies partway through an unattended playlist.** The queue only advanced when a track ended cleanly, so anything that stopped a song without ending it -- a Bluetooth speaker dropping out, the output device changing, a stalled read -- left the player silent until the app was restarted. A watchdog now notices a track that has stopped making progress, resumes it where it died, and skips it if it keeps failing. If five tracks fail in a row it stops and tells you, rather than tearing silently through the rest of the queue.
- Ludi holds a power-save block while playing, so an idle Mac can't suspend the app mid-playlist, and its timers are no longer throttled when the window is hidden behind others.
- **Shuffle now actually shuffles.** It had been building a shuffled order that no play path ever used. Toggling it mid-song also keeps the current song playing instead of jumping the queue to an unrelated track.
- "Previous" restarts the current track when you're more than a second in, and only steps back a track from the very start -- matching every other music player.
- Tagging a song or dragging one into a playlist no longer blinks the list and throws the scroll position back to the top. Refreshes now patch the rows that actually changed instead of rebuilding the whole view.
- Dragging songs onto sidebar playlists no longer silently stops working after a tag chip is dragged and dropped somewhere that isn't another chip. That abandoned drag left a flag set that suppressed every playlist drop until the app was restarted.
- Arrow keys on the seek bar move a fixed 5 seconds instead of 1% of the song, which was minutes at a time in a long recording.
- Drag autoscroll no longer races away when dragging near the edge of the list -- speed now ramps with how far into the edge band the cursor is.
- Every dialog has a real title instead of a generic "Rename", and the tag color popover keeps itself on-screen near the bottom edge.

Development:

- Tag-driven releases: pushing a `v*` tag builds the `.dmg` on GitHub Actions and opens a draft release for review.

## 0.1.0 -- 2026-07-08

First packaged build. **Its `.dmg` is affected by the signing bug fixed in 0.2.0** -- use 0.2.0 or later.

- **Folder-tree library.** A Finder-like tree of nested folders that lives in Ludi's database, independent of where the audio files sit on disk. Drag and drop to reorder and reparent, including multi-selections, which preserve their relative order.
- **Import by drag and drop** from Finder, for single files or whole folders with their structure preserved. Duplicates are detected and skipped.
- **Library scan** -- finds and ingests audio files already sitting in the library folder, grouped by artist and album.
- **Playback** with loop modes, correct seeking in long songs (HTTP Range support), `.m4a` support, and a clear paused-vs-playing state.
- **macOS media keys** and Now Playing integration, plus keyboard navigation and playback hotkeys.
- **Search**, with an advanced query modal and flat or nested results.
- **Folder operations**: create, rename, batch rename, sort alphabetically, flatten, move into new folder, collapse/expand all.
- **Configurable, resizable columns** for track number, duration, artist, and album.
- Deleting a song moves its audio file to the macOS Trash rather than destroying it.
- Settings window, resizable sidebar, and song context-menu actions (Show in Finder, Copy file path).
- The UI was rebuilt in SolidJS, and dev, test, and live runs were isolated so they never share a database or music folder.
