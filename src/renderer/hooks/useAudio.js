import { createSignal, onCleanup } from 'solid-js';
import { setIsPlaying, setCurrentPlayingSongId } from '../stores/playback.js';
import { getSong } from '../utils/api.js';

/**
 * Audio player hook using Howler.js
 * Provides a reactive interface to audio playback
 */
export function createAudioPlayer() {
  // Local state for audio-specific values
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolumeState] = createSignal(1);
  const [isMuted, setIsMuted] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal(null);

  // Current Howl instance
  let sound = null;
  let updateInterval = null;
  let previousVolume = 1;

  // Callbacks
  let onEndCallback = null;
  let onPlayCallback = null;
  let onPauseCallback = null;
  let onErrorCallback = null;

  /**
   * Get the Howl constructor (loaded via script tag)
   */
  function getHowl() {
    if (typeof window !== 'undefined' && window.Howl) {
      return window.Howl;
    }
    return null;
  }

  /**
   * Start the time update interval
   */
  function startTimeUpdates() {
    if (updateInterval) return;

    updateInterval = setInterval(() => {
      if (sound && sound.playing()) {
        const seek = sound.seek() || 0;
        setCurrentTime(seek);

        // Update duration if it becomes available (HTML5 audio may load it late)
        const dur = sound.duration();
        if (isFinite(dur) && dur > 0 && duration() !== dur) {
          setDuration(dur);
        }
      }
    }, 250);
  }

  /**
   * Stop the time update interval
   */
  function stopTimeUpdates() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  /**
   * Load and play a song by ID
   * @param {number} songId
   * @returns {Promise<boolean>} Success status
   */
  async function playSong(songId) {
    const Howl = getHowl();
    if (!Howl) {
      console.error('Howler.js not loaded');
      setError('Audio library not loaded');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get song data from database
      const song = await getSong(songId);
      if (!song) {
        setError('Song not found');
        setIsLoading(false);
        return false;
      }

      // song.file_path is already the full absolute path (converted by database.js getSong)
      const fullPath = song.file_path;

      // Stop and unload current sound
      if (sound) {
        sound.unload();
        sound = null;
      }
      stopTimeUpdates();

      // Use ludi-audio:// protocol which works from both file:// and http:// origins
      // This custom protocol is registered in main.js and serves local files
      const fileUrl = 'ludi-audio://' + fullPath.replace(/\\/g, '/');

      // Create new Howl instance
      sound = new Howl({
        src: [fileUrl],
        html5: true,  // Required for long audio files
        volume: isMuted() ? 0 : volume(),
        onplay: () => {
          setIsPlaying(true);
          setIsLoading(false);
          const dur = sound.duration();
          if (isFinite(dur) && dur > 0) {
            setDuration(dur);
          }
          startTimeUpdates();
          onPlayCallback?.();
        },
        onpause: () => {
          setIsPlaying(false);
          stopTimeUpdates();
          onPauseCallback?.();
        },
        onstop: () => {
          setIsPlaying(false);
          stopTimeUpdates();
          setCurrentTime(0);
        },
        onend: () => {
          setIsPlaying(false);
          stopTimeUpdates();
          setCurrentTime(0);
          onEndCallback?.();
        },
        onload: () => {
          const dur = sound.duration();
          if (isFinite(dur) && dur > 0) {
            setDuration(dur);
          }
          setIsLoading(false);
        },
        onloaderror: (id, err) => {
          console.error('Error loading audio:', err, 'Path:', fileUrl);
          setError(`Failed to load audio: ${err}`);
          setIsLoading(false);
          onErrorCallback?.(err);
        },
        onplayerror: (id, err) => {
          console.error('Error playing audio:', err, 'Path:', fileUrl);
          setError(`Failed to play audio: ${err}`);
          setIsPlaying(false);
          onErrorCallback?.(err);
        },
      });

      // Update the playing song ID in the store
      setCurrentPlayingSongId(songId);

      // Set duration from database immediately (don't wait for Howler to load metadata)
      if (song.duration_seconds && isFinite(song.duration_seconds) && song.duration_seconds > 0) {
        setDuration(song.duration_seconds);
      }

      // Start playback
      sound.play();
      return true;

    } catch (err) {
      console.error('Error in playSong:', err);
      setError(err.message);
      setIsLoading(false);
      return false;
    }
  }

  /**
   * Play the current sound (resume)
   */
  function play() {
    if (sound) {
      sound.play();
    }
  }

  /**
   * Pause playback
   */
  function pause() {
    if (sound) {
      sound.pause();
    }
  }

  /**
   * Toggle play/pause
   */
  function togglePlayPause() {
    if (sound) {
      if (sound.playing()) {
        sound.pause();
      } else {
        sound.play();
      }
    }
  }

  /**
   * Stop playback and reset
   */
  function stop() {
    if (sound) {
      sound.stop();
    }
    setCurrentTime(0);
  }

  /**
   * Seek to a position
   * @param {number} time - Time in seconds
   */
  function seek(time) {
    if (sound) {
      sound.seek(time);
      setCurrentTime(time);
    }
  }

  /**
   * Seek to a percentage of the track
   * @param {number} percentage - 0 to 100
   */
  function seekToPercent(percentage) {
    if (sound) {
      // Use the duration signal (set from DB) instead of sound.duration() which may be Infinity
      const dur = duration();
      if (!isFinite(dur) || dur <= 0) return;
      const time = dur * (percentage / 100);
      seek(time);
    }
  }

  /**
   * Set volume
   * @param {number} value - 0 to 1
   */
  function setVolume(value) {
    const clampedValue = Math.max(0, Math.min(1, value));
    setVolumeState(clampedValue);
    previousVolume = clampedValue > 0 ? clampedValue : previousVolume;

    if (sound && !isMuted()) {
      sound.volume(clampedValue);
    }
  }

  /**
   * Set volume from a percentage (0-100)
   * @param {number} percentage
   */
  function setVolumePercent(percentage) {
    setVolume(percentage / 100);
  }

  /**
   * Toggle mute
   */
  function toggleMute() {
    const newMuted = !isMuted();
    setIsMuted(newMuted);

    if (sound) {
      if (newMuted) {
        sound.volume(0);
      } else {
        sound.volume(volume());
      }
    }
  }

  /**
   * Mute audio
   */
  function mute() {
    setIsMuted(true);
    if (sound) {
      sound.volume(0);
    }
  }

  /**
   * Unmute audio
   */
  function unmute() {
    setIsMuted(false);
    if (sound) {
      sound.volume(volume());
    }
  }

  /**
   * Unload and cleanup
   */
  function unload() {
    if (sound) {
      sound.unload();
      sound = null;
    }
    stopTimeUpdates();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setCurrentPlayingSongId(null);
  }

  /**
   * Get current playback progress as percentage
   * @returns {number} 0 to 100
   */
  function getProgressPercent() {
    const dur = duration();
    if (dur <= 0) return 0;
    return (currentTime() / dur) * 100;
  }

  /**
   * Check if audio is currently playing
   * @returns {boolean}
   */
  function isCurrentlyPlaying() {
    return sound?.playing() ?? false;
  }

  /**
   * Set callback for when track ends
   * @param {Function} callback
   */
  function onEnd(callback) {
    onEndCallback = callback;
  }

  /**
   * Set callback for when track starts playing
   * @param {Function} callback
   */
  function onPlay(callback) {
    onPlayCallback = callback;
  }

  /**
   * Set callback for when track pauses
   * @param {Function} callback
   */
  function onPause(callback) {
    onPauseCallback = callback;
  }

  /**
   * Set callback for errors
   * @param {Function} callback
   */
  function onError(callback) {
    onErrorCallback = callback;
  }

  // Cleanup on unmount
  onCleanup(() => {
    unload();
  });

  return {
    // State (reactive signals)
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    error,

    // Playback controls
    playSong,
    play,
    pause,
    togglePlayPause,
    stop,
    seek,
    seekToPercent,
    unload,

    // Volume controls
    setVolume,
    setVolumePercent,
    toggleMute,
    mute,
    unmute,

    // Utilities
    getProgressPercent,
    isCurrentlyPlaying,

    // Event callbacks
    onEnd,
    onPlay,
    onPause,
    onError,
  };
}

// Singleton instance for the app
let audioPlayerInstance = null;

/**
 * Get the shared audio player instance
 * @returns {ReturnType<typeof createAudioPlayer>}
 */
export function getAudioPlayer() {
  if (!audioPlayerInstance) {
    audioPlayerInstance = createAudioPlayer();
  }
  return audioPlayerInstance;
}

/**
 * Reset the audio player instance (useful for testing)
 */
export function resetAudioPlayer() {
  if (audioPlayerInstance) {
    audioPlayerInstance.unload();
    audioPlayerInstance = null;
  }
}
