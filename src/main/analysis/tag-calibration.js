/**
 * Deciding which labels are worth putting on a song.
 *
 * The hard part isn't the model, it's calibration. MSD-MusiCNN's 50 outputs are
 * sigmoids trained on a folksonomy where most tracks carry no tag at all, so the
 * absolute numbers are tiny and skewed: measured across a real library, the
 * single highest score for ANY tag on ANY song was 0.387. A "score > 0.5" rule
 * produces zero tags. A "score > 0.1" rule produces "rock" on everything,
 * because the base rate for rock is high on all of it.
 *
 * So we don't threshold the raw score at all. For each label we standardize
 * against the library itself -- how unusual is this song's score for this label,
 * compared to every other song you own? That turns "0.21 for jazz" (meaningless
 * on its own) into "higher than 97% of your library", which is exactly the
 * statement worth putting on a pill. It also means the tagger adapts: in a
 * library that's 90% metal, "metal" stops being informative and the tags that
 * survive are the ones that actually separate your music.
 *
 * The classification heads (danceable, acoustic, vocals...) are better behaved --
 * they're two-class softmaxes, so 0.5 genuinely means "more likely than not".
 * Those get the library-relative test AND an absolute sanity gate, so an
 * all-vocal library doesn't get its 20% least-vocal songs labelled instrumental.
 *
 * Nothing here touches the database -- see auto-tagger.js for that. Keeping the
 * split means these thresholds can be tested against hand-built score tables.
 */

const { MSD_CLASSES, MSD_TAG_NAMES, AXES, MIREX_CLUSTERS, ACTIVATION_DIMS } = require('./vocabulary');

// How far above the library's average a song must score before a label sticks,
// in standard deviations. 1.0 lands a label on roughly the top sixth of songs
// for that label -- distinctive without being so rare the facet browser is empty.
const MIN_Z_SCORE = 1.0;

// A song is described by its handful of most distinctive labels, not by every
// label it happens to be above average on. Without a cap, a track that sits at
// the top of a dozen correlated rock labels drowns out everything else.
const MAX_MSD_TAGS_PER_SONG = 5;

// Axis tags fire for the top/bottom slice of the library, and only when the head
// itself agrees. Both conditions must hold -- see the module comment.
const AXIS_HIGH_PERCENTILE = 0.75;
const AXIS_LOW_PERCENTILE = 0.25;
const AXIS_ABSOLUTE_GATE = 0.5;

// A five-way softmax is at 0.2 by chance. 0.35 means the head actually picked one.
const MIREX_MIN_PROBABILITY = 0.35;

/** Mean and standard deviation of one column of a score matrix. */
function columnStats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Where `value` falls within `sorted` (ascending), as a 0..1 fraction. Used for
 * the confidence shown on a tag: 0.97 reads as "top 3% of your library".
 */
function percentileOf(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return sorted.length <= 1 ? 1 : low / (sorted.length - 1);
}

/** Read a stored activations BLOB back into 50 floats. */
function decodeActivations(blob) {
  const bytes = Uint8Array.from(blob);
  return new Float32Array(bytes.buffer, 0, ACTIVATION_DIMS);
}

/**
 * Which MSD labels are distinctive for each song.
 *
 * @param {Array<{ song_id: number, activations: Buffer|Uint8Array }>} rows
 * @returns {Map<number, Array<{ tagName: string, z: number, percentile: number }>>}
 */
function selectMsdTags(rows) {
  const scores = rows.map((row) => decodeActivations(row.activations));

  // Several MSD classes collapse onto one tag name ("female vocalists" and
  // "female vocalist"), and a few are dropped entirely. Work in tag-name space
  // so the merge happens before we rank, taking the stronger of the two signals.
  const nameToColumns = new Map();
  MSD_CLASSES.forEach((className, index) => {
    const tagName = MSD_TAG_NAMES[className];
    if (!tagName) return;
    if (!nameToColumns.has(tagName)) nameToColumns.set(tagName, []);
    nameToColumns.get(tagName).push(index);
  });

  const perSong = new Map(rows.map((row) => [row.song_id, []]));

  for (const [tagName, columns] of nameToColumns) {
    const values = scores.map((score) => Math.max(...columns.map((c) => score[c])));
    const { mean, stdDev } = columnStats(values);
    if (stdDev === 0) continue;  // every song scores identically: says nothing
    const sorted = [...values].sort((a, b) => a - b);

    values.forEach((value, i) => {
      const z = (value - mean) / stdDev;
      if (z < MIN_Z_SCORE) return;
      perSong.get(rows[i].song_id).push({ tagName, z, percentile: percentileOf(sorted, value) });
    });
  }

  for (const [songId, candidates] of perSong) {
    candidates.sort((a, b) => b.z - a.z);
    perSong.set(songId, candidates.slice(0, MAX_MSD_TAGS_PER_SONG));
  }
  return perSong;
}

/**
 * Which axis labels apply to each song, from the classification heads.
 *
 * @param {Array<{ song_id: number, axes: object }>} rows
 * @returns {Map<number, Array<{ tagName: string, percentile: number }>>}
 */
function selectAxisTags(rows) {
  const perSong = new Map(rows.map((row) => [row.song_id, []]));

  for (const axis of AXES) {
    if (!axis.tag && !axis.lowTag) continue;
    const values = rows.map((row) => row.axes[axis.key]);
    const sorted = [...values].sort((a, b) => a - b);

    values.forEach((value, i) => {
      const percentile = percentileOf(sorted, value);
      const list = perSong.get(rows[i].song_id);
      if (axis.tag && percentile >= AXIS_HIGH_PERCENTILE && value > AXIS_ABSOLUTE_GATE) {
        list.push({ tagName: axis.tag, percentile });
      } else if (axis.lowTag && percentile <= AXIS_LOW_PERCENTILE && value < AXIS_ABSOLUTE_GATE) {
        // The low end is just as confident as the high end -- invert so the
        // number still reads as "how sure are we", not "how high did it score".
        list.push({ tagName: axis.lowTag, percentile: 1 - percentile });
      }
    });
  }

  // The single strongest MIREX mood cluster, when the head actually committed.
  for (const row of rows) {
    const probabilities = row.axes.mirex;
    if (!probabilities) continue;
    let best = 0;
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > probabilities[best]) best = i;
    }
    if (probabilities[best] >= MIREX_MIN_PROBABILITY) {
      perSong.get(row.song_id).push({
        tagName: MIREX_CLUSTERS[best].tag,
        percentile: probabilities[best],
      });
    }
  }

  return perSong;
}

module.exports = {
  selectMsdTags,
  selectAxisTags,
  percentileOf,
  MIN_Z_SCORE,
  MAX_MSD_TAGS_PER_SONG,
  AXIS_HIGH_PERCENTILE,
  AXIS_LOW_PERCENTILE,
  AXIS_ABSOLUTE_GATE,
  MIREX_MIN_PROBABILITY,
};
