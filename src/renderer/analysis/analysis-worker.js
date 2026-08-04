/**
 * Audio analysis worker: mel-spectrogram + neural inference for one song at a time.
 *
 * Runs in a Web Worker so a library-wide analysis pass doesn't freeze the UI.
 * The page decodes audio (Web Audio has no worker equivalent) and posts raw
 * 16 kHz mono samples here; everything after that is pure computation.
 *
 * Two independent WASM runtimes are in play, and the split matters:
 *   - essentia.js computes the mel-spectrogram. This is ~77% of the wall clock,
 *     which is why the worker exists at all -- the neural net is the cheap part.
 *   - ONNX Runtime runs MSD-MusiCNN (embedding + 50 genre/mood activations) and
 *     the twelve tiny classification heads (~0.5 ms for all of them combined).
 *
 * essentia.js has no TensorFlow dependency, which is what lets us pair a GPL
 * feature extractor with an MIT inference runtime.
 */

import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { EssentiaTFInputExtractor } from 'essentia.js/dist/essentia.js-model.es.js';
import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import {
  SAMPLE_RATE, PATCH_SIZE, MEL_BANDS, PATCH_BATCH_SIZE,
  EMBEDDING_DIMS, ACTIVATION_DIMS, HEAD_FILES, AXIS_SPECS,
} from './model-config.js';

// Threads would need SharedArrayBuffer, which needs cross-origin isolation
// headers we don't control under file://. We get our parallelism from running
// several of these workers instead, so ask ORT for a plain single-threaded build.
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
ort.env.logLevel = 'error';

let extractor = null;
let mainSession = null;
let heads = null;

/** Load a head model and record how to feed it. Idempotent per worker. */
async function loadHead(baseUrl, name) {
  const [session, meta] = await Promise.all([
    ort.InferenceSession.create(new URL(`models/heads/${name}-msd-musicnn-1.onnx`, baseUrl).href),
    fetch(new URL(`models/heads/${name}-msd-musicnn-1.json`, baseUrl).href).then((r) => r.json()),
  ]);

  // Heads disagree on input rank: most take [N, 200], emomusic takes [N, 1, 200].
  // Read the expected shape off the model rather than guessing -- feeding the
  // wrong rank is a hard error, and guessing right for 11 of 12 is worse.
  const shape = session.inputMetadata[0].shape.map((d) => (typeof d === 'number' ? d : 1));

  return {
    name,
    session,
    classes: meta.classes,
    inputName: session.inputNames[0],
    outputName: session.outputNames[0],
    shape,
  };
}

/** One-time model + WASM load. Subsequent analyses reuse everything. */
async function initialize(baseUrl) {
  extractor = new EssentiaTFInputExtractor(EssentiaWASM, 'musicnn', false);
  mainSession = await ort.InferenceSession.create(
    new URL('models/msd-musicnn-1.onnx', baseUrl).href
  );
  heads = await Promise.all(HEAD_FILES.map((name) => loadHead(baseUrl, name)));
}

/**
 * Average the model's per-patch outputs over the whole track.
 *
 * MusiCNN sees ~3-second patches, so a 4-minute song produces ~85 of them. Mean
 * pooling is what Essentia's own reference pipeline does and is what makes the
 * embedding a whole-song fingerprint rather than a snapshot of one chorus.
 */
