# Changelog

Notable changes at each version checkpoint. Dates are the release build dates.

## 0.2.0 -- 2026-08-02

**Fixed: macOS reported the app as "damaged and can't be opened".** The 0.1.0 `.dmg` was unusable for anyone who downloaded it. electron-builder found no Developer ID certificate, silently skipped signing, and left the stock Electron binary's signature attached to a bundle it went on to rewrite -- so macOS saw a signature that no longer described the app and reported it as tampered-with, offering no way to override. Ludi is now ad-hoc signed, and the build fails outright if the signature doesn't seal the bundle. First launch still needs a one-time Control-click -> Open, since an ad-hoc signature isn't Apple-notarized.

Added:

- **Playlists.** Reference-only song lists in the sidebar. Dragging a song into a playlist copies the reference rather than moving the file, and search can be scoped to a single playlist.
- **Song tagging.** Tag chips in the sidebar and colored pills in their own column. Tag a song, a selection, or a whole folder; rename, recolor, reorder, and delete tags; click a chip to search for it. Advanced Search gained a Tag condition.
- **A song edit panel** for editing title, artist, and album.
- **Drag songs out to Finder.** Hold Option while dragging a selection to copy the underlying audio files to the Desktop or a Finder folder.
- **Selectable, draggable search results** -- search results now behave like the main tree instead of being read-only.
- The sidebar shows which playlist is currently playing.

Fixed:

- Tagging a song or dragging one into a playlist no longer blinks the list and throws the scroll position back to the top. Refreshes now patch the rows that actually changed instead of rebuilding the whole view.
- Dragging songs onto sidebar playlists no longer silently stops working after a tag chip is dragged and dropped somewhere that isn't another chip. That abandoned drag left a flag set that suppressed every playlist drop until the app was restarted.
- Shuffle now actually shuffles, and "previous" restarts the current track first, matching every other music player.
- Drag autoscroll no longer races away when dragging near the edge of the list.
- Every dialog has a real title instead of a generic one.

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
