import { createSignal, onCleanup } from 'solid-js';
import { Howl } from 'howler';
import { setIsPlaying, setCurrentPlayingSongId, setCurrentPlayingItemId } from '../stores/playback.js';
import { getSong } from '../utils/api.js';
import { showAlert } from '../stores/modals.js';

// Monotonic counter used to make each audio load a unique URL (see fileUrl below).
let loadCounter = 0;

// How long playback may make no progress before we call the track stalled.
//
// The queue only advances on a clean 'ended' event, so anything that stops a
// track without ending it stops the whole playlist: a Bluetooth speaker
// dropping out, the output device changing, or a stream that never delivers
// another byte all leave the underlying <audio> element paused or waiting
// forever, firing neither 'ended' nor 'error'. Nothing was watching for that,
// which is how an unattended playlist went silent a few songs in.
const STALL_TIMEOUT_MS = 10000;

// Tests shorten the window so a simulated stall doesn't take ten seconds.
const stallTimeoutMs = () =>
  (typeof window !== 'undefined' && window.__ludiStallTimeoutMs) || STALL_TIMEOUT_MS;

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
  let onStallCallback = null;

  // Watchdog state. `wantsToPlay` is our *intent*: a deliberate pause must not
  // look like a stall, and a track that is still loading must.
  let watchdogTimer = null;
  let watchdogSongId = null;
  let lastPosition = -1;
  let lastProgressAt = 0;
  let wantsToPlay = false;

  // Position to resume at once the next load starts playing, used when
  // recovering a track that died partway through.
  let pendingSeek = 0;

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog(songId) {
    stopWatchdog();
    watchdogSongId = songId;
    lastPosition = -1;
    lastProgressAt = Date.now();
    watchdogTimer = setInterval(checkProgress, 250);
  }

  function checkProgress() {
    if (!sound || !wantsToPlay) {
      lastProgressAt = Date.now();
      return;
    }
    const position = sound.seek() || 0;
    if (position !== lastPosition) {
      lastPosition = position;
      lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - lastProgressAt < stallTimeoutMs()) return;
    reportFailure('stalled', watchdogSongId, position);
  }

  // Hand a dead track to whoever is driving the queue. Loudly: silently
  // swallowing these is what turned a momentary glitch into a dead player.
  function reportFailure(reason, songId, position) {
    stopWatchdog();
    console.error(
      `Playback failure (${reason}) on song ${songId} at ${Math.floor(position)}s`
    );
    onStallCallback?.({ songId, position, reason });
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
   * @param {{ startAt?: number }} [options] - startAt resumes a track that died partway through
   * @returns {Promise<boolean>} Success status
   */
  async function playSong(songId, { startAt = 0 } = {}) {
    setIsLoading(true);
    setError(null);
    wantsToPlay = true;
    pendingSeek = startAt;

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

      // Always use ludi-audio:// custom protocol (defined in main.js)
      // DO NOT use file:// URLs directly - the custom protocol handler includes
      // critical Range request handling required for audio seeking to work correctly.
      // See the detailed comment in main.js protocol.handle() for explanation.
      // Append a unique cache-buster so reloading the same file right after an
      // unload is treated as a fresh request. Without this, Chromium aborts the
      // prior identical URL and the new load fails with MEDIA_ERR_NETWORK.
      const fileUrl = 'ludi-audio://' + fullPath.replace(/\\/g, '/') + '?_=' + (++loadCounter);

      // Create new Howl instance.
      // 'thisSound' lets the callbacks below detect if they're firing for a stale
      // (already-replaced) Howl -- e.g. when seeking near the end causes the song
      // to finish, 'handleTrackEnd' calls playSong again, which calls sound.unload()
      // on the old Howl while its Range request is still in flight.  Unloading aborts
      // the request and Howler fires onloaderror for the OLD instance.  Without the
      // guard, that stale error would show a spurious "File Not Found" dialog.
      const thisSound = (sound = new Howl({
        src: [fileUrl],
        html5: true,  // Required for long audio files
        volume: isMuted() ? 0 : volume(),
        onplay: () => {
          setIsPlaying(true);
          setIsLoading(false);
          if (pendingSeek > 0) {
            sound.seek(pendingSeek);
            setCurrentTime(pendingSeek);
            pendingSeek = 0;
          }
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
          wantsToPlay = false; // the next playSong sets it again
          stopWatchdog();
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
        onloaderror: async (id, err) => {
          if (sound !== thisSound) return; // stale error from an already-replaced Howl
          console.error('Error loading audio:', err, 'Path:', fileUrl);
          // Always clear the loading spinner -- otherwise a transient (file-exists)
          // error would leave the play button stuck spinning forever.
          setIsLoading(false);

          // Before showing "File Not Found", verify the file is actually missing.
          // Howler fires onloaderror for transient streaming errors too (e.g. a
          // Range request aborted mid-seek), so we must not alarm the user when the
          // file is present and the error is just a blip in playback.
          const fileExists = await window.electronAPI.fileExists(fullPath);
          if (!fileExists) {
            setError(`Failed to load audio: ${err}`);
            showAlert(
              '<i class="bi bi-exclamation-diamond" style="margin-right: 8px;"></i>File Not Found',
              `<p>Could not find audio file:</p><p style="word-break: break-all; font-family: monospace; font-size: 12px;">${fullPath}</p>`
            );
            onErrorCallback?.(err);
            return;
          }
          // The file is right there, so this was a transient streaming failure --
          // an aborted Range request, or the output device going away mid-song.
          // These used to be swallowed entirely, which left the player dead until
          // the app was restarted. Hand it to the queue's recovery instead.
          reportFailure(`load error ${err}`, songId, lastPosition > 0 ? lastPosition : 0);
        },
        onplayerror: (id, err) => {
          if (sound !== thisSound) return; // stale error from an already-replaced Howl
          console.error('Error playing audio:', err, 'Path:', fileUrl);
          setError(`Failed to play audio: ${err}`);
          setIsPlaying(false);
          onErrorCallback?.(err);
          reportFailure(`play error ${err}`, songId, lastPosition > 0 ? lastPosition : 0);
        },
      }));

      // Update the playing song ID in the store
      setCurrentPlayingSongId(songId);

      // Set duration from database immediately (don't wait for Howler to load metadata)
      if (song.duration_seconds && isFinite(song.duration_seconds) && song.duration_seconds > 0) {
        setDuration(song.duration_seconds);
      }

      // Start playback. The watchdog starts here, not at onplay: a load that
      // never finishes is exactly one of the failures it exists to catch.
      startWatchdog(songId);
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
      wantsToPlay = true;
      lastProgressAt = Date.now();
      if (!watchdogTimer) startWatchdog(watchdogSongId);
      sound.play();
    }
  }

  /**
   * Pause playback
   */
  function pause() {
    if (sound) {
      wantsToPlay = false;
      stopWatchdog(); // a deliberate pause is not a stall
      sound.pause();
    }
  }

  /**
   * Toggle play/pause
   */
  function togglePlayPause() {
    if (sound) {
      if (sound.playing()) {
        pause();
      } else {
        play();
      }
    }
  }

  /**
   * Stop playback and reset
   */
  function stop() {
    wantsToPlay = false;
    stopWatchdog();
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
      lastProgressAt = Date.now(); // a seek is progress, not a stall
    }
  }

  /**
   * Seek to a percentage of the track
   * @param {number} percentage - 0 to 100
   */
  function seekToPercent(percentage) {
    if (sound) {
      // Use Howler's actual duration for seeking (like the old renderer.js does)
      // This ensures the seek position is accurate even if DB duration differs
      const howlerDur = sound.duration();
      const dur = (isFinite(howlerDur) && howlerDur > 0) ? howlerDur : duration();
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
    wantsToPlay = false;
    stopWatchdog();
    if (sound) {
      sound.unload();
      sound = null;
    }
    stopTimeUpdates();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setCurrentPlayingSongId(null);
    setCurrentPlayingItemId(null);
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

  /**
   * Set callback for a track that failed or stopped making progress.
   * Called with { songId, position, reason }.
   * @param {Function} callback
   */
  function onStall(callback) {
    onStallCallback = callback;
  }

  // Test hook: the underlying <audio> element, so tests can reproduce the
  // failures this recovery exists for (a device that drops out mid-song fires
  // 'error', or simply pauses the element behind Howler's back).
  if (typeof window !== 'undefined') {
    window.__ludiAudioNode = () => sound?._sounds?.[0]?._node ?? null;
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
    onStall,
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
