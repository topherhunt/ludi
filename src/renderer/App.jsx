import { createSignal, createEffect, onMount, onCleanup, Show, createRoot } from 'solid-js';
import { Sidebar } from './components/Sidebar.jsx';
import { Explorer } from './components/Explorer.jsx';
import { PlayerControls } from './components/PlayerControls.jsx';
import { AlertModal, ConfirmModal, RenameModal } from './components/Modal.jsx';
import { DuplicateSongsModal } from './components/DuplicateSongsModal.jsx';
import { AboutModal } from './components/AboutModal.jsx';
import {
  alertModalState,
  confirmModalState,
  renameModalState,
  showRenameModal,
  showAlert,
  hideAlertModal,
  hideConfirmModal,
  hideRenameModal,
} from './stores/modals.js';
import {
  currentListId,
  setCurrentListId,
  clearSelection,
} from './stores/navigation.js';
import { applySettingsFromIPC } from './stores/columns.js';
import { refreshTags } from './stores/tags.js';
import { refreshSavedSearches } from './stores/savedSearches.js';
import { refreshClusters } from './stores/clusters.js';
import { listTitles } from './stores/viewHistory.js';
import {
  playlist,
  setCurrentPlaylist,
  currentTrackIndex,
  setCurrentTrackIndex,
  currentSongFromPlaylist,
  currentPlayingSongId,
  setCurrentPlayingSongId,
  setCurrentPlayingItemId,
  setPlayingRootListId,
  isPlaying,
  setIsPlaying,
  hasNextTrack,
  hasPreviousTrack,
  loopMode,
} from './stores/playback.js';
import { getAudioPlayer } from './hooks/useAudio.js';
import { isSearching, searchRootListId, searchResultsInDisplayOrder, searchFolderSongs } from './stores/search.js';
import { isShowingSimilar, similarResults } from './stores/similar.js';
import { isShowingCluster, clusterSongs } from './stores/clusters.js';
import { mapOpen, mapPointsNearestTo } from './stores/musicMap.js';
import { getSongsInList, getSong, getRootListId, recordSongPlay } from './utils/api.js';

// How long playback may be stopped before we let macOS suspend the app again.
// Long enough to cover loading the next track over a slow disk or a network
// volume, short enough that a paused app isn't holding the machine awake in any
// way a person would notice.
const PLAYBACK_GAP_MS = 10000;

// Tests shorten the window so a deliberate pause releases the block inside one
// test, the same way they shorten the stall timeout.
const playbackGapMs = () => window.__ludiPlaybackGapMs || PLAYBACK_GAP_MS;

let playbackGapTimer = null;

/**
 * Main App component
 */
