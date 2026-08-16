// @vitest-environment node
//
// The regression test for the bug that took the machine down: essentia.js's own
// computeFrameWise() leaks three WASM handles per frame, so a library-wide
// analysis pass grew without bound until workers aborted and, with six of them
// running, the Mac ran out of memory.
//
// This drives a real essentia build rather than a mock -- a mock would only
// assert that we call the delete() methods we remembered to call. It uses the
// UMD bundle because the ESM one assumes a browser or a bundler.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { melSpectrogram } from '../../src/renderer/analysis/mel-spectrogram.js';

const require = createRequire(import.meta.url);

// Five seconds of audio, and enough passes to be past where the leak used to
// show: the old code grew the heap on pass 14 of exactly this workload.
const SAMPLE_RATE = 16000;
const SECONDS = 5;
const PASSES = 16;

const heapMb = (wasm) => wasm.HEAPU8.length / (1024 * 1024);

let EssentiaWASM;
let extractor;
let samples;

beforeAll(() => {
  const wasmModule = require('essentia.js/dist/essentia-wasm.umd.js');
  const { EssentiaTFInputExtractor } = require('essentia.js/dist/essentia.js-model.umd.js');
  EssentiaWASM = wasmModule.EssentiaWASM || wasmModule;
  extractor = new EssentiaTFInputExtractor(EssentiaWASM, 'musicnn', false);

  samples = new Float32Array(SAMPLE_RATE * SECONDS);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.5;
});

describe('melSpectrogram', () => {
  it('produces exactly what essentia.js own extractor produces', () => {
    // The rewrite has to be a drop-in: same frames, same values, or every
    // embedding in the library shifts underneath the similarity search.
    const reference = extractor.computeFrameWise(samples);
    const ours = melSpectrogram(extractor, samples);

    expect(ours.length).toBe(reference.frameSize);
    for (let i = 0; i < ours.length; i++) {
      expect(Array.from(ours[i])).toEqual(Array.from(reference.melSpectrum[i]));
    }
  });

  it('leaves the WASM heap exactly where it found it, pass after pass', () => {
    melSpectrogram(extractor, samples);  // let one-time allocations settle
    const before = heapMb(EssentiaWASM);

    for (let pass = 0; pass < PASSES; pass++) {
      melSpectrogram(extractor, samples);
    }

    // Not "grew a little": an Emscripten heap never shrinks, so any growth at
    // all is unrecovered memory, and over a 4000-song library it is gigabytes.
    expect(heapMb(EssentiaWASM)).toBe(before);
  });

  it('would notice if handles started leaking again', () => {
    // Keeps the assertion above honest: prove the heap figure actually responds
    // to leaked handles, so a flat reading means something.
    const before = heapMb(EssentiaWASM);
    const leaked = [];
    const chunk = new Float32Array(SAMPLE_RATE * 10);
    while (heapMb(EssentiaWASM) === before && leaked.length < 200) {
      leaked.push(EssentiaWASM.arrayToVector(chunk));  // deliberately not deleted
    }

    expect(heapMb(EssentiaWASM)).toBeGreaterThan(before);
    leaked.forEach((vector) => vector.delete());
  });
});
