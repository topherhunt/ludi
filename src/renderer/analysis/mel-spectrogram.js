/**
 * The mel-spectrogram of a whole track, one 96-band frame per 512 samples.
 *
 * This is a replacement for essentia.js's own EssentiaTFInputExtractor
 * .computeFrameWise(). It produces byte-identical output, but that one leaks
 * three Emscripten handles per frame -- the frame copy from frames.get(i), the
 * VectorFloat its compute() builds from that, and the bands vector it gets
 * back. None of the three is ever deleted, and an Emscripten heap only grows.
 *
 * At ~7500 frames for a four-minute track that came to roughly 35 MB of leaked
 * WASM heap per song, per worker. A few dozen songs in, each worker hit the
 * essentia build's hard 2 GB ceiling and started reporting
 * "abort(undefined)"; long before that, the renderer's memory pressure was
 * enough to make the page's own fetch and decodeAudioData calls fail. That is
 * what turned a library-wide pass into "292 analyzed, 3609 failed" -- and, with
 * six workers doing it at once, what exhausted system memory.
 *
 * Passing the frame vector straight to TensorflowInputMusiCNN also skips the
 * round trip through a Float32Array that compute() does, so this is slightly
 * faster as well as flat.
 *
 * Lives in its own module so the flatness can be tested against a real essentia
 * build without pulling in ONNX Runtime and the rest of the worker.
 *
 * @param {EssentiaTFInputExtractor} extractor a configured musicnn extractor
 * @param {Float32Array} samples mono audio at the extractor's sample rate
 * @returns {Float32Array[]} one 96-band frame per frameSize samples
 */
export function melSpectrogram(extractor, samples) {
  const { essentia, module, frameSize } = extractor;
  const frames = essentia.FrameGenerator(samples, frameSize, frameSize);
  const spectrogram = [];

  try {
    const frameCount = frames.size();
    for (let i = 0; i < frameCount; i++) {
      const frame = frames.get(i);
      let spectrum = null;
      try {
        spectrum = essentia.TensorflowInputMusiCNN(frame);
        spectrogram.push(module.vectorToArray(spectrum.bands));
      } finally {
        // Every handle that crossed the boundary, freed on the way out --
        // including when TensorflowInputMusiCNN throws partway through a track.
        if (spectrum) spectrum.bands.delete();
        frame.delete();
      }
    }
  } finally {
    frames.delete();
  }

  return spectrogram;
}
