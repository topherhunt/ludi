/**
 * Hard ceilings on what an analysis pass is allowed to cost in memory.
 *
 * An analysis pass is the only thing Ludi does that can plausibly exhaust a
 * machine: it runs several WASM runtimes at once, for hours, over files whose
 * length nobody bounds. Every number here exists to make the worst case
 * arithmetic rather than a matter of luck, so the pass degrades into "slower"
 * instead of "the Mac froze".
 *
 * The rule the rest of the analysis code follows: peak usage must be a product
 * of constants in this file, never a function of the library's size or of how
 * long the pass has been running.
 */

/**
 * Analyze at most this much of any one track.
 *
 * MusiCNN mean-pools its ~3-second patches into a single whole-song
 * fingerprint, so the tail of a long recording barely moves the result -- but
 * it costs memory linearly. Ten minutes covers essentially every song and
 * caps the mel-spectrogram of a two-hour DJ set at the same size as a
 * ten-minute one.
 */
export const MAX_ANALYSIS_SECONDS = 600;

/**
 * Refuse an audio file bigger than this rather than trying to decode it.
 *
 * decodeAudioData has to hold the whole compressed file AND the whole decoded
 * result at once; there is no streaming form of it. Past this size that spike
 * is the largest allocation in the app, so it fails loudly with a message
 * naming the file instead of taking the process out.
 */
export const MAX_AUDIO_FILE_MB = 512;

/**
 * Retire a worker whose essentia WASM heap has grown past this.
 *
 * The heap sits at 16 MB per track once handles are freed properly (see
 * mel-spectrogram.js), and an Emscripten heap never shrinks
 * -- so anything near this ceiling means something has started accumulating.
 * Rather than diagnose it mid-pass, the pool throws that worker away and
 * starts a fresh one.
 */
export const WORKER_HEAP_LIMIT_MB = 192;

/**
 * Retire a worker after this many tracks regardless of its heap.
 *
 * A backstop for growth the heap number can't see: ONNX Runtime arenas, JS
 * heap fragmentation, anything a future model brings with it. Respawning costs
 * about a second of model loading, which is noise across 200 tracks.
 */
export const MAX_TRACKS_PER_WORKER = 200;

/**
 * Memory to reserve per worker when sizing the pool.
 *
 * Generously above what one actually uses (the two WASM runtimes, 4 MB of
 * models, one track's mel-spectrogram, and the heap ceiling above), because
 * this number is what makes the pool's total footprint a promise rather than
 * an estimate.
 */
export const WORKER_BUDGET_MB = 256;

/** Beyond this the workers just contend for memory bandwidth. */
export const MAX_POOL_SIZE = 6;

/** Leave this many cores for the UI window, the player, and the OS. */
export const RESERVED_CORES = 2;

/**
 * How much of the machine an analysis pass may claim: the smaller of a share
 * of total RAM and a flat ceiling. The share is what keeps an 8 GB Mac from
 * being sized like a 64 GB one; the ceiling is what keeps a big Mac from
 * deciding that 12 workers is a reasonable thing to do to itself.
 */
export const MEMORY_BUDGET_FRACTION = 0.12;
export const MEMORY_BUDGET_MAX_MB = 1024;

/** The memory an analysis pass may use, given the machine's total RAM. */
export function memoryBudgetMb(totalMemoryMb) {
  if (!Number.isFinite(totalMemoryMb) || totalMemoryMb <= 0) {
    throw new Error(`memoryBudgetMb needs the machine's RAM in MB, got ${totalMemoryMb}`);
  }
  return Math.min(MEMORY_BUDGET_MAX_MB, Math.floor(totalMemoryMb * MEMORY_BUDGET_FRACTION));
}

/**
 * How many workers to run: whichever constraint binds first -- the memory
 * budget, the core count, how many songs are actually waiting, or the flat
 * ceiling. Always at least one, so a pass never silently does nothing.
 */
export function poolSize({ budgetMb, cores, queueDepth }) {
  for (const [name, value] of Object.entries({ budgetMb, cores, queueDepth })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`poolSize needs a positive ${name}, got ${value}`);
    }
  }
  return Math.max(1, Math.min(
    MAX_POOL_SIZE,
    Math.floor(budgetMb / WORKER_BUDGET_MB),
    cores - RESERVED_CORES,
    queueDepth,
  ));
}