export function App() {
  // Current song info for display
  const [songTitle, setSongTitle] = createSignal('');
  const [songArtist, setSongArtist] = createSignal('');

  // Derived rather than set on sidebar clicks, so Back/Forward retitle too.
  const listTitle = () => listTitles().get(currentListId());

  const [isAboutOpen, setIsAboutOpen] = createSignal(false);

  // Resizable sidebar width (persisted across restarts via localStorage)
  const SIDEBAR_MIN = 150;
  const SIDEBAR_MAX = 600;
  const storedWidth =
    typeof localStorage !== 'undefined'
      ? parseInt(localStorage.getItem('ludi-sidebar-width'), 10)
      : NaN;
  const [sidebarWidth, setSidebarWidth] = createSignal(
    Number.isFinite(storedWidth)
      ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, storedWidth))
      : 200
  );

  const startSidebarResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth();
    document.body.classList.add('resizing-sidebar');

    const onMove = (ev) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-sidebar');
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ludi-sidebar-width', String(sidebarWidth()));
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Explorer refetch function (captured when Explorer is ready)
  let explorerRefetch = null;

  // Get audio player (singleton)
  const player = getAudioPlayer();

  // Keep the OS "Now Playing" media session in sync. macOS only routes the
  // hardware next/previous-track keys to the app that owns an active media
  // session with action handlers (set in the media-key onMount below); without
  // this, only play/pause works -- Chromium binds that key to the <audio>
  // element by default, but next/prev have no default and need this.
  const updateMediaSession = (state) => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: songTitle() || 'Unknown',
      artist: songArtist() || '',
    });
    navigator.mediaSession.playbackState = state;
  };

  // Set up audio player callbacks
  onMount(() => {
    player.onEnd(handleTrackEnd);
    player.onError((err) => console.error('Audio error:', err));
    player.onStall(handlePlaybackStall);
    player.onPlay(() => {
      notePlaybackStarted();
      updateMediaSession('playing');
    });
    // Listening history. Nothing on screen reads it yet, so there is nothing to
    // refresh -- the count is picked up by the next search that asks for it.
    player.onPlayCounted((songId) => recordSongPlay(songId));
    player.onPause(() => updateMediaSession('paused'));
  });

  // Hold a power-save block while playing so an idle Mac doesn't suspend the
  // app out from under an unattended playlist. The screen is still free to
  // sleep -- 'prevent-app-suspension' only keeps the system (and us) running.
  //
  // The block has to survive the gap BETWEEN tracks, which is why the release
  // is delayed. `isPlaying` goes false the moment a track ends and only comes
  // back once the next one has loaded and started, so releasing on the falling
  // edge dropped the block for a fraction of a second at every single track
  // boundary. Once macOS's idle timer has already run out -- three or four
  // songs into a playlist you walked away from -- that fraction of a second is
  // all it needs to sleep the machine mid-playlist. A single song on loop never
  // hit it because it has no boundaries to speak of.
  //
  // So a stop only reaches the main process if nothing has resumed within the
  // grace window. Holding the block for a few extra seconds after a deliberate
  // pause costs nothing; dropping it for 200ms between songs costs the party.
  createEffect(() => {
    const playing = isPlaying();
    clearTimeout(playbackGapTimer);
    if (playing) {
      window.electronAPI?.setPlaybackActive?.(true);
    } else {
      playbackGapTimer = setTimeout(
        () => window.electronAPI?.setPlaybackActive?.(false),
        playbackGapMs(),
      );
    }
  });
  onCleanup(() => clearTimeout(playbackGapTimer));

  // Listen for column settings changes from Settings window
  onMount(() => {
    const cleanup = window.electronAPI?.onColumnSettingsChanged?.((settings) => {
      applySettingsFromIPC(settings);
    });
    onCleanup(() => cleanup?.());
  });

  // Refresh the tree when songs are ingested from the Settings window scan
  onMount(() => {
    window.electronAPI?.onLibraryChanged?.(() => {
      explorerRefetch?.();
    });
  });

  // "About Ludi" in the app menu
  onMount(() => {
    window.electronAPI?.onShowAbout?.(() => setIsAboutOpen(true));
  });

  // Load the defined tags, the saved searches and the groups at startup
  onMount(() => {
    refreshTags();
    refreshSavedSearches();
    refreshClusters();
  });

  // Listen for media key events (play/pause, next, previous)
  onMount(() => {
    window.electronAPI?.onMediaKey?.((action) => {
      switch (action) {
        case 'play-pause':
          togglePlayPause();
          break;
        case 'next':
          handleNext();
          break;
        case 'previous':
          handlePrevious();
          break;
      }
    });

    // Route the OS Now Playing controls / hardware media keys to the same
    // handlers. This is what actually makes the next/previous keys work on
    // macOS (the globalShortcut registrations in main.js do not fire there).
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
    }
  });

  // Recovery for a track that failed or stopped making progress -- a Bluetooth
  // speaker dropping out, the output device changing, a stream that stops
  // delivering. None of those fire 'ended', so nothing advanced the queue and
  // the whole playlist went quiet until the app was restarted.
  //
  // Retry the track once from where it died (a fresh element and a fresh
  // request is what recovers a dead output device), then give up on it and move
  // on. If several tracks in a row never play at all, stop and say so rather
  // than tearing silently through the queue.
  const MAX_RETRIES_PER_TRACK = 1;
  const MAX_CONSECUTIVE_DEAD_TRACKS = 5;
  let awaitingRetry = false;
  let stallRetries = 0;
  let consecutiveDeadTracks = 0;

  // A track that starts playing clears its retry budget -- but only when it was
  // started by the queue or the user, not when it is the retry itself. Counting
  // the retry's own successful start would let one broken track retry forever.
  const notePlaybackStarted = () => {
    consecutiveDeadTracks = 0;
    if (awaitingRetry) awaitingRetry = false;
    else stallRetries = 0;
  };

  const handlePlaybackStall = ({ songId, position, reason }) => {
    const song = currentSongFromPlaylist();
    if (!song || song.id !== songId) return; // a stale report for a track we already left

    if (stallRetries < MAX_RETRIES_PER_TRACK) {
      stallRetries++;
      awaitingRetry = true;
      console.error(`Playback recovery: retrying "${song.title}" from ${Math.floor(position)}s (${reason})`);
      player.playSong(song.id, { startAt: position });
      return;
    }

    consecutiveDeadTracks++;
    if (consecutiveDeadTracks >= MAX_CONSECUTIVE_DEAD_TRACKS) {
      console.error(`Playback recovery: ${consecutiveDeadTracks} tracks failed in a row, stopping`);
      player.stop();
      showAlert(
        '<i class="bi bi-exclamation-diamond" style="margin-right: 8px;"></i>Playback Stopped',
        `<p>Several songs in a row failed to play (${reason}).</p><p>Check that your audio output device is still connected.</p>`
      );
      return;
    }

    console.error(`Playback recovery: giving up on "${song.title}", skipping to the next track`);
    handleTrackEnd();
  };

  // Handle track end - play next, loop, or stop
  const handleTrackEnd = () => {
    // Loop One: replay the same song
    if (loopMode() === 'one') {
      playCurrentTrack();
      return;
    }

    // Otherwise, try to advance to next track
    const pl = playlist();
    const idx = currentTrackIndex();

    if (idx < pl.length - 1) {
      // Not at end, go to next
      setCurrentTrackIndex(idx + 1);
      playCurrentTrack();
    } else if (loopMode() === 'all') {
      // At end with loop all: wrap to beginning
      setCurrentTrackIndex(0);
      playCurrentTrack();
    } else {
      // At end, no loop: stop playback
      setIsPlaying(false);
      setCurrentPlayingSongId(null);
      setCurrentPlayingItemId(null);
    }
  };

  // Play a song by ID
  const playSong = async (song) => {
    try {
      // Update display info
      setSongTitle(song.title || 'Unknown');
      setSongArtist(song.artist || '');

      // Which row is playing. A playlist can hold the same song twice, so the
      // song id alone can't identify the row that should be highlighted.
      setCurrentPlayingItemId(song.item_id);

      // Use the audio player's playSong method which handles loading and playing
      const success = await player.playSong(song.id);
      if (!success) {
        console.error('Failed to play song:', song.id);
      }
    } catch (err) {
      console.error('Error playing song:', err);
    }
  };

  // Play current track from playlist. `currentTrackIndex` is a position in the
  // queue order, which shuffle reorders -- so the song is always resolved
  // through the store rather than indexed out of `playlist()` directly.
  const playCurrentTrack = async () => {
    const song = currentSongFromPlaylist();
    if (song) await playSong(song);
  };

  // Handle play folder
  const handlePlayFolder = async (listId) => {
    const songs = await getSongsInList(listId);
    if (songs.length === 0) return;

    setCurrentPlaylist(songs, 0, listId);
    setPlayingRootListId(await getRootListId(listId));
    await playCurrentTrack();
  };

  // Queue the rows a results view shows, as they stand right now. The queue is a
  // snapshot: editing the search afterwards changes what's shown, not what's
  // playing. `rootListId` is the sidebar list to mark as playing, if any.
  const playRows = async (hits, itemId, rootListId) => {
    const songs = hits.map((hit) => ({
      item_id: hit.item_id,
      id: hit.song_id,
      title: hit.title,
      artist: hit.artist,
      album: hit.album,
      duration_seconds: hit.duration_seconds,
    }));
    const songIndex = itemId === null ? 0 : songs.findIndex((s) => s.item_id === itemId);
    if (songIndex === -1) throw new Error(`Item ${itemId} is not in the rows shown`);

    setCurrentPlaylist(songs, songIndex, rootListId);
    setPlayingRootListId(rootListId);
    await playCurrentTrack();
  };

  // A virtual folder in the nested search view plays just its own hits.
  const handlePlaySearchFolder = (listId) => playRows(searchFolderSongs(listId), null, searchRootListId());

  const mapPointsAsRows = (points) => points.map((point) => ({
    item_id: point.itemId,
    song_id: point.songId,
    title: point.title,
    artist: point.artist,
    album: point.album,
    duration_seconds: point.durationSeconds,
  }));

  // Handle play song in context. Identified by its list_items id, not its song
  // id -- the same song can appear more than once in one playlist. The context
  // is the whole playlist the song sits in (every folder, collapsed or not), or
  // the rows of whichever results view is showing.
  const handlePlaySong = async (itemId, parentListId) => {
    // Similar songs, groups and the map aren't any one sidebar list.
    if (isShowingSimilar()) return playRows(similarResults(), itemId, null);
    if (isShowingCluster()) return playRows(clusterSongs(), itemId, null);
    if (mapOpen()) return playRows(mapPointsAsRows(mapPointsNearestTo(itemId)), itemId, null);
    if (isSearching()) return playRows(searchResultsInDisplayOrder(), itemId, searchRootListId());

    const rootListId = await getRootListId(parentListId);
    const songs = await getSongsInList(rootListId);
    const songIndex = songs.findIndex((s) => s.item_id === itemId);
    if (songIndex === -1) throw new Error(`Item ${itemId} is not in list ${rootListId}`);

    setCurrentPlaylist(songs, songIndex, rootListId);
    setPlayingRootListId(rootListId);
    await playCurrentTrack();
  };

  // Toggle play/pause
  const togglePlayPause = () => {
    if (isPlaying()) {
      player.pause();
    } else if (playlist().length > 0) {
      if (currentTrackIndex() < 0) {
        setCurrentTrackIndex(0);
        playCurrentTrack();
      } else {
        player.play();
      }
    }
  };

  // Handle next track (manual navigation - always moves to next song)
  const handleNext = async () => {
    const pl = playlist();
    if (pl.length === 0) return;

    const idx = currentTrackIndex();
    const loop = loopMode();

    if (idx < pl.length - 1) {
      // Not at end, go to next
      setCurrentTrackIndex(idx + 1);
    } else if (loop === 'all' || loop === 'one') {
      // At end with any loop mode: wrap to beginning
      setCurrentTrackIndex(0);
    } else {
      // At end, no loop: do nothing
      return;
    }
    await playCurrentTrack();
  };

  // Once you're this far into a track, "previous" restarts it instead of
  // stepping back a song -- the behavior every other music player has.
  const RESTART_TRACK_AFTER_SECONDS = 1;

  // Handle previous track (restart the current song, or step back to the one
  // before it if we're still at the very start)
  const handlePrevious = async () => {
    const pl = playlist();
    if (pl.length === 0) return;

    if (player.currentTime() > RESTART_TRACK_AFTER_SECONDS) {
      player.seek(0);
      return;
    }

    const idx = currentTrackIndex();
    const loop = loopMode();

    if (idx > 0) {
      // Not at beginning, go to previous
      setCurrentTrackIndex(idx - 1);
    } else if (loop === 'all' || loop === 'one') {
      // At beginning with any loop mode: wrap to end
      setCurrentTrackIndex(pl.length - 1);
    } else {
      // At beginning, no loop: do nothing
      return;
    }
    await playCurrentTrack();
  };

  // Seek to percentage
  const seekToPercent = (percent) => {
    player.seekToPercent(percent);
  };

  // Handle seek from keyboard (relative seek in seconds)
  const handleSeek = (seconds) => {
    const current = player.currentTime();
    const dur = player.duration();
    const newTime = Math.max(0, Math.min(dur, current + seconds));
    player.seek(newTime);
  };

  // Set volume percentage
  const setVolumePercent = (percent) => {
    player.setVolumePercent(percent);
  };

  // Toggle mute
  const toggleMute = () => {
    player.toggleMute();
  };

  // Handle list change from sidebar
  const handleListChange = (listId) => {
    const sameList = listId === currentListId();
    setCurrentListId(listId);
    clearSelection();

    // If clicking on the same list, force a refetch (user might want to refresh)
    if (sameList && explorerRefetch) {
      explorerRefetch();
    }
  };

  // Collapse / expand every folder in the explorer tree. Lives here (not in the
  // Explorer) so the sidebar header buttons and the folder context menu share it.
  const setAllFoldersExpanded = async (isExpanded) => {
    const folders = document.querySelectorAll('[data-folder-id]');
    for (const folder of folders) {
      await window.electronAPI?.updateFolderExpanded?.({
        listId: parseInt(folder.dataset.folderId),
        isExpanded,
      });
    }
    explorerRefetch?.();
  };
  const handleCollapseAll = () => setAllFoldersExpanded(false);
  const handleExpandAll = () => setAllFoldersExpanded(true);

  // Handle new folder from sidebar
  const handleNewFolder = async () => {
    // Get position for new folder (end of current list)
    const items = await window.electronAPI?.getListItems?.(currentListId()) || [];
    const position = items.length;

    showRenameModal('New Folder', async (folderName) => {
      await window.electronAPI?.addFolder?.({
        parentListId: currentListId(),
        position,
        title: folderName,
      });
      explorerRefetch?.();
      hideRenameModal();
    }, 'Add Folder In Playlist');
  };

  return (
    <div class="app-container" style={{ '--sidebar-width': `${sidebarWidth()}px` }}>
      <Sidebar
        onListChange={handleListChange}
        onNewFolder={handleNewFolder}
        onPlayFolder={handlePlayFolder}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
      />

      {/* Draggable divider to resize the sidebar */}
      <div
        class="sidebar-resizer qa-sidebar-resizer"
        onMouseDown={startSidebarResize}
      />


      <Explorer
        listTitle={listTitle()}
        onPlayFolder={handlePlayFolder}
        onPlaySong={handlePlaySong}
        onPlaySearchFolder={handlePlaySearchFolder}
        onSeek={handleSeek}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        onRefetchReady={(fn) => {
          explorerRefetch = fn;
          // Expose for testing
          if (typeof window !== 'undefined') {
            window.refreshExplorer = fn;
          }
        }}
      />

      <PlayerControls
        songTitle={songTitle()}
        songArtist={songArtist()}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        isMuted={player.isMuted}
        isLoading={player.isLoading}
        togglePlayPause={togglePlayPause}
        seekToPercent={seekToPercent}
        setVolumePercent={setVolumePercent}
        toggleMute={toggleMute}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onSeekBy={handleSeek}
      />

      {/* Alert Modal */}
      <Show when={alertModalState().isOpen}>
        <AlertModal
          open={true}
          title={alertModalState().title}
          message={alertModalState().message}
          dialogClass={alertModalState().dialogClass}
          onClose={hideAlertModal}
        />
      </Show>

      {/* Confirm Modal */}
      <Show when={confirmModalState().isOpen}>
        <ConfirmModal
          open={true}
          title={confirmModalState().title}
          message={confirmModalState().message}
          onResponse={(confirmed) => {
            if (confirmed) {
              confirmModalState().onConfirm?.();
            }
            hideConfirmModal();
          }}
        />
      </Show>

      {/* Duplicate-songs dialog for adds into a playlist */}
      <DuplicateSongsModal />

      {/* About dialog, opened from the app menu */}
      <AboutModal open={isAboutOpen()} onClose={() => setIsAboutOpen(false)} />

      {/* Rename Modal */}
      <Show when={renameModalState().isOpen}>
        <RenameModal
          open={true}
          title={renameModalState().title}
          value={renameModalState().defaultValue}
          onSubmit={(value) => {
            renameModalState().onConfirm?.(value);
          }}
          onCancel={hideRenameModal}
        />
      </Show>
    </div>
  );
}
