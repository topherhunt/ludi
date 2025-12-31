import { createSignal, onMount, onCleanup, Show, createRoot } from 'solid-js';
import { Sidebar } from './components/Sidebar.jsx';
import { Explorer } from './components/Explorer.jsx';
import { PlayerControls } from './components/PlayerControls.jsx';
import { AlertModal, ConfirmModal, RenameModal } from './components/Modal.jsx';
import {
  alertModalState,
  confirmModalState,
  renameModalState,
  showRenameModal,
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
import {
  playlist,
  setPlaylist,
  currentTrackIndex,
  setCurrentTrackIndex,
  currentPlayingSongId,
  setCurrentPlayingSongId,
  isPlaying,
  setIsPlaying,
  hasNextTrack,
  hasPreviousTrack,
  loopMode,
} from './stores/playback.js';
import { getAudioPlayer } from './hooks/useAudio.js';
import { getSongsInList, getSong } from './utils/api.js';

/**
 * Main App component
 */
export function App() {
  // Current song info for display
  const [songTitle, setSongTitle] = createSignal('');
  const [songArtist, setSongArtist] = createSignal('');

  // List title for explorer header
  const [listTitle, setListTitle] = createSignal('Main Library');

  // Explorer refetch function (captured when Explorer is ready)
  let explorerRefetch = null;

  // Get audio player (singleton)
  const player = getAudioPlayer();

  // Set up audio player callbacks
  onMount(() => {
    player.onEnd(handleTrackEnd);
    player.onError((err) => console.error('Audio error:', err));
  });

  // Listen for column settings changes from Settings window
  onMount(() => {
    const cleanup = window.electronAPI?.onColumnSettingsChanged?.((settings) => {
      applySettingsFromIPC(settings);
    });
    onCleanup(() => cleanup?.());
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
  });

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
    }
  };

  // Play a song by ID
  const playSong = async (song) => {
    try {
      // Update display info
      setSongTitle(song.title || 'Unknown');
      setSongArtist(song.artist || '');

      // Use the audio player's playSong method which handles loading and playing
      const success = await player.playSong(song.id);
      if (!success) {
        console.error('Failed to play song:', song.id);
      }
    } catch (err) {
      console.error('Error playing song:', err);
    }
  };

  // Play current track from playlist
  const playCurrentTrack = async () => {
    const idx = currentTrackIndex();
    const list = playlist();

    if (idx >= 0 && idx < list.length) {
      await playSong(list[idx]);
    }
  };

  // Handle play folder
  const handlePlayFolder = async (listId) => {
    const songs = await getSongsInList(listId);
    if (songs.length === 0) return;

    setPlaylist(songs);
    setCurrentTrackIndex(0);
    await playCurrentTrack();
  };

  // Handle play song in context
  const handlePlaySong = async (songId, parentListId) => {
    // Get all songs in the parent list to build playlist
    const songs = await getSongsInList(parentListId);
    if (songs.length === 0) return;

    // Find the index of the clicked song
    const songIndex = songs.findIndex((s) => s.id === songId);
    if (songIndex === -1) return;

    setPlaylist(songs);
    setCurrentTrackIndex(songIndex);
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

  // Handle previous track (manual navigation - always moves to previous song)
  const handlePrevious = async () => {
    const pl = playlist();
    if (pl.length === 0) return;

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
  const handleListChange = async (listId) => {
    const sameList = listId === currentListId();
    setCurrentListId(listId);
    clearSelection();

    // If clicking on the same list, force a refetch (user might want to refresh)
    if (sameList && explorerRefetch) {
      explorerRefetch();
    }

    // Update title
    if (listId === 0) {
      setListTitle('Main Library');
    } else {
      const lists = await window.electronAPI?.getLists?.();
      const list = lists?.find((l) => l.id === listId);
      setListTitle(list?.title || 'Library');
    }
  };

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
    });
  };

  return (
    <div class="app-container">
      <Sidebar
        onListChange={handleListChange}
        onNewFolder={handleNewFolder}
      />

      <Explorer
        listTitle={listTitle()}
        onPlayFolder={handlePlayFolder}
        onPlaySong={handlePlaySong}
        onSeek={handleSeek}
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
      />

      {/* Alert Modal */}
      <Show when={alertModalState().isOpen}>
        <AlertModal
          open={true}
          message={alertModalState().message}
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

      {/* Rename Modal */}
      <Show when={renameModalState().isOpen}>
        <RenameModal
          open={true}
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
