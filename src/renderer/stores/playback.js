import { createSignal, createMemo, createRoot } from 'solid-js';
import { createShuffledIndices, createShuffledIndicesWithPin } from '../utils/shuffle.js';

// Create store signals inside createRoot to avoid "computations created outside createRoot" warnings
const {
  isPlaying,
  setIsPlaying,
  currentPlayingSongId,
  setCurrentPlayingSongId,
  currentPlayingItemId,
  setCurrentPlayingItemId,
  playingRootListId,
  setPlayingRootListId,
  playlist,
  setPlaylist,
  currentTrackIndex,
  setCurrentTrackIndex,
  currentPlaylistId,
  setCurrentPlaylistId,
  shuffleEnabled,
  setShuffleEnabled,
  shuffledIndices,
  setShuffledIndices,
  loopMode,
  setLoopMode,
  actualTrackIndex,
  currentSongFromPlaylist,
  hasNextTrack,
  hasPreviousTrack,
} = createRoot(() => {
  // Playback state
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentPlayingSongId, setCurrentPlayingSongId] = createSignal(null);

  // Which *row* is playing. A playlist may hold the same song more than once,
  // so the song id alone can't say which one -- rows are identified by their
  // list_items id.
  const [currentPlayingItemId, setCurrentPlayingItemId] = createSignal(null);

  // Which sidebar playlist the current queue was started from. A queue can be
  // scoped to a folder deep inside a playlist, so this is the ROOT list of that
  // folder -- it's what the sidebar marks with the playing indicator.
  const [playingRootListId, setPlayingRootListId] = createSignal(null);

  // Playlist state
  const [playlist, setPlaylist] = createSignal([]);
  const [currentTrackIndex, setCurrentTrackIndex] = createSignal(-1);
  const [currentPlaylistId, setCurrentPlaylistId] = createSignal(null);

  // Shuffle state
  const [shuffleEnabled, setShuffleEnabled] = createSignal(false);
  const [shuffledIndices, setShuffledIndices] = createSignal([]);

  // Loop state: 'off' | 'all' | 'one'
  const [loopMode, setLoopMode] = createSignal('all');

  const actualTrackIndex = createMemo(() => {
    const idx = currentTrackIndex();
    if (idx < 0) return -1;
    if (shuffleEnabled() && shuffledIndices().length > 0) {
      return shuffledIndices()[idx];
    }
    return idx;
  });

  const currentSongFromPlaylist = createMemo(() => {
    const idx = actualTrackIndex();
    const pl = playlist();
    if (idx < 0 || idx >= pl.length) return null;
    return pl[idx];
  });

  const hasNextTrack = createMemo(() => {
    const idx = currentTrackIndex();
    const pl = playlist();
    if (loopMode() === 'all' || loopMode() === 'one') return pl.length > 0;
    return idx < pl.length - 1;
  });

  const hasPreviousTrack = createMemo(() => {
    const idx = currentTrackIndex();
    const pl = playlist();
    if (loopMode() === 'all') return pl.length > 0;
    return idx > 0;
  });

  return {
    isPlaying,
    setIsPlaying,
    currentPlayingSongId,
    setCurrentPlayingSongId,
    currentPlayingItemId,
    setCurrentPlayingItemId,
    playingRootListId,
    setPlayingRootListId,
    playlist,
    setPlaylist,
    currentTrackIndex,
    setCurrentTrackIndex,
    currentPlaylistId,
    setCurrentPlaylistId,
    shuffleEnabled,
    setShuffleEnabled,
    shuffledIndices,
    setShuffledIndices,
    loopMode,
    setLoopMode,
    actualTrackIndex,
    currentSongFromPlaylist,
    hasNextTrack,
    hasPreviousTrack,
  };
});

/**
 * Toggle shuffle mode.
 *
 * `currentTrackIndex` is a position in the *queue order*, which shuffle
 * redefines -- so flipping the mode has to re-point it at the song that is
 * playing right now, or the queue silently jumps to an unrelated track.
 */