async function runMainModel(melSpectrum) {
  const numPatches = Math.floor(melSpectrum.length / PATCH_SIZE);
  if (numPatches === 0) {
    throw new Error('track is shorter than one analysis patch (~3 seconds)');
  }

  const embSum = new Float64Array(EMBEDDING_DIMS);
  const actSum = new Float64Array(ACTIVATION_DIMS);

  for (let start = 0; start < numPatches; start += PATCH_BATCH_SIZE) {
    const count = Math.min(PATCH_BATCH_SIZE, numPatches - start);
    const flat = new Float32Array(count * PATCH_SIZE * MEL_BANDS);
    for (let p = 0; p < count; p++) {
      for (let f = 0; f < PATCH_SIZE; f++) {
        flat.set(melSpectrum[(start + p) * PATCH_SIZE + f], (p * PATCH_SIZE + f) * MEL_BANDS);
      }
    }

    const out = await mainSession.run({
      melspectrogram: new ort.Tensor('float32', flat, [count, PATCH_SIZE, MEL_BANDS]),
    });
    const emb = out.embeddings.data;
    const act = out.activations.data;

    for (let p = 0; p < count; p++) {
      for (let i = 0; i < EMBEDDING_DIMS; i++) embSum[i] += emb[p * EMBEDDING_DIMS + i];
      for (let i = 0; i < ACTIVATION_DIMS; i++) actSum[i] += act[p * ACTIVATION_DIMS + i];
    }
  }

  const embedding = new Float32Array(EMBEDDING_DIMS);
  const activations = new Float32Array(ACTIVATION_DIMS);
  for (let i = 0; i < EMBEDDING_DIMS; i++) embedding[i] = embSum[i] / numPatches;
  for (let i = 0; i < ACTIVATION_DIMS; i++) activations[i] = actSum[i] / numPatches;
  return { embedding, activations, numPatches };
}

/**
 * Run every classification head on the pooled embedding and reduce each to a
 * named 0..1 scalar. Costs well under a millisecond for all twelve.
 */
async function runHeads(embedding) {
  const raw = {};
  for (const head of heads) {
    const out = await head.session.run({
      [head.inputName]: new ort.Tensor('float32', embedding, head.shape),
    });
    raw[head.name] = Array.from(out[head.outputName].data);
  }

  const axes = {};
  for (const spec of AXIS_SPECS) {
    const head = heads.find((h) => h.name === spec.head);
    // Match the output slot by CLASS NAME. The heads are inconsistent about
    // which class comes first, so indexing positionally silently inverts axes
    // like `party` and `relaxed`.
    const index = head.classes.indexOf(spec.positive);
    if (index === -1) {
      throw new Error(`head ${spec.head} has no class "${spec.positive}"`);
    }
    const value = raw[spec.head][index];
    // emomusic regresses onto Russell's 1..9 circumplex; everything else is
    // already a softmax probability.
    axes[spec.key] = spec.head === 'emomusic' ? (value - 1) / 8 : value;
  }
  axes.mirex = raw.moods_mirex;

  return axes;
}

/** Analyze one decoded track. `samples` is mono float32 at SAMPLE_RATE. */
async function analyze(samples) {
  const t0 = performance.now();
  const features = extractor.computeFrameWise(samples);
  const t1 = performance.now();
  const { embedding, activations, numPatches } = await runMainModel(features.melSpectrum);
  const t2 = performance.now();
  const axes = await runHeads(embedding);
  const t3 = performance.now();

  return {
    embedding,
    activations,
    axes,
    numPatches,
    timings: { mel: t1 - t0, infer: t2 - t1, heads: t3 - t2 },
  };
}

self.onmessage = async (event) => {
  const { type, id } = event.data;

  try {
    if (type === 'init') {
      await initialize(event.data.baseUrl);
      self.postMessage({ type: 'ready', id });
      return;
    }

    if (type === 'analyze') {
      const samples = new Float32Array(event.data.samples);
      const result = await analyze(samples);
      // Hand the typed arrays over rather than copying them; the worker has no
      // further use for them once the result is posted.
      self.postMessage(
        { type: 'result', id, ...result, embedding: result.embedding.buffer, activations: result.activations.buffer },
        [result.embedding.buffer, result.activations.buffer]
      );
      return;
    }

    throw new Error(`unknown message type: ${type}`);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error.message, stack: error.stack });
  }
};

// Only reachable if SAMPLE_RATE drifts out of sync with the extractor preset.
if (SAMPLE_RATE !== 16000) {
  throw new Error(`musicnn expects 16 kHz input, got SAMPLE_RATE=${SAMPLE_RATE}`);
}
