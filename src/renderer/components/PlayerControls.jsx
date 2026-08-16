import { createMemo, Show } from 'solid-js';
import {
  isPlaying,
  shuffleEnabled,
  loopMode,
  toggleShuffle,
  cycleLoopMode,
  hasNextTrack,
  hasPreviousTrack,
  playlist,
} from '../stores/playback.js';
import { formatTime } from '../utils/format.js';

/**
 * Player Controls footer component
 */
export function PlayerControls(props) {
  // Destructure audio player methods from props
  const {
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    togglePlayPause,
    seekToPercent,
    setVolumePercent,
    toggleMute,
    onNext,
    onPrevious,
    onSeekBy,
  } = props;

  // Calculate progress percentage
  const progress = createMemo(() => {
    const dur = duration?.() || 0;
    if (dur <= 0) return 0;
    return ((currentTime?.() || 0) / dur) * 100;
  });

  // Check if controls should be enabled
  const hasPlaylist = createMemo(() => playlist().length > 0);

  // Handle seek bar change
  const handleSeek = (e) => {
    seekToPercent?.(parseFloat(e.target.value));
  };

  // The seek bar is a 0-100 range input, so its native arrow-key step is 1% of
  // the song -- minutes at a time in a long recording. Seek by the same fixed
  // amount the explorer's arrow keys use instead.
  const SEEK_STEP_SECONDS = 5;
  const ARROW_DIRECTION = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

  const handleSeekKeyDown = (e) => {
    const direction = ARROW_DIRECTION[e.key];
    if (direction === undefined) return;
    e.preventDefault();
    onSeekBy(direction * SEEK_STEP_SECONDS);
  };

  // Handle volume change
  const handleVolumeChange = (e) => {
    setVolumePercent?.(parseFloat(e.target.value));
  };

  // Get loop button icon class
  const loopIconClass = createMemo(() => {
    const mode = loopMode();
    if (mode === 'one') return 'bi bi-repeat-1';
    return 'bi bi-repeat';
  });

  // Get loop button title. Repeat-one takes a double-click, so the tooltip is
  // the only place that gesture is discoverable.
  const loopTitle = createMemo(() => {
    const mode = loopMode();
    if (mode === 'one') return 'Loop: One song';
    const state = mode === 'off' ? 'Loop: Off' : 'Loop: All';
    return `${state} (double-click to repeat one song)`;
  });

  // Get play/pause icon
  const playPauseIcon = createMemo(() => {
    if (isLoading?.()) return 'bi bi-arrow-repeat';
    return isPlaying() ? 'bi bi-pause-circle-fill' : 'bi bi-play-circle-fill';
  });

  // Get volume icon
  const volumeIcon = createMemo(() => {
    if (isMuted?.() || (volume?.() || 0) === 0) return 'bi bi-volume-mute-fill';
    if ((volume?.() || 0) < 0.5) return 'bi bi-volume-down-fill';
    return 'bi bi-volume-up-fill';
  });

  return (
    <footer class="player-controls">
      <div class="player-info">
        <div class="song-title" id="currentSongTitle">
          {props.songTitle || 'No song playing'}
        </div>
        <div class="song-artist" id="currentSongArtist">
          {props.songArtist || ''}
        </div>
      </div>

      <div class="playback-controls">
        <button
          id="shuffleBtn"
          data-tooltip="Shuffle"
          class="toggle-btn"
          classList={{ active: shuffleEnabled() }}
          onClick={toggleShuffle}
        >
          <i class="bi bi-shuffle"></i>
        </button>

        <button
          id="prevBtn"
          data-tooltip="Previous"
          disabled={!hasPreviousTrack()}
          onClick={onPrevious}
        >
          <i class="bi bi-skip-backward-circle-fill"></i>
        </button>

        <button
          id="playPauseBtn"
          data-tooltip="Play/Pause"
          disabled={!hasPlaylist()}
          classList={{
            playing: isPlaying(),
            paused: !isPlaying() && hasPlaylist() && !isLoading?.(),
            loading: isLoading?.(),
          }}
          onClick={togglePlayPause}
        >
          <i class={playPauseIcon()}></i>
        </button>

        <button
          id="nextBtn"
          data-tooltip="Next"
          disabled={!hasNextTrack()}
          onClick={onNext}
        >
          <i class="bi bi-skip-forward-circle-fill"></i>
        </button>

        <button
          id="loopBtn"
          data-tooltip={loopTitle()}
          class="toggle-btn"
          classList={{ active: loopMode() !== 'off' }}
          onClick={cycleLoopMode}
        >
          <i class={loopIconClass()}></i>
        </button>
      </div>

      <div class="time-controls">
        <span id="currentTime">{formatTime(currentTime?.() || 0)}</span>
        <input
          type="range"
          id="seekBar"
          min="0"
          max="100"
          value={progress()}
          disabled={!hasPlaylist()}
          onInput={handleSeek}
          onKeyDown={handleSeekKeyDown}
        />
        <span id="totalTime">{formatTime(duration?.() || 0)}</span>
      </div>

      <div class="volume-controls">
        <button id="muteBtn" data-tooltip="Mute" onClick={toggleMute}>
          <i class={volumeIcon()}></i>
        </button>
        <input
          type="range"
          id="volumeSlider"
          min="0"
          max="100"
          value={(volume?.() || 1) * 100}
          onInput={handleVolumeChange}
        />
      </div>
    </footer>
  );
}
