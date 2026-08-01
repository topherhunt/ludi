*See also the wishlist in [readme.md](http://readme.md).*

- [ ] Fix shuffle, currently broken.
- (TO ENSURE) Search supports `tag=name` (presence), `NOT tag=name` / `-tag=name` (absence), plus booleans & parentheses, e.g. `tag=fav AND (tag=instrumental OR tag=low-e)`. Advanced Search has a Tag condition with an is/is-not toggle.
- 
- [ ] Support drag selected files (or files in selected folders) out to a finder folder, or to a G Drive folder in browser (?)
- [ ] Persist song metadata edits (title/artist/album/track) into the audio files' embedded tags. The edit panel currently writes to the DB only. NOTE: many-to-many app tags have no ID3 equivalent and will remain DB-only, which is fine.
- [ ] The media-key "last track", if you're more than 1 second into the current track, should jump to the start of this track, rather than literally going to the prev track.
- [ ] Consider: Instead of collapse/expand carets like what we've been doing in the Main Library UI so far, what if clicking on a folder just zoomed into that folder, and you see a breadcrumb at top showing where you've zoomed into? More Google Drive style?
  - ...talk throguh w Claude-- have it look at my data structure -- is "putting songs into nested folders" even a useful concept, like at all? Would it be better to list everything flat, and use "ephemeral folders" to support collapsing songs in the same album, to make my library more navigable?
- When viewing search results, you can select songs / items like you normally can. Currently selecting doesn't work when viewing search results.
- You can right-click selected items and click "Move..." to open a pop-up that lists all folders in the Main Library, with their dropdown toggles so you can zoom in and select a specific folder you want to drill into.
- Misc
  - Fix bug: forward/back arrow keys (on keyboard) should seek in current song by only 5s regardless of the length of the song. (For very long songs, currently it's skipping 7 mins at a time.)
  - When dragging into the playlist (from a file or from list items selected), if within 4em of the top or bottom of the viewport, autoscroll at a slow linear speed up/down.
  - Check if bug still occurs: when you put songs into a folder, then you select everything & delete, songs within the subfolder do NOT have their audiofiles deleted.
  - Fix: if you double-click a song in a folder, it starts playback scoped to that folder. That should not happen, playback should be scoped to the whole playlist unless you specifically double-click the folder itself.
  - ✅ Support double-click on a playlist (incl Main Library) to start playback at the top.
  - Support dragging a selection of songs out to a Finder folder (copy the files).
  - On import: Warning message if any unsupported filetypes were dragged in, listing them and saying they'll be ignored.
- Support editing title, album, artist, and tags
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
- Setting: "Delay between songs (in seconds, negative = crossfade)"
- [ ] Search syntax: support `sort=...` where sort values include: default (natural), random. Have a sort dropdown on the Advanced Search modal so this feature is easily discoverable.
- [ ] Support saving searches
- ✅ Support playlists
  - ✅ When dragging songs into a playlist from the outside world, also add them to Main Library. Every song added should be in the Main Library.

# Old notes

- OMG I'm having a new brainwave about my music library app.
  - So first of all, it needs to be something that I can navigate and organize organically. So it's gonna be Claude Code Vibed Up Music Library app that kind of randomly picks songs for me and I give feedback on whether that's in the same genre and whether I like it. And I can give negative feedback of at least two different axes. It can be either I don't like this song, play it less. Or it can be this song, I like it, but it's not my mood right now. Um, or the opposite, I can say, I like this song, play it more, and or I can say this song really fits my mood right now. And so um I think Claude Code could help me plan out a way that the the app can use that input to build up a network, like a graph database of which songs are linked to which other songs. And then I can have some sort of visual or CLI based explorer or like a web view based explorer that allows me to navigate the relationships that I've built up between my music.

- 

## Also, are there a AI libraries that will listen to a music file and give information about how it sounds, what qualities or aesthetic characteristics it has, and what genres and moods it fits with, because maybe I could use AI to frickin' auto-categorize my library and then I just throw everything together and create a navigator which is already pre-populated with a terrain of the music that I have. And then I don't need to worry about manually inventing that terrain from scratch. It would be nice to have some feedback mechanisms so that I can organically adjust the terrain, but I want I want to be able to dump in a folder in there and have AI crunch through it, and organize my music by type and feel and mood. Mood is the word that really resonates with me most strongly right now.

> [*Claude*](https://claude.ai/chat/ebf3e97f-e1ec-41e2-aae4-8c883440f743): Yes, this is very doable! There are several libraries that do exactly this kind of audio analysis. Here's the landscape:

- **Essentia** is probably your best bet for the core analysis. It's open source (from Universitat Pompeu Fabra's Music Technology Group) and has pre-trained models that output mood, genre, danceability, energy, and dozens of other descriptors directly from audio files. It runs locally, which fits your data sovereignty preferences.
- **CLAP (Contrastive Language-Audio Pretraining)** is interesting for your terrain idea because it produces embeddings that live in a shared text-audio space. You could literally query "dreamy ambient" or "aggressive driving music" and find matches. The embeddings also cluster naturally by similarity, which would give you that terrain structure almost for free—just run UMAP or t-SNE on the embeddings and you get a 2D map.

- 2026-02-12 Incorporate idea: Tags can do most of what I want groupings and playlists for.
  - like tags for `festive`, `christmas`, `low-key`, `meditative`, `dark`, `happy`, `high-e`, `⭐⭐⭐⭐⭐`, `⭐⭐⭐⭐` etc - any combination is possible.

- TODO: Dig up all my old notes & ideas for this app, copy them here, analyze w Claude.

- when viewing any given song in any list, or a selection of songs, if you're viewing the column for a facet / category (eg energy or genre) you can click on a dropdown arrow next to the current value to see all options, and click an option to set that new value for all selected songs.

- To add to my vision for a music library app: default "timeline view" similar to Google photos, where I can scroll back and see music / playlists I was listening to during specific periods. Chronology-first rather than alphabetical-first.
