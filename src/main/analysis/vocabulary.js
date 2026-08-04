/**
 * What the audio model can say about a song, and which of it we surface as tags.
 *
 * The raw data lives in src/shared/audio-model.json so the renderer's analysis
 * worker can import the same definitions; this module is where the reasoning
 * behind those definitions is recorded, plus the derived values only the main
 * process needs.
 *
 * Two vocabularies feed the auto-tagger:
 *
 *  1. msdClasses -- the 50 last.fm folksonomy labels MSD-MusiCNN predicts
 *     directly. The order MUST match the `classes` array in
 *     public/models/msd-musicnn-1.json; tests/unit/analysis-vocabulary.test.js
 *     enforces that, because the model emits a bare 50-float vector and an
 *     off-by-one would silently mislabel the entire library.
 *
 *  2. axes -- scalar outputs from twelve small classification heads that run on
 *     the 200-dim embedding. Each is reduced to a single 0..1 number.
 *
 * NOTHING HERE IS A THRESHOLD. The model's outputs are badly uncalibrated: across
 * a real library the *highest* MSD sigmoid we ever measured was 0.387, so any
 * absolute cutoff yields either zero tags or all of them. Cutoffs are derived
 * per-library from the observed distribution -- see tag-calibration.js.
 */

const MODEL = require('../../shared/audio-model.json');

// The model's 50 output classes, in output order. Do not reorder.
const MSD_CLASSES = MODEL.msdClasses;

/**
 * How each MSD class becomes (or doesn't become) a tag.
 *
 * `null` means "never tag with this":
 *   - Decade labels (00s/60s/70s/80s/90s/oldies) describe when a track was
 *     released, which the model cannot actually hear. It picks up production
 *     style at best, and gets it wrong often enough to be noise.
 *   - Subjective one-word judgements (beautiful, catchy, sexy) say more about the
 *     last.fm taggers than about the audio.
 *   - A handful (instrumental, acoustic, party, sad, happy) are dropped because a
 *     dedicated classification head answers the same question far better; keeping
 *     both would produce two differently-calibrated tags with the same name.
 *
 * A string value renames the class. last.fm's vocabulary has near-duplicates
 * ("female vocalists" / "female vocalist") and inconsistent casing; two classes
 * mapping to the same tag name are merged by taking the higher score.
 */
const MSD_TAG_NAMES = MODEL.msdTagNames;

/**
 * The classification heads, and how to read a scalar out of each.
 *
 * `positive` is the class name whose probability we keep. It MUST be matched by
 * name, not index: the heads disagree about ordering (danceability lists
 * "danceable" first, mood_party lists "non_party" first), so hard-coding index 0
 * would silently invert half the axes.
 *
 * `tag` is the tag name the axis produces for songs in the top slice of the
 * library; `lowTag` does the same at the bottom (an axis like vocal/instrumental
 * is informative at both ends). null at either end means "store and search it,
 * but don't tag".
 */
const AXES = MODEL.axes;

// The five MIREX mood clusters, stored per song as a probability vector. Their
// canonical names are unwieldy phrases, so each gets a short tag handle. Index
// order matches the head's `classes` array.
const MIREX_CLUSTERS = MODEL.mirexClusters;

// Every head file the worker loads, derived from AXES so the two can't drift.
const HEAD_NAMES = [...new Set(AXES.map((a) => a.head)), 'moods_mirex'];

/**
 * Model identity stamped onto every stored analysis. Bumping this invalidates
 * existing rows: songs whose stored version differs get re-queued, so a model
 * swap re-analyzes the library rather than silently mixing embeddings that
 * aren't comparable to each other.
 */
const MODEL_VERSION = MODEL.modelVersion;

const EMBEDDING_DIMS = MODEL.embeddingDims;
const ACTIVATION_DIMS = MODEL.activationDims;

module.exports = {
  MSD_CLASSES,
  MSD_TAG_NAMES,
  AXES,
  MIREX_CLUSTERS,
  HEAD_NAMES,
  MODEL_VERSION,
  EMBEDDING_DIMS,
  ACTIVATION_DIMS,
};
