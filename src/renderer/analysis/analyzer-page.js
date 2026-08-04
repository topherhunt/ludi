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
 */

import { SAMPLE_RATE } from './model-config.js';

const api = window.analyzerAPI;

// Leave a couple of cores for the UI window and the OS. Beyond ~6 workers the
// gain flattens out anyway -- they contend for the same memory bandwidth.
//
// Never more workers than there are songs waiting: each one loads ~17 MB of WASM
// and model weights, so analyzing a single newly-imported track shouldn't cost
// six of those. Main passes the queue depth at the moment it opened this window;
// a pass that later grows keeps the smaller pool until the next one starts.
const queueDepth = Number(new URLSearchParams(location.search).get('pending')) || 1;
const POOL_SIZE = Math.max(1, Math.min(6, queueDepth, (navigator.hardwareConcurrency || 4) - 2));

/** Workers that have finished loading models and are not currently busy. */
const idle = [];
/** taskId -> { resolve, reject } for work currently in a worker. */
const pending = new Map();

let nextTaskId = 1;

function createWorker() {
  const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = (event) => {
    const { type, id } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (type === 'error') entry.reject(new Error(event.data.message));
    else entry.resolve(event.data);
  };

  // A worker that dies takes its task with it. Fail that task loudly rather than
  // leaving the queue wedged on a promise that will never settle.
  worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      if (entry.worker === worker) {
        pending.delete(id);
        entry.reject(new Error(`analysis worker crashed: ${event.message}`));
      }
    }
  };

  return worker;
}

/** Post a message to a worker and await its matching reply. */
function call(worker, message, transfer = []) {
  const id = nextTaskId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker });
    worker.postMessage({ ...message, id }, transfer);
  });
}

/** Take the next free worker, waiting if all of them are busy. */
const waiters = [];
function acquire() {
  if (idle.length > 0) return Promise.resolve(idle.pop());
  return new Promise((resolve) => waiters.push(resolve));
}
function release(worker) {
  const waiter = waiters.shift();
  if (waiter) waiter(worker);
  else idle.push(worker);
}

/**
 * Decode an audio file to the mono 16 kHz float samples MusiCNN expects.
 *
 * The resampling is free: decodeAudioData renders into the context's sample
 * rate, so constructing the context at 16 kHz does the conversion in native code.
 */
async function decode(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not read audio file (HTTP ${response.status})`);
  const bytes = await response.arrayBuffer();

  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(bytes);

  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  // Downmix by averaging. MusiCNN was trained on mono; keeping one channel would
  // drop instruments that were panned hard to the other side.
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

/** Decode + analyze one song, and report the outcome back to the main process. */
async function runTask(task) {
  const worker = await acquire();
  const started = performance.now();
  try {
    const samples = await decode(task.url);
    const decoded = performance.now();

    const result = await call(
      worker,
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
    api.reportResult({ songId: task.songId, ok: false, error: error.message });
  } finally {
    release(worker);
  }
}

async function main() {
  const workers = Array.from({ length: POOL_SIZE }, createWorker);
  // Model loading is I/O plus a WASM compile in each worker; do them together so
  // startup is one model load, not POOL_SIZE of them in series.
  await Promise.all(workers.map((w) => call(w, { type: 'init', baseUrl: document.baseURI })));
  workers.forEach((w) => idle.push(w));

  api.onTask((task) => { runTask(task); });
  api.ready({ slots: POOL_SIZE });
}

main().catch((error) => {
  api.reportFatal(`${error.message}\n${error.stack || ''}`);
});
