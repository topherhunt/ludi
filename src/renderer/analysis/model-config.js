/**
 * Renderer-side view of the audio model definitions.
 *
 * Thin ESM wrapper over the shared JSON so the worker and the Electron main
 * process cannot drift apart on things like axis polarity or patch size. The
 * commentary explaining *why* each value is what it is lives in
 * src/main/analysis/vocabulary.js.
 */

import MODEL from '../../shared/audio-model.json';

export const SAMPLE_RATE = MODEL.sampleRate;
export const PATCH_SIZE = MODEL.patchSize;
export const MEL_BANDS = MODEL.melBands;
export const PATCH_BATCH_SIZE = MODEL.patchBatchSize;
export const EMBEDDING_DIMS = MODEL.embeddingDims;
export const ACTIVATION_DIMS = MODEL.activationDims;
export const MODEL_VERSION = MODEL.modelVersion;

export const AXIS_SPECS = MODEL.axes;
export const MIREX_CLUSTERS = MODEL.mirexClusters;

// Every head model the worker loads. Derived from the axis list so adding an
// axis can't leave its head unloaded.
export const HEAD_FILES = [...new Set(MODEL.axes.map((a) => a.head)), 'moods_mirex'];