function toggleShuffle() {
  const pl = playlist();
  const playingIdx = actualTrackIndex(); // real playlist index, before the flip

  if (shuffleEnabled()) {
    setShuffledIndices([]);
    setShuffleEnabled(false);
    if (playingIdx >= 0) setCurrentTrackIndex(playingIdx);
  } else {
    // Pin the current song at the front so turning shuffle on never cuts it
    // off; the rest of the queue is reshuffled behind it.
    setShuffledIndices(
      playingIdx >= 0
        ? createShuffledIndicesWithPin(pl.length, playingIdx)
        : createShuffledIndices(pl.length)
    );
    setShuffleEnabled(true);
    if (playingIdx >= 0) setCurrentTrackIndex(0);
  }
}

/**
 * Cycle through loop modes: off -> all -> one -> off
 */
function cycleLoopMode() {
  setLoopMode((prev) => {
    if (prev === 'off') return 'all';
    if (prev === 'all') return 'one';
    return 'off';
  });
}

/**
 * Set the current playlist
 */
function setCurrentPlaylist(songIds, startIndex = 0, listId = null) {
  setPlaylist(songIds);
  setCurrentTrackIndex(startIndex);
  setCurrentPlaylistId(listId);

  if (shuffleEnabled() && songIds.length > 0) {
    const shuffled = createShuffledIndicesWithPin(songIds.length, startIndex);
    setShuffledIndices(shuffled);
    setCurrentTrackIndex(0);
  } else {
    setShuffledIndices([]);
  }
}

/**
 * Move to next track
 */
function nextTrack() {
  const pl = playlist();
  if (pl.length === 0) return null;

  const currentIdx = currentTrackIndex();

  if (loopMode() === 'one') {
    return pl[actualTrackIndex()];
  }

  let nextIdx = currentIdx + 1;

  if (nextIdx >= pl.length) {
    if (loopMode() === 'all') {
      nextIdx = 0;
    } else {
      return null;
    }
  }

  setCurrentTrackIndex(nextIdx);
  const newActualIdx =
    shuffleEnabled() && shuffledIndices().length > 0
      ? shuffledIndices()[nextIdx]
      : nextIdx;

  return pl[newActualIdx];
}

/**
 * Move to previous track
 */
function previousTrack() {
  const pl = playlist();
  if (pl.length === 0) return null;

  const currentIdx = currentTrackIndex();
  let prevIdx = currentIdx - 1;

  if (prevIdx < 0) {
    if (loopMode() === 'all') {
      prevIdx = pl.length - 1;
    } else {
      return null;
    }
  }

  setCurrentTrackIndex(prevIdx);
  const newActualIdx =
    shuffleEnabled() && shuffledIndices().length > 0
      ? shuffledIndices()[prevIdx]
      : prevIdx;

  return pl[newActualIdx];
}

/**
 * Clear playback state
 */
function clearPlayback() {
  setIsPlaying(false);
  setCurrentPlayingSongId(null);
  setCurrentPlayingItemId(null);
  setPlayingRootListId(null);
  setPlaylist([]);
  setCurrentTrackIndex(-1);
  setCurrentPlaylistId(null);
  setShuffledIndices([]);
  setShuffleEnabled(false);
  setLoopMode('off');
}

// Expose for testing
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'shuffleEnabled', {
    get: () => shuffleEnabled(),
    configurable: true,
  });
  Object.defineProperty(window, 'loopMode', {
    get: () => loopMode(),
    configurable: true,
  });
}

export {
  // Signals
  isPlaying,
  setIsPlaying,
  currentPlayingSongId,
  setCurrentPlayingSongId,
  currentPlayingItemId,
  setCurrentPlayingItemId,
  playingRootListId,
  setPlayingRootListId,
  playlist,
  setPlaylist,
  currentTrackIndex,
  setCurrentTrackIndex,
  currentPlaylistId,
  shuffleEnabled,
  setShuffleEnabled,
  shuffledIndices,
  loopMode,
  setLoopMode,

  // Functions
  toggleShuffle,
  cycleLoopMode,
  setCurrentPlaylist,
  nextTrack,
  previousTrack,
  clearPlayback,

  // Computed
  actualTrackIndex,
  currentSongFromPlaylist,
  hasNextTrack,
  hasPreviousTrack,
};
