/**
 * The analyzer window: a hidden renderer whose only job is turning audio files
 * into embeddings.
 *
 * Why a renderer and not a utilityProcess: decoding mp3/m4a/ogg needs a codec.
 * Chromium already ships every codec the player supports, reachable through Web
 * Audio's decodeAudioData -- which exists in a renderer and nowhere else. The
 * alternative was bundling ffmpeg per platform, or a native ONNX build with no
 * Intel-Mac binary. Staying in a renderer keeps the whole analysis stack pure
 * WASM, so it runs identically everywhere the app does.
 *
 * Decoding happens here on the page's main thread (it's ~6% of the cost and
 * mostly native code); the expensive mel-spectrogram + inference work is fanned
 * out to a pool of Web Workers.
 *
 * This file owns the memory budget for the whole pass. Three rules keep the
 * worst case a matter of arithmetic rather than luck, all of them in terms of
 * the constants in limits.js:
 *
 *   1. The pool is sized from the memory the main process says we may use, not
 *      just from the core count.
 *   2. Exactly one decode runs at a time, and its result is truncated to
 *      MAX_ANALYSIS_SECONDS immediately, so what the page holds is bounded by
 *      the pool size rather than by how long the tracks are.
 *   3. A worker that has grown, or that has been alive a long time, or that
 *      has failed at all, is thrown away and replaced instead of trusted.
 */

import { SAMPLE_RATE } from './model-config.js';
import {
  MAX_ANALYSIS_SECONDS, MAX_AUDIO_FILE_MB,
  WORKER_HEAP_LIMIT_MB, MAX_TRACKS_PER_WORKER, memoryBudgetMb, poolSize,
} from './limits.js';

const api = window.analyzerAPI;

// Main passes the queue depth and the machine's RAM; see createAnalyzerWindow
// in src/main/analysis.js. Turning those into a worker count is policy, and it
// lives in limits.js with the rest of the memory ceilings.
const params = new URLSearchParams(location.search);
const POOL_SIZE = poolSize({
  budgetMb: memoryBudgetMb(Number(params.get('totalMemoryMb'))),
  cores: navigator.hardwareConcurrency || 4,
  queueDepth: Number(params.get('pending')),
});

/** Pool members that have finished loading models and are not currently busy. */
const idle = [];
/** taskId -> { resolve, reject, worker } for work currently in a worker. */
const pending = new Map();

let nextTaskId = 1;
let nextWorkerId = 1;

/**
 * One pool member: the Worker plus what we need to decide when to retire it.
 * Retiring is by identity, so a task always retires the worker it ran in even
 * if the pool has moved on.
 */
function createMember() {
  const member = { id: nextWorkerId++, worker: null, tracks: 0, retired: false };
  member.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });

  member.worker.onmessage = (event) => {
    const { type, id } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (type === 'error') entry.reject(new Error(event.data.message));
    else entry.resolve(event.data);
  };

  // A worker that dies takes its task with it. Fail that task loudly rather than
  // leaving the queue wedged on a promise that will never settle.
  member.worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      if (entry.worker === member.worker) {
        pending.delete(id);
        entry.reject(new Error(`analysis worker crashed: ${event.message}`));
      }
    }
  };

  return member;
}

/** Post a message to a member and await its matching reply. */
function call(member, message, transfer = []) {
  const id = nextTaskId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: member.worker });
    member.worker.postMessage({ ...message, id }, transfer);
  });
}

/** Load the models into a fresh member. Costs about a second. */
const initMember = (member) => call(member, { type: 'init', baseUrl: document.baseURI });

/** Take the next free member, waiting if all of them are busy. */
const waiters = [];
function acquire() {
  if (idle.length > 0) return Promise.resolve(idle.pop());
  return new Promise((resolve) => waiters.push(resolve));
}
function release(member) {
  const waiter = waiters.shift();
  if (waiter) waiter(member);
  else idle.push(member);
}

/**
 * Should this member be thrown away rather than reused?
 *
 * Any failure counts, deliberately. Bad files fail during decode, on this
 * page, so an error that comes back from a worker nearly always means its WASM
 * runtime is damaged -- an Emscripten abort() poisons the module permanently,
 * and every song routed to it afterwards fails too. That is exactly how one
 * out-of-memory worker turned into thousands of failures. Replacing a healthy
 * worker by mistake costs a second; keeping a poisoned one costs the pass.
 */
