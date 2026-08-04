/**
 * Driving the analysis pass.
 *
 * Analyzing a library is a long, boring, interruptible job: a few seconds per
 * track, hours for a big collection, and the user will quit halfway through.
 * That shapes everything here.
 *
 *   - The work list lives in SQLite, not in memory. Quitting mid-pass loses at
 *     most the handful of songs actually in flight, and those are re-queued at
 *     next startup (see requeueStaleAnalysisTasks).
 *   - The analyzer lives in a hidden window we create when there's work and
 *     destroy when there isn't. It holds a few hundred MB of WASM heap across a
 *     worker pool; keeping that resident for a library that finished analyzing
 *     last week would be pure waste.
 *   - Playback wins. While a song is playing we throttle to a single worker
 *     rather than pausing outright, so someone who always has music on still
 *     makes progress instead of never finishing.
 *
 * The pump is deliberately pull-based: the analyzer reports how many slots it
 * has, and we top it up to that number as results come back. Nothing here needs
 * to know how long a track takes.
 */

const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const db = require('./database');
const { bundleUrl } = require('./bundle-protocol');
const { MODEL_VERSION } = require('./analysis/vocabulary');
const { recalculateAutoTags } = require('./analysis/auto-tagger');

let config = null;
let analyzerWindow = null;

/** How many songs the analyzer said it can work on at once. */
let slots = 0;
/** songId -> title, for work handed to the analyzer and not yet reported back. */
const inFlight = new Map();
/** 'idle' | 'starting' | 'running' | 'stopping' */
let state = 'idle';
/** Set while the user is listening; see effectiveSlots(). */
let playbackActive = false;

/**
 * Analysis competes with playback for CPU, and playback is the thing the user is
 * actually paying attention to. One worker still makes steady progress in the
 * background without making the UI stutter.
 */
function effectiveSlots() {
  return playbackActive ? 1 : slots;
}

/**
 * Tell every window where the pass is up to. Both the main window and Settings
 * show progress, and either can be open without the other.
 */
function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window === analyzerWindow || window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

function progressPayload() {
  return { ...db.getAnalysisStats(), running: state === 'running' || state === 'starting' };
}

/**
 * Build the URL the analyzer fetches a song from.
 *
 * Same custom protocol the player uses -- it's the one path that reads library
 * files with the right headers. Segments are encoded individually because a '#'
 * or '?' in a filename would otherwise truncate the path.
 */
function audioUrl(filePath) {
  const encoded = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  return `ludi-audio://${encoded.startsWith('/') ? encoded : '/' + encoded}`;
}

function createAnalyzerWindow(pending) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // The pass keeps running when the app is in the background -- that's the
      // whole point of a job measured in hours.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'analyzer-preload.js'),
    },
  });

  // The page sizes its worker pool from `pending` -- no point loading six copies
  // of the model to analyze one song.
  const query = `?pending=${pending}`;
  if (config.isDev) {
    window.loadURL(`http://localhost:${config.devPort}/analyzer.html${query}`);
  } else {
    // ludi-app:// rather than a file path -- fetch() doesn't work on file://,
    // and this page is nothing but fetches. See bundle-protocol.js.
    window.loadURL(bundleUrl(`analyzer.html${query}`));
  }

  // A dead renderer takes its in-flight songs with it. Put them back on the queue
  // rather than leaving them 'running' forever.
  window.webContents.on('render-process-gone', (event, details) => {
    console.error('Analyzer window died:', details.reason);
    abandon(`analyzer window died (${details.reason})`);
  });

  return window;
}

/** Give up on the current pass, returning in-flight work to the queue. */
function abandon(reason) {
  for (const songId of inFlight.keys()) db.failAnalysis(songId, reason);
  inFlight.clear();
  slots = 0;
  state = 'idle';
  if (analyzerWindow && !analyzerWindow.isDestroyed()) analyzerWindow.destroy();
  analyzerWindow = null;
  broadcast('analysis:progress', progressPayload());
}

/**
 * Hand out work until the analyzer is full, or shut down when the queue is dry.
 * Safe to call from anywhere: it's a no-op unless the analyzer is ready and has
 * spare capacity.
 */
function pump() {
  if (state !== 'running') return;

  const capacity = effectiveSlots() - inFlight.size;
  if (capacity > 0) {
    for (const task of db.claimAnalysisTasks(capacity)) {
      inFlight.set(task.songId, task.title);
      analyzerWindow.webContents.send('analysis:task', {
        songId: task.songId,
        url: audioUrl(task.filePath),
      });
    }
  }

  if (inFlight.size === 0) finish();
}

/**
 * The queue is empty. Turn the raw scores into tags now, while everything needed
 * is warm, then release the analyzer's memory.
 */
