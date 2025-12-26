import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPlaying,
  setIsPlaying,
  currentPlayingSongId,
  setCurrentPlayingSongId,
  shuffleEnabled,
  loopMode,
  toggleShuffle,
  cycleLoopMode,
  setCurrentPlaylist,
  nextTrack,
  previousTrack,
  clearPlayback,
  hasNextTrack,
  hasPreviousTrack,
  playlist,
  currentTrackIndex,
} from '../../src/renderer/stores/playback.js';

describe('Playback Store', () => {
  beforeEach(() => {
    clearPlayback();
  });

  describe('isPlaying', () => {
    it('should default to false', () => {
      expect(isPlaying()).toBe(false);
    });

    it('should update when set', () => {
      setIsPlaying(true);
      expect(isPlaying()).toBe(true);
    });
  });

  describe('currentPlayingSongId', () => {
    it('should default to null', () => {
      expect(currentPlayingSongId()).toBeNull();
    });

    it('should update when set', () => {
      setCurrentPlayingSongId(42);
      expect(currentPlayingSongId()).toBe(42);
    });
  });

  describe('shuffle', () => {
    it('should default to false', () => {
      expect(shuffleEnabled()).toBe(false);
    });

    it('should toggle shuffle state', () => {
      // Set up a playlist first
      setCurrentPlaylist([1, 2, 3, 4, 5], 0);

      toggleShuffle();
      expect(shuffleEnabled()).toBe(true);

      toggleShuffle();
      expect(shuffleEnabled()).toBe(false);
    });
  });

  describe('loopMode', () => {
    it('should default to off', () => {
      expect(loopMode()).toBe('off');
    });

    it('should cycle through modes: off -> all -> one -> off', () => {
      expect(loopMode()).toBe('off');

      cycleLoopMode();
      expect(loopMode()).toBe('all');

      cycleLoopMode();
      expect(loopMode()).toBe('one');

      cycleLoopMode();
      expect(loopMode()).toBe('off');
    });
  });

  describe('playlist navigation', () => {
    beforeEach(() => {
      setCurrentPlaylist([10, 20, 30, 40, 50], 0);
    });

    it('should set playlist correctly', () => {
      expect(playlist()).toEqual([10, 20, 30, 40, 50]);
      expect(currentTrackIndex()).toBe(0);
    });

    it('should navigate to next track', () => {
      const nextSongId = nextTrack();
      expect(nextSongId).toBe(20);
      expect(currentTrackIndex()).toBe(1);
    });

    it('should navigate to previous track', () => {
      // Start at index 2
      setCurrentPlaylist([10, 20, 30, 40, 50], 2);
      const prevSongId = previousTrack();
      expect(prevSongId).toBe(20);
      expect(currentTrackIndex()).toBe(1);
    });

    it('should return null when at end of playlist (no loop)', () => {
      // Go to last track
      setCurrentPlaylist([10, 20, 30, 40, 50], 4);
      const nextSongId = nextTrack();
      expect(nextSongId).toBeNull();
    });

    it('should return null when at start of playlist (no loop)', () => {
      const prevSongId = previousTrack();
      expect(prevSongId).toBeNull();
    });

    it('should loop to start when at end with loop all', () => {
      setCurrentPlaylist([10, 20, 30, 40, 50], 4);
      cycleLoopMode();  // -> 'all'
      const nextSongId = nextTrack();
      expect(nextSongId).toBe(10);
      expect(currentTrackIndex()).toBe(0);
    });

    it('should loop to end when at start with loop all', () => {
      cycleLoopMode();  // -> 'all'
      const prevSongId = previousTrack();
      expect(prevSongId).toBe(50);
      expect(currentTrackIndex()).toBe(4);
    });

    it('should stay on same track with loop one', () => {
      cycleLoopMode();  // -> 'all'
      cycleLoopMode();  // -> 'one'
      const nextSongId = nextTrack();
      expect(nextSongId).toBe(10);  // Same song
      expect(currentTrackIndex()).toBe(0);  // Index unchanged
    });
  });

  describe('hasNextTrack / hasPreviousTrack', () => {
    it('should report no tracks for empty playlist', () => {
      expect(hasNextTrack()).toBe(false);
      expect(hasPreviousTrack()).toBe(false);
    });

    it('should report next track available when not at end', () => {
      setCurrentPlaylist([10, 20, 30], 0);
      expect(hasNextTrack()).toBe(true);
      expect(hasPreviousTrack()).toBe(false);
    });

    it('should report previous track available when not at start', () => {
      setCurrentPlaylist([10, 20, 30], 2);
      expect(hasNextTrack()).toBe(false);
      expect(hasPreviousTrack()).toBe(true);
    });

    it('should report both available when in middle', () => {
      setCurrentPlaylist([10, 20, 30], 1);
      expect(hasNextTrack()).toBe(true);
      expect(hasPreviousTrack()).toBe(true);
    });

    it('should report next available at end with loop all', () => {
      setCurrentPlaylist([10, 20, 30], 2);
      cycleLoopMode();  // -> 'all'
      expect(hasNextTrack()).toBe(true);
      expect(hasPreviousTrack()).toBe(true);
    });
  });

  describe('clearPlayback', () => {
    it('should reset all playback state', () => {
      setIsPlaying(true);
      setCurrentPlayingSongId(42);
      setCurrentPlaylist([10, 20, 30], 1);
      cycleLoopMode();

      clearPlayback();

      expect(isPlaying()).toBe(false);
      expect(currentPlayingSongId()).toBeNull();
      expect(playlist()).toEqual([]);
      expect(currentTrackIndex()).toBe(-1);
    });
  });

  describe('window globals for testing', () => {
    it('should expose shuffleEnabled on window', () => {
      expect(window.shuffleEnabled).toBe(false);
      setCurrentPlaylist([1, 2, 3], 0);
      toggleShuffle();
      expect(window.shuffleEnabled).toBe(true);
    });

    it('should expose loopMode on window', () => {
      expect(window.loopMode).toBe('off');
      cycleLoopMode();
      expect(window.loopMode).toBe('all');
    });
  });
});
