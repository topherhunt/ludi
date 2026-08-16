import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  shuffledIndices,
  currentSongFromPlaylist,
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

    it('should keep the current song playing when turned on and off mid-queue', () => {
      setCurrentPlaylist([10, 20, 30, 40, 50], 2);
      expect(currentSongFromPlaylist()).toBe(30);

      toggleShuffle();
      expect(currentSongFromPlaylist()).toBe(30); // pinned at the front, not restarted elsewhere
      expect(shuffledIndices()[0]).toBe(2);
      expect(currentTrackIndex()).toBe(0);

      toggleShuffle();
      expect(currentSongFromPlaylist()).toBe(30);
      expect(currentTrackIndex()).toBe(2); // back to its real position in the list
    });

    it('should walk the shuffled order, visiting every song exactly once', () => {
      setCurrentPlaylist([10, 20, 30, 40, 50], 0);
      toggleShuffle();

      const played = [currentSongFromPlaylist()];
      for (let i = 0; i < 4; i++) played.push(nextTrack());

      expect(played[0]).toBe(10);
      expect([...played].sort()).toEqual([10, 20, 30, 40, 50]);
    });
  });

  describe('loopMode', () => {
    // A cold click is one that follows a gap longer than the double-click
    // window, which is what every real click after a pause looks like.
    const coldClick = () => {
      vi.setSystemTime(new Date(Date.now() + 6000));
      cycleLoopMode();
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should default to off', () => {
      expect(loopMode()).toBe('off');
    });

    it('toggles off <-> all on single clicks, never landing on repeat-one', () => {
      coldClick();
      expect(loopMode()).toBe('all');

      coldClick();
      expect(loopMode()).toBe('off');

      coldClick();
      expect(loopMode()).toBe('all');
    });

    it('enters repeat-one on a second click inside the window', () => {
      coldClick();
      expect(loopMode()).toBe('all');

      vi.setSystemTime(new Date(Date.now() + 400));
      cycleLoopMode();
      expect(loopMode()).toBe('one');
    });

    it('does not enter repeat-one when the second click is too late', () => {
      coldClick();
      vi.setSystemTime(new Date(Date.now() + 5001));
      cycleLoopMode();
      expect(loopMode()).toBe('off');
    });

    it('leaves repeat-one on a single click', () => {
      coldClick();
      vi.setSystemTime(new Date(Date.now() + 100));
      cycleLoopMode();
      expect(loopMode()).toBe('one');

      coldClick();
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

  describe('double-click to start playback', () => {
    // Simulates the flow: user double-clicks a song in the tree
    // → handlePlaySong gets called with (songId, parentListId)
    // → fetches songs from parent list
    // → finds clicked song's index
    // → sets playlist and current track
    // → starts playback

    it('should set playlist and play from specific song index', () => {
      // Simulate a list of songs (as returned by getSongsInList)
      const songsInList = [
        { id: 101, title: 'Song A' },
        { id: 102, title: 'Song B' },
        { id: 103, title: 'Song C' },
        { id: 104, title: 'Song D' },
      ];

      // User double-clicked on Song C (id: 103)
      const clickedSongId = 103;
      const songIndex = songsInList.findIndex(s => s.id === clickedSongId);

      // Set the playlist starting at the clicked song
      setCurrentPlaylist(songsInList.map(s => s.id), songIndex);

      // Verify playlist is set correctly
      expect(playlist()).toEqual([101, 102, 103, 104]);
      expect(currentTrackIndex()).toBe(2); // Song C is at index 2

      // Simulate starting playback
      setCurrentPlayingSongId(clickedSongId);
      setIsPlaying(true);

      expect(currentPlayingSongId()).toBe(103);
      expect(isPlaying()).toBe(true);
    });

    it('should allow navigating to next song after double-click play', () => {
      const songIds = [201, 202, 203, 204];

      // Double-click on second song
      setCurrentPlaylist(songIds, 1);
      setCurrentPlayingSongId(202);
      setIsPlaying(true);

      // Play next
      const nextId = nextTrack();
      expect(nextId).toBe(203);
      expect(currentTrackIndex()).toBe(2);
    });

    it('should allow navigating to previous song after double-click play', () => {
      const songIds = [301, 302, 303, 304];

      // Double-click on third song
      setCurrentPlaylist(songIds, 2);
      setCurrentPlayingSongId(303);
      setIsPlaying(true);

      // Play previous
      const prevId = previousTrack();
      expect(prevId).toBe(302);
      expect(currentTrackIndex()).toBe(1);
    });

    it('should handle double-click on first song in list', () => {
      const songIds = [401, 402, 403];

      // Double-click on first song
      setCurrentPlaylist(songIds, 0);
      setCurrentPlayingSongId(401);
      setIsPlaying(true);

      expect(currentTrackIndex()).toBe(0);
      expect(hasPreviousTrack()).toBe(false);
      expect(hasNextTrack()).toBe(true);
    });

    it('should handle double-click on last song in list', () => {
      const songIds = [501, 502, 503];

      // Double-click on last song
      setCurrentPlaylist(songIds, 2);
      setCurrentPlayingSongId(503);
      setIsPlaying(true);

      expect(currentTrackIndex()).toBe(2);
      expect(hasPreviousTrack()).toBe(true);
      expect(hasNextTrack()).toBe(false);
    });

    it('should handle double-click on single song in list', () => {
      const songIds = [601];

      // Double-click on only song
      setCurrentPlaylist(songIds, 0);
      setCurrentPlayingSongId(601);
      setIsPlaying(true);

      expect(currentTrackIndex()).toBe(0);
      expect(hasPreviousTrack()).toBe(false);
      expect(hasNextTrack()).toBe(false);
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