function finish() {
  state = 'stopping';
  let tagResult;
  try {
    tagResult = recalculateAutoTags();
  } catch (error) {
    console.error('Auto-tagging failed after analysis pass:', error);
    tagResult = { error: String(error) };
  }

  if (analyzerWindow && !analyzerWindow.isDestroyed()) analyzerWindow.destroy();
  analyzerWindow = null;
  slots = 0;
  state = 'idle';

  broadcast('analysis:progress', progressPayload());
  broadcast('analysis:complete', { tags: tagResult });
}

/** Spin up the analyzer if it isn't already running. */
function ensureRunning() {
  if (state !== 'idle') return;
  const pending = db.getAnalysisStats().pending;
  if (pending === 0) return;
  state = 'starting';
  analyzerWindow = createAnalyzerWindow(pending);
  broadcast('analysis:progress', progressPayload());
}

// ---- Public API ----------------------------------------------------------

/**
 * Queue every song the current model hasn't seen, and start working through it.
 * Idempotent -- calling it again while a pass is running just tops the queue up.
 */
function analyzeLibrary() {
  const songIds = db.getSongsNeedingAnalysis(MODEL_VERSION);
  db.enqueueForAnalysis(songIds);
  ensureRunning();
  return progressPayload();
}

/**
 * Queue specific songs. Used on import so a newly added album is analyzed
 * without the user having to ask -- but only once they've analyzed at least
 * once, since the first full pass is a deliberate, hours-long choice.
 */
function analyzeSongs(songIds) {
  db.enqueueForAnalysis(songIds);
  ensureRunning();
  return progressPayload();
}

/**
 * Queue songs that just arrived in the library, but only if the library has been
 * analyzed before. Analyzing is an explicit, hours-long choice the first time;
 * after that, a newly imported album should just quietly join everything else
 * rather than being invisible to similarity search until you remember to ask.
 */
function analyzeNewSongs(songIds) {
  if (songIds.length === 0) return;
  if (db.getAnalysisStats().analyzed === 0) return;
  analyzeSongs(songIds);
}

/** Start working through whatever is already queued, without queuing anything new. */
function resumeAnalysis() {
  ensureRunning();
  return progressPayload();
}

/** Stop the current pass. The queue survives, so it can be resumed later. */
function stopAnalysis() {
  if (state === 'idle') return progressPayload();
  for (const songId of inFlight.keys()) {
    db.failAnalysis(songId, 'cancelled');
  }
  inFlight.clear();
  slots = 0;
  state = 'idle';
  if (analyzerWindow && !analyzerWindow.isDestroyed()) analyzerWindow.destroy();
  analyzerWindow = null;
  broadcast('analysis:progress', progressPayload());
  return progressPayload();
}

/** Called by the playback layer so analysis gets out of the way while listening. */
function setPlaybackActive(active) {
  playbackActive = active;
  if (!active) pump();  // going quiet frees up the rest of the pool
}

function initAnalysis(options) {
  config = options;

  // Anything still marked 'running' is left over from a crash or quit -- nothing
  // is actually running yet at this point in startup.
  db.requeueStaleAnalysisTasks();

  ipcMain.on('analysis:ready', (event, info) => {
    // A 'ready' that arrives after we tore the window down (a stop racing with
    // startup) refers to a window that no longer exists -- pumping work into it
    // would throw.
    if (state !== 'starting') return;
    slots = info.slots;
    state = 'running';
    broadcast('analysis:progress', progressPayload());
    pump();
  });

  ipcMain.on('analysis:result', (event, result) => {
    inFlight.delete(result.songId);

    if (result.ok) {
      db.saveAnalysis(result.songId, {
        modelVersion: MODEL_VERSION,
        embedding: Buffer.from(result.embedding),
        activations: Buffer.from(result.activations),
        axes: result.axes,
      });
    } else {
      console.error(`Analysis failed for song ${result.songId}:`, result.error);
      db.failAnalysis(result.songId, result.error);
    }

    broadcast('analysis:progress', progressPayload());
    pump();
  });

  // The analyzer page couldn't even start -- a missing model file, a WASM load
  // failure. Retrying per-song would just fail 3 times each; stop the pass.
  ipcMain.on('analysis:fatal', (event, message) => {
    console.error('Analyzer fatal error:', message);
    abandon('analyzer failed to start');
    broadcast('analysis:error', { message });
  });

  // Resume a pass that was interrupted by a quit. The user already opted into
  // analysis by starting it; they shouldn't have to opt in again every launch.
  ensureRunning();
}

module.exports = {
  initAnalysis,
  analyzeLibrary,
  analyzeSongs,
  analyzeNewSongs,
  resumeAnalysis,
  stopAnalysis,
  setPlaybackActive,
  getAnalysisProgress: progressPayload,
};
