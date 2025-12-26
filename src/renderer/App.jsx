import { createSignal, onMount, Show, createEffect } from 'solid-js';
import { Sidebar } from './components/Sidebar.jsx';
import { Explorer } from './components/Explorer.jsx';
import { PlayerControls } from './components/PlayerControls.jsx';
import { AlertModal, ConfirmModal, RenameModal } from './components/Modal.jsx';
import {
  alertModalState,
  confirmModalState,
  renameModalState,
  hideAlertModal,
  hideConfirmModal,
  hideRenameModal,
} from './stores/modals.js';
import {
  currentListId,
  setCurrentListId,
  clearSelection,
} from './stores/navigation.js';
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
} from './stores/playback.js';
import { createAudioPlayer, getAudioPlayer } from './hooks/useAudio.js';
import { getSongsInList, getSongPath } from './utils/api.js';

/**
 * Main App component
 */
export function App() {
  // Audio player state
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(1);
  const [isMuted, setIsMuted] = createSignal(false);

  // Current song info for display
  const [songTitle, setSongTitle] = createSignal('');
  const [songArtist, setSongArtist] = createSignal('');

  // List title for explorer header
  const [listTitle, setListTitle] = createSignal('Main Library');

  // Create audio player
  onMount(() => {
    createAudioPlayer({
      onTimeUpdate: setCurrentTime,
      onDurationChange: setDuration,
      onEnd: handleTrackEnd,
      onError: (err) => console.error('Audio error:', err),
    });
  });

  // Handle track end - play next or stop
  const handleTrackEnd = () => {
    const player = getAudioPlayer();
    if (!player) return;

    if (hasNextTrack()) {
      handleNext();
    } else {
      setIsPlaying(false);
      setCurrentPlayingSongId(null);
    }
  };

  // Play a song by loading it
  const playSong = async (song) => {
    const player = getAudioPlayer();
    if (!player) return;

    try {
      const filePath = await getSongPath(song.id);
      if (!filePath) {
        console.error('Could not get song path');
        return;
      }

      player.load(filePath);
      player.play();

      setSongTitle(song.title || 'Unknown');
      setSongArtist(song.artist || '');
      setCurrentPlayingSongId(song.id);
      setIsPlaying(true);
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
    const player = getAudioPlayer();
    if (!player) return;

    if (isPlaying()) {
      player.pause();
      setIsPlaying(false);
    } else if (playlist().length > 0) {
      if (currentTrackIndex() < 0) {
        setCurrentTrackIndex(0);
        playCurrentTrack();
      } else {
        player.play();
        setIsPlaying(true);
      }
    }
  };

  // Handle next track
  const handleNext = async () => {
    if (!hasNextTrack()) return;
    setCurrentTrackIndex(currentTrackIndex() + 1);
    await playCurrentTrack();
  };

  // Handle previous track
  const handlePrevious = async () => {
    if (!hasPreviousTrack()) return;
    setCurrentTrackIndex(currentTrackIndex() - 1);
    await playCurrentTrack();
  };

  // Seek to percentage
  const seekToPercent = (percent) => {
    const player = getAudioPlayer();
    if (!player) return;

    const dur = duration();
    if (dur > 0) {
      const newTime = (percent / 100) * dur;
      player.seek(newTime);
      setCurrentTime(newTime);
    }
  };

  // Handle seek from keyboard (relative seek in seconds)
  const handleSeek = (seconds) => {
    const player = getAudioPlayer();
    if (!player) return;

    const current = currentTime();
    const dur = duration();
    const newTime = Math.max(0, Math.min(dur, current + seconds));
    player.seek(newTime);
    setCurrentTime(newTime);
  };

  // Set volume percentage
  const setVolumePercent = (percent) => {
    const player = getAudioPlayer();
    if (!player) return;

    const vol = percent / 100;
    player.setVolume(vol);
    setVolume(vol);
    if (vol > 0) {
      setIsMuted(false);
    }
  };

  // Toggle mute
  const toggleMute = () => {
    const player = getAudioPlayer();
    if (!player) return;

    if (isMuted()) {
      player.setVolume(volume());
      setIsMuted(false);
    } else {
      player.setVolume(0);
      setIsMuted(true);
    }
  };

  // Handle list change from sidebar
  const handleListChange = async (listId) => {
    setCurrentListId(listId);
    clearSelection();

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
    // This will be handled by Explorer component
    // Just need to trigger refetch after
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
      />

      <PlayerControls
        songTitle={songTitle()}
        songArtist={songArtist()}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
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
          message={alertModalState().message}
          onClose={hideAlertModal}
        />
      </Show>

      {/* Confirm Modal */}
      <Show when={confirmModalState().isOpen}>
        <ConfirmModal
          title={confirmModalState().title}
          message={confirmModalState().message}
          onConfirm={() => {
            confirmModalState().onConfirm?.();
            hideConfirmModal();
          }}
          onCancel={hideConfirmModal}
        />
      </Show>

      {/* Rename Modal */}
      <Show when={renameModalState().isOpen}>
        <RenameModal
          defaultValue={renameModalState().defaultValue}
          onConfirm={(value) => {
            renameModalState().onConfirm?.(value);
          }}
          onCancel={hideRenameModal}
        />
      </Show>
    </div>
  );
}
