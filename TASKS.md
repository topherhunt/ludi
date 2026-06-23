*See also the wishlist in [readme.md](http://readme.md).*

- [ ] Default to loop=on please.
- [ ] Add tagging support
  - Each song, and each folder/list, can be tagged. Items in a folder/list inherit its tags.
  - Show info about the selected item(s) in the bottom part of the left sidebar. Including all applied tags. Right-click a tag and click "Remove Tag" to remove it. Click the + next to tags to add a tag, by typing (with autocomplete).
  - Search bar (left sidebar, top) supports filtering by the presence / absence of a tag as well as booleans & parentheses so you can do things like `tag:fav AND (tag:instrumental OR tag:low-e)`

# Old notes

- 2026-02-12 Incorporate idea: Tags can do most of what I want groupings and playlists for.
  - like tags for `festive`, `christmas`, `low-key`, `meditative`, `dark`, `happy`, `high-e`, `⭐⭐⭐⭐⭐`, `⭐⭐⭐⭐` etc - any combination is possible.
- TODO: Dig up all my old notes & ideas for this app, copy them here, analyze w Claude.
- For music library: when viewing any given song in any list, or a selection of songs, if you're viewing the column for a facet / category (eg energy or genre) you can click on a dropdown arrow next to the current value to see all options, and click an option to set that new value for all selected songs.
- To add to my vision for a music library app: default "timeline view" similar to Google photos, where I can scroll back and see music / playlists I was listening to during specific periods. Chronology-first rather than alphabetical-first.

### Tasks

- Misc
  - Clicking in white space below Main Library in sidebar, should clear current selection in the playlist, similar to pressing esc.
    - Claude Code did this. It says: "Clicking on empty space in either location (sidebar or explorer container) now clears the playlist selection, matching the behavior of pressing Escape."
  - Media keys in other apps respect whichever media app was the most "recently played". Should we also here?
  - When dragging into the playlist (from a file or from list items selected), if within 3em of the top or bottom of the viewport, autoscroll at a slow linear speed up/down.
  - Support dragging in a folder - traverse and import all recursive contents.
  - When dragging in files, LIST any files that were skipped because unsupported types (just the # skipped, and list the first 10)
  - Fix bug: when you put songs into a folder, then you select everything & delete, songs within the subfolder do NOT have their audiofiles deleted.
  - Fix: if the playlist is tall enough to scroll, you're scrolled down and a new track starts playing, you're jumped to the top of the playlist. Maybe because the whole playlist re-renders? That shouldn't be necessary I think/thought.
    - On that note -- might the current JS architecture (or lack thereof) pose maintenance problems / code organization problems? Should we be refactoring this to use React or something? or is it OK as-is, are there advantages to this current approach?
  - Fix: if you double-click a song in a folder, it starts playback scoped to that folder. That should not happen, playback should be scoped to the whole playlist unless you specifically double-click the folder itself.
  - Fix bug: forward/back arrow keys should seek in current song even if the song is paused. Currently has no effect.
  - Support double-click on a playlist (incl Main Library) to start playback at the top.
  - Support dragging a selection of songs out to a Finder folder (copy the files).
  - On import: Warning message if any unsupported filetypes were dragged in, listing them and saying they'll be ignored.
  - Ensure importing .m4a and .ogg are supported; check behavior when unsupported filetype import is attempted.
  - Utilities -> "Scan for audiofiles, add all to library" (find better wording?)
- Support editing title, album, artist, and tags
- Support playlists
  - When dragging songs into a playlist from the outside world, also add them to Main Library. Every song added should be in the Main Library.
- Sanity & safety checks
  - Keep an append-only text log, of every song deleted & every song added. Also keep an append-only `audit_log` table of each ListItem or Song creation and deletion events.
  - Utilities -> "Health Check" window
    - *Shows various stats & flag any issues*
    - Total # songs in library
    - Total # songs added, ever (from audit_log)
    - Total # of songs deleted, ever (from audit_log)
    - List: last 10 songs deleted
    - ✅ All songs' audiofiles exist
    - ✅ No duplicates of the same audiofile
    - ✅ No audiofiles in the library folder that aren't linked to a song
    - ✅ Every song appears exactly once in the Main Library (none missing & no duplicates)
  - Utilities -> View Audit Log (shows a scrollable list of insertion/deletion log events, so you can scan for problems)
- Wishlist
  - Setting: "Delay between songs (in seconds, negative = crossfade)"
