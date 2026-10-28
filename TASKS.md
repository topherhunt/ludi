*See also the wishlist in [readme.md](http://readme.md).*

- [ ] The Loop button should have a dropdown arrow to its right. Tapping the button cycles to off -> loop all. The dropdown lets you additionally select "repeat 1" and "repeat album".
- [ ] You should be able to select multiple songs and right-click and then click delete and the delete prompt should list all the songs that that will apply to. Currently it scopes the deletion to just the the song that you right-clicked on and it ignores what your selection is.
- [ ] When you have one or more songs selected and you click into the tags edit field in the left sidebar and you type in part of a tag, it should in the list of populated tags down below. The the first item, like the closest matching item, should be selected. And if that's just create a new tag, then that should be selected so that you can see if you press enter, you can see what's going to happen. Because currently I don't see any way to see what's actually going to happen when I press enter. I just have to guess that if it's an exact match, it'll use that same tag. And if it's not an exact match, then it'll create a new tag. And I think that's what happens at least. And if you press the arrow keys to page up and down, it should it should move between the items, like it should like change your focus in the suggestions list. So for example, I can pick a different tag by picking part of it or typing part of it, and then using the arrow keys to go down to the right one and then press enter, and that one will be selected.
- [ ] In the bottom "now playing" bar, I should be able to click on the song title or artist to jump to that song in my Main Library, and select it, so I can then adjust its rating and tags etc.

- [ ] **Delete the folder code.** Song lists now group by album/artist/genre/year added instead of showing folders, and folder code is marked `DEPRECATED (folders)`. To finish: delete TreeView, TreeItem, BatchRenameModal, Explorer's folder handlers and their context-menu items (`SHOW_FOLDER_ACTIONS`), useKeyboard's folder branches, the sidebar's New Folder item, and the specs ignored or skipped in `playwright.config.js` and the e2e specs. Then decide what happens to existing folder rows in the DB: library scan and folder import still create them, and searches still match on folder names. Flatten them in a migration once nothing reads them.

- [x] Check if bug still occurs: when you put songs into a folder, then you select everything & delete, songs within the subfolder do NOT have their audiofiles deleted.
- [x] When I have a search applied in a particular playlist (eg the Main Library) and I switch to another playlist, it should clear the search. But then if I click back on teh original playlist, it should restore (a) the search that was applied and (b) my scroll position, so I can flip back and forth while transferring content from 1 filtered/searched list to another list, with minimal friction.
- [x] In search results, when you double-click to play a song, the current play queue should honor what's shown in that search result at the moment you double-clicked. If the search is later changed and thus the shown list of items changes, that's NOT reflected in the current play queue unless you double-click something else.
- [x] Also, double-clicking on a folder in search results should set the current play queue to JUST the contents of that folder. Currently it just collapse/expands the folder, fitting with the broader theme of "search results aren't treated as first-class citizens".
- [x] Right-click on selected song(s) should work even when you're in the search results list (with irrelevant / incoherent context menu options grayed out); currently it does nothing, you can't right-click on songs in the search results list.
- [x] Persist song metadata edits (title/artist/album/track) into the audio files' embedded tags. The edit panel currently writes to the DB only. NOTE: many-to-many app tags have no ID3 equivalent and will remain DB-only, which is fine.
- [ ] **(Capture a performance trace reproing this)** When I have a long list of search results, some weird delay bug is happening: if I scroll down a ways and then select ~10 songs and click and drag to the sidebar over a playlist, there's a multi-second long delay before the playlist highlights and I can drop the songs into that playlist. And then another multi-second-long delay before the highlight appears, indicating that the songs were successfully added to that playlist. What's going on here? The time duration maybe seems to scale to the # of songs I have selected.
- In any playlist (including in search results), when you double-click on a song, it should set the current play queue to the FULL shown playlist, NOT just the nearest parent folder that that song is in. Currently it just plays the direct children of that folder on loop, nothing in subfolders, and nothing outside of the folder. By contrast, when you double-click on a FOLDER itself (whether "real" DB entity or "virtual" search result grouping-folder) the current play queue should be set to just the contents of that folder (INCLUDING subfolders).

---

Unsure about these:

- Revisit the README features list. It seems pretty underwhelming when I look through it now, and it feels like it doesn't really do the app justice.
- [ ] Consider: Instead of collapse/expand carets like what we've been doing in the Main Library UI so far, what if clicking on a folder just zoomed into that folder, and you see a breadcrumb at top showing where you've zoomed into? More Google Drive style?
  - ...talk throguh w Claude-- have it look at my data structure -- is "putting songs into nested folders" even a useful concept, like at all? Would it be better to list everything flat, and use "ephemeral folders" to support collapsing songs in the same album, to make my library more navigable?
- You can right-click selected items and click "Move..." to open a pop-up that lists all folders in the Main Library, with their dropdown toggles so you can zoom in and select a specific folder you want to drill into.
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

# Old notes

- OMG I'm having a new brainwave about my music library app.
  - So first of all, it needs to be something that I can navigate and organize organically. So it's gonna be Claude Code Vibed Up Music Library app that kind of randomly picks songs for me and I give feedback on whether that's in the same genre and whether I like it. And I can give negative feedback of at least two different axes. It can be either I don't like this song, play it less. Or it can be this song, I like it, but it's not my mood right now. Um, or the opposite, I can say, I like this song, play it more, and or I can say this song really fits my mood right now. And so um I think Claude Code could help me plan out a way that the the app can use that input to build up a network, like a graph database of which songs are linked to which other songs. And then I can have some sort of visual or CLI based explorer or like a web view based explorer that allows me to navigate the relationships that I've built up between my music.

Also, are there a AI libraries that will listen to a music file and give information about how it sounds, what qualities or aesthetic characteristics it has, and what genres and moods it fits with, because maybe I could use AI to frickin' auto-categorize my library and then I just throw everything together and create a navigator which is already pre-populated with a terrain of the music that I have. And then I don't need to worry about manually inventing that terrain from scratch. It would be nice to have some feedback mechanisms so that I can organically adjust the terrain, but I want I want to be able to dump in a folder in there and have AI crunch through it, and organize my music by type and feel and mood. Mood is the word that really resonates with me most strongly right now.

> [*Claude*](https://claude.ai/chat/ebf3e97f-e1ec-41e2-aae4-8c883440f743): Yes, this is very doable! There are several libraries that do exactly this kind of audio analysis. Here's the landscape:

- **Essentia** is probably your best bet for the core analysis. It's open source (from Universitat Pompeu Fabra's Music Technology Group) and has pre-trained models that output mood, genre, danceability, energy, and dozens of other descriptors directly from audio files. It runs locally, which fits your data sovereignty preferences.
- **CLAP (Contrastive Language-Audio Pretraining)** is interesting for your terrain idea because it produces embeddings that live in a shared text-audio space. You could literally query "dreamy ambient" or "aggressive driving music" and find matches. The embeddings also cluster naturally by similarity, which would give you that terrain structure almost for free—just run UMAP or t-SNE on the embeddings and you get a 2D map.

- 2026-02-12 Incorporate idea: Tags can do most of what I want groupings and playlists for.
  - like tags for `festive`, `christmas`, `low-key`, `meditative`, `dark`, `happy`, `high-e`, `⭐⭐⭐⭐⭐`, `⭐⭐⭐⭐` etc - any combination is possible.

- TODO: Dig up all my old notes & ideas for this app, copy them here, analyze w Claude.

- when viewing any given song in any list, or a selection of songs, if you're viewing the column for a facet / category (eg energy or genre) you can click on a dropdown arrow next to the current value to see all options, and click an option to set that new value for all selected songs.

- To add to my vision for a music library app: default "timeline view" similar to Google photos, where I can scroll back and see music / playlists I was listening to during specific periods. Chronology-first rather than alphabetical-first.
