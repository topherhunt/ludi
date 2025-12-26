import { createSignal, createMemo } from 'solid-js';
import { createShuffledIndices, createShuffledIndicesWithPin } from '../utils/shuffle.js';

// Playback state
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentPlayingSongId, setCurrentPlayingSongId] = createSignal(null);

// Playlist state
const [playlist, setPlaylist] = createSignal([]);  // Array of song IDs
const [currentTrackIndex, setCurrentTrackIndex] = createSignal(-1);
const [currentPlaylistId, setCurrentPlaylistId] = createSignal(null);  // The list the playlist was built from

// Shuffle state
const [shuffleEnabled, setShuffleEnabled] = createSignal(false);
const [shuffledIndices, setShuffledIndices] = createSignal([]);

// Loop state: 'off' | 'all' | 'one'
const [loopMode, setLoopMode] = createSignal('off');

/**
 * Get the actual track index accounting for shuffle
 * @returns {number}
 */
const actualTrackIndex = createMemo(() => {
  const idx = currentTrackIndex();
  if (idx < 0) return -1;

  if (shuffleEnabled() && shuffledIndices().length > 0) {
    return shuffledIndices()[idx];
  }
  return idx;
});

/**
 * Get current song ID from playlist
 * @returns {number|null}
 */
const currentSongFromPlaylist = createMemo(() => {
  const idx = actualTrackIndex();
  const pl = playlist();
  if (idx < 0 || idx >= pl.length) return null;
  return pl[idx];
});

/**
 * Check if there's a next track available
 * @returns {boolean}
 */
const hasNextTrack = createMemo(() => {
  const idx = currentTrackIndex();
  const pl = playlist();
  if (loopMode() === 'all' || loopMode() === 'one') return pl.length > 0;
  return idx < pl.length - 1;
});

/**
 * Check if there's a previous track available
 * @returns {boolean}
 */
const hasPreviousTrack = createMemo(() => {
  const idx = currentTrackIndex();
  const pl = playlist();
  if (loopMode() === 'all') return pl.length > 0;
  return idx > 0;
});

/**
 * Toggle shuffle mode
 */
function toggleShuffle() {
  setShuffleEnabled(prev => {
    const newValue = !prev;
    if (newValue) {
      // Generate shuffled indices
      const pl = playlist();
      const indices = createShuffledIndices(pl.length);
      setShuffledIndices(indices);
    } else {
      setShuffledIndices([]);
    }
    return newValue;
  });
}

/**
 * Cycle through loop modes: off -> all -> one -> off
 */
function cycleLoopMode() {
  setLoopMode(prev => {
    if (prev === 'off') return 'all';
    if (prev === 'all') return 'one';
    return 'off';
  });
}

/**
 * Set the current playlist
 * @param {number[]} songIds - Array of song IDs
 * @param {number} startIndex - Index to start playing from
 * @param {number|null} listId - The list ID this playlist was built from
 */
function setCurrentPlaylist(songIds, startIndex = 0, listId = null) {
  setPlaylist(songIds);
  setCurrentTrackIndex(startIndex);
  setCurrentPlaylistId(listId);

  if (shuffleEnabled() && songIds.length > 0) {
    // Keep current song at position 0, shuffle the rest
    const shuffled = createShuffledIndicesWithPin(songIds.length, startIndex);
    setShuffledIndices(shuffled);
    setCurrentTrackIndex(0);  // Current song is now at position 0 in shuffled order
  } else {
    setShuffledIndices([]);
  }
}

/**
 * Move to next track
 * @returns {number|null} - The new song ID or null if no next track
 */
function nextTrack() {
  const pl = playlist();
  if (pl.length === 0) return null;

  const currentIdx = currentTrackIndex();

  if (loopMode() === 'one') {
    // Stay on same track
    return pl[actualTrackIndex()];
  }

  let nextIdx = currentIdx + 1;

  if (nextIdx >= pl.length) {
    if (loopMode() === 'all') {
      nextIdx = 0;
    } else {
      return null;  // End of playlist
    }
  }

  setCurrentTrackIndex(nextIdx);
  const newActualIdx = shuffleEnabled() && shuffledIndices().length > 0
    ? shuffledIndices()[nextIdx]
    : nextIdx;

  return pl[newActualIdx];
}

/**
 * Move to previous track
 * @returns {number|null} - The new song ID or null if no previous track
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
      return null;  // Start of playlist
    }
  }

  setCurrentTrackIndex(prevIdx);
  const newActualIdx = shuffleEnabled() && shuffledIndices().length > 0
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
  setPlaylist([]);
  setCurrentTrackIndex(-1);
  setCurrentPlaylistId(null);
  setShuffledIndices([]);
  setShuffleEnabled(false);
  setLoopMode('off');
}

// shuffleArray is imported from utils/shuffle.js

// Expose for testing (matches current vanilla JS behavior)
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
