# Changelog

Notable changes at each version checkpoint. Dates are the release build dates.

## 0.5.0 -- 2026-08-16

**Repeat-one is behind a double-click now.** The loop button used to cycle off -> all -> one, so walking from "loop all" back to "off" landed on repeat-one on the way past, and repeat-one looks exactly like an ordinary loop until you notice you have heard the same song three times. A single click now toggles between off and loop-all only. Repeat-one takes a second click within five seconds; leaving it is always one click. The tooltip says so, since with repeat-one off the cycle there is nowhere else to find it.

**Fixed: a song whose file you deleted or renamed in the Finder could not be deleted from the library.** Playing it failed to load, which is expected, but the stall recovery kept retrying the dead track every few seconds and each retry raised another "File Not Found" alert. Alerts and confirmations share one modal, so every retry wiped out the delete confirmation before you could answer it, and the song could not be removed. A failed load whose file genuinely is not on disk now gives up instead of retrying: one alert, and the row deletes normally.

**New: "Copy files to a folder..." in the right-click menu.** Pick a folder (the chooser can make a new one) and the selected songs' audio files are copied into it -- the whole selection when the right-click landed inside it, the one row when it didn't. Folders export everything inside them, a song reachable two ways is still copied once, and a name that is already taken becomes `Song (2).m4a` rather than an overwrite. A summary says how many of how many landed and where, and lists anything that failed.

This is the drag-out-to-the-Finder feature without the drag. Dragging a selection out to the Desktop still works but still needs the Option key held, and that is a platform limit rather than a preference: Electron's native file drag has to cancel the HTML5 drag to start, so a single gesture can be an in-app drag or a file export, never both. Making the plain drag export files was tried and it takes out dropping songs onto playlists, reordering, and dropping into folders.

## 0.4.0 -- 2026-08-16

**Fixed: the Mac went to sleep a few songs into an unattended playlist.** Ludi has held a power-save block while playing since 0.2.0, but it released that block at the end of every track and only took it again once the next one had loaded and started. That gap is a fraction of a second, and it happens once per song -- so as soon as macOS's idle timer had run out, the very next track change handed it permission to sleep, typically three or four songs after you walked away. A single long song on loop never hit it, which is why it looked like shuffle or the Bluetooth speaker was to blame; neither was. The block is now held across the gap between tracks and only released once playback has actually been stopped for ten seconds.

**Fixed: a library full of auto-tags pushed the song edit panel off the bottom of the sidebar.** Analysis can produce fifty tags where there used to be five, and the sidebar grew to fit them all -- past the bottom of the window, taking the song edit panel and the analysis strip with it, with no scrollbar anywhere to reach them. The sidebar is now two regions: everything you browse with (the playlist tree, the AI sections, the tag chips) scrolls together, and the song edit panel and analysis strip are pinned below it where they can't be pushed off. Every chip is shown -- a long tag list costs you scrolling, nothing else.

**Sidebar tag chips are sorted by what you'd use them for.** Tags you applied by hand come first, alphabetically, because you go looking for those by name. The analyzer's tags follow, commonest in the current view first, because you don't know their names -- what you want from fifty auto-tags is what this playlist is mostly made of, with the one-song tail out of the way at the bottom. Chips no longer drag to reorder, since that order is now computed rather than stored.

**Fixed: analyzing a large library ran the machine out of memory, and failed nearly every song.** essentia.js's own mel-spectrogram helper leaks three WASM handles per frame -- roughly 35 MB per four-minute track, in a heap that never shrinks -- so each worker crept toward the 2 GB ceiling its WASM build is hard-capped at, aborted, and then failed every song handed to it afterwards. That is where "292 of 3901 analyzed, 3609 failed" came from, and with six workers doing it at once it was also enough to exhaust system RAM. The spectrogram is now computed by our own code that frees what it allocates, and the pass is bounded by constants instead of by library size: the worker pool is sized against a memory budget (at most 1 GB, or 12% of RAM), each worker is retired and replaced after 200 tracks or as soon as its heap grows past 192 MB, a worker that errors once is thrown away rather than reused, decoding is serialized, and only the first 10 minutes of any track is analyzed. See "What bounds the audio analysis" in the README.

**Failures show up while the pass is running, not after it.** The failure count and the list of what failed used to render only once the pass had stopped, so a run that was failing every song looked healthy for hours. Both now update live, in Settings and in the sidebar strip.

**Fixed: `npm run dev` and the test suite leaked a dev server every time they didn't exit cleanly.** Both spawned Vite detached and let it pick any free port, so a Ctrl-C at the wrong moment left a fully working server behind and the next run quietly moved to the next port up instead of colliding with it. Nothing ever failed, so they accumulated -- overnight, until the Mac ran out of RAM. Ludi's dev server now has a fixed port of its own (5273; tests use 5274) with `strictPort`, records its pid, kills whatever the previous run left behind before starting, and shuts down on every exit path rather than just the happy one.

**Fixed: the packaged app crashed on startup with "Cannot find module '../../shared/audio-model.json'".** The 0.3.0 build's `files` list never included `src/shared/`, so the analysis vocabulary and label files the main process reads were left out of the asar. Dev runs from source, which is why nothing caught it until the `.dmg` was installed. `tests/e2e/packaging-manifest.spec.js` now walks every `require` in the main process and fails if the target isn't covered by a packaging glob.

**Play counts and last-played dates.** Every song now carries both. A play is counted once you have actually listened to half the track (30 seconds is enough for anything longer) and what accumulates is listening time, so clicking down a list doesn't inflate the counts and seeking to the end doesn't buy a play. Both are searchable -- `plays>=5`, `plays=0` for everything you have never got to, `lastplayed>=2026-01-01` -- and both are conditions in Advanced Search, where Last played gets a date picker and reads "is on or after" rather than "is at least".

**Advanced Search compares every number, not just ratings.** Track # and Play count gained the same is-at-least / is-exactly / is-at-most operator Rating had, and the operator dropdown is wide enough for its labels. Choosing "Rated (any)" or "Unrated" now hides the operator instead of leaving a stale "is at least" beside a value that was always going to be tested for membership.

## 0.3.0 -- 2026-08-16

A checkpoint, not a build: 0.3.0 was never tagged, so everything below first reached a `.dmg` in 0.4.0.

**Star ratings.** A 1-5 star column in the song list, the thing the library was missing to answer "what do I actually like". Click a star to rate, click the same star again to clear it back to unrated, or press `1`-`5` to rate everything you have selected (`0` clears). Right-click offers the same as a menu. Ratings are searchable -- `rating>=4` for the good stuff, `rating=none` for what you haven't judged yet -- and Advanced Search gained a Rating condition with an is-at-least / is-exactly / is-at-most operator. Unrated is deliberately distinct from zero stars, so `rating<3` means "songs I don't like", not "everything I haven't got to". Settings can **import the ratings out of an existing Swinsian library**: it matches on filename first, then title, and shows you the counts and every track it couldn't place before it writes anything.

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