function shouldRetire(member, result, failed) {
  if (failed) return true;
  if (member.tracks >= MAX_TRACKS_PER_WORKER) return true;
  return result.heapMb >= WORKER_HEAP_LIMIT_MB;
}

/**
 * Put a member back to work, replacing it first if it has earned retirement.
 * The pool size never changes: one goes out, one comes in.
 */
async function releaseOrReplace(member, retire) {
  if (!retire) {
    release(member);
    return;
  }

  member.retired = true;
  member.worker.terminate();

  const replacement = createMember();
  try {
    await initMember(replacement);
  } catch (error) {
    // Losing the pool entirely is fatal: without workers nothing can proceed,
    // and main needs to stop the pass rather than watch every song fail.
    api.reportFatal(`could not replace analysis worker: ${error.message}`);
    return;
  }
  release(replacement);
}

/**
 * Decode an audio file to the mono 16 kHz float samples MusiCNN expects.
 *
 * The resampling is free: decodeAudioData renders into the context's sample
 * rate, so constructing the context at 16 kHz does the conversion in native code.
 *
 * decodeAudioData has no streaming form -- it holds the compressed file and the
 * decoded result at once -- so this is the largest transient allocation in the
 * app, and the two bounds around it are what keep it from being unbounded: an
 * outsized file is refused rather than attempted, and the result is cut to
 * MAX_ANALYSIS_SECONDS before anything else gets a reference to it.
 */
async function decode(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not read audio file (HTTP ${response.status})`);

  const sizeMb = Number(response.headers.get('content-length')) / (1024 * 1024);
  if (sizeMb > MAX_AUDIO_FILE_MB) {
    throw new Error(`audio file is too large to analyze (${Math.round(sizeMb)} MB, limit ${MAX_AUDIO_FILE_MB} MB)`);
  }

  const bytes = await response.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(bytes);
  const length = Math.min(buffer.length, MAX_ANALYSIS_SECONDS * SAMPLE_RATE);

  // One channel: copy out the analyzed span so the AudioBuffer behind it can be
  // collected immediately rather than being pinned by a subarray view.
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice(0, length);
  }

  // Downmix by averaging. MusiCNN was trained on mono; keeping one channel would
  // drop instruments that were panned hard to the other side.
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

/**
 * Decoding is serialized: it is ~6% of the work, so running one at a time costs
 * almost nothing, and it means the page holds one file's worth of undecoded and
 * decoded audio at a peak rather than POOL_SIZE of them.
 */
let decodeChain = Promise.resolve();
function decodeInTurn(url) {
  const result = decodeChain.then(() => decode(url));
  // Keep the chain alive past a failure, and don't let it retain results.
  decodeChain = result.then(() => undefined, () => undefined);
  return result;
}

/** Decode + analyze one song, and report the outcome back to the main process. */
async function runTask(task) {
  const started = performance.now();
  let samples;
  try {
    samples = await decodeInTurn(task.url);
  } catch (error) {
    // Decode failures are about the file, not the pool, so no worker is
    // involved and none is spent on them.
    api.reportResult({ songId: task.songId, ok: false, error: error.message });
    return;
  }

  const decoded = performance.now();
  const member = await acquire();
  member.tracks++;
  let result = null;
  let failed = false;

  try {
    result = await call(
      member,
      { type: 'analyze', samples: samples.buffer },
      [samples.buffer]
    );

    api.reportResult({
      songId: task.songId,
      ok: true,
      embedding: new Uint8Array(result.embedding),
      activations: new Uint8Array(result.activations),
      axes: result.axes,
      timings: {
        decode: decoded - started,
        ...result.timings,
        total: performance.now() - started,
      },
    });
  } catch (error) {
    failed = true;
    api.reportResult({ songId: task.songId, ok: false, error: error.message });
  } finally {
    await releaseOrReplace(member, shouldRetire(member, result, failed));
  }
}

async function main() {
  const members = Array.from({ length: POOL_SIZE }, createMember);
  // Model loading is I/O plus a WASM compile in each worker; do them together so
  // startup is one model load, not POOL_SIZE of them in series.
  await Promise.all(members.map(initMember));
  members.forEach(release);

  api.onTask((task) => { runTask(task); });
  api.ready({ slots: POOL_SIZE });
}

main().catch((error) => {
  api.reportFatal(`${error.message}\n${error.stack || ''}`);
});
