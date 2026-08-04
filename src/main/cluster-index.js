/**
 * Carving the library into groups of songs that sound alike.
 *
 * Same 200-dimensional space as similarity-index.js, and the same idea of
 * closeness (cosine between mean-centered vectors), asked the other way round:
 * instead of "what is near this song", it's "where are the crowds". The answer
 * is spherical k-means -- ordinary k-means, but on unit vectors, so a distance
 * is 1 minus a dot product and a cluster centre gets re-normalized after every
 * update.
 *
 * Two things make the result usable rather than merely mathematical:
 *
 * CHOOSING K. Nobody knows how many kinds of music are in their library, and a
 * wrong k is worse than useless -- too few and everything is "rock", too many
 * and you get forty clusters of nine songs. So we run k-means at several
 * candidate values and keep the one with the best silhouette score, which
 * measures how much closer each song is to its own cluster than to the next
 * nearest one. Silhouette is O(n^2), so it runs on a sample; the clustering
 * itself always uses every song.
 *
 * DETERMINISM. k-means starts from random seeds, and a library that regroups
 * itself differently every run is not something you can trust or test. The PRNG
 * is seeded, so the same library always produces the same clusters.
 *
 * Nothing here touches the database -- see clusters.js for that.
 */

const { EMBEDDING_DIMS } = require('./analysis/vocabulary');

// Below this there aren't enough songs for "groups" to mean anything; a dozen
// songs split five ways is just a list with extra steps.
const MIN_SONGS_TO_CLUSTER = 12;

// Candidate cluster counts. The upper end is also bounded by the library size,
// so a small library can't be shattered into pairs.
const K_MIN = 2;
const K_MAX = 20;
const MIN_SONGS_PER_CLUSTER = 4;

// k-means stops when no song changes cluster; this is the backstop for the rare
// library that oscillates between two equally good assignments.
const MAX_ITERATIONS = 30;

// Silhouette is quadratic, so it looks at a sample. 400 points is 160k distance
// computations per candidate k -- milliseconds -- and is plenty to tell a good
// k from a bad one.
const SILHOUETTE_SAMPLE = 400;

const DEFAULT_SEED = 0x5eed;

/**
 * Small deterministic PRNG (mulberry32). Not for anything that needs to be
 * unguessable -- only for making "random" starting centres reproducible.
 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dot product of row `i` of the matrix with a vector. Rows are unit length. */
function dotRow(matrix, i, vector) {
  const offset = i * EMBEDDING_DIMS;
  let sum = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d++) sum += matrix[offset + d] * vector[d];
  return sum;
}

/** Cosine distance between two rows of the matrix, in [0, 2]. */
function rowDistance(matrix, i, j) {
  const a = i * EMBEDDING_DIMS;
  const b = j * EMBEDDING_DIMS;
  let sum = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d++) sum += matrix[a + d] * matrix[b + d];
  return 1 - sum;
}

/** In-place normalize to unit length. Returns false if the vector was all zeros. */
function normalize(vector) {
  let sumSquares = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d++) sumSquares += vector[d] * vector[d];
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return false;
  for (let d = 0; d < EMBEDDING_DIMS; d++) vector[d] /= norm;
  return true;
}

/**
 * k-means++ seeding: first centre at random, each subsequent centre chosen with
 * probability proportional to its squared distance from the nearest centre
 * already chosen. Plain random seeding regularly puts two centres inside the
 * same genre and leaves another with none.
 */
function seedCentroids(matrix, count, k, random) {
  const centroids = new Float32Array(k * EMBEDDING_DIMS);
  const first = Math.floor(random() * count);
  centroids.set(matrix.subarray(first * EMBEDDING_DIMS, (first + 1) * EMBEDDING_DIMS), 0);

  const nearest = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    nearest[i] = 1 - dotRow(matrix, i, centroids.subarray(0, EMBEDDING_DIMS));
  }

  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < count; i++) total += nearest[i] * nearest[i];

    // Every point sits on top of a centre already (a library of duplicates):
    // fall back to spreading the remaining centres evenly.
    let chosen = total > 0 ? -1 : Math.floor(random() * count);
    if (total > 0) {
      let target = random() * total;
      for (let i = 0; i < count; i++) {
        target -= nearest[i] * nearest[i];
        if (target <= 0) { chosen = i; break; }
      }
      if (chosen === -1) chosen = count - 1;
    }

    const offset = c * EMBEDDING_DIMS;
    centroids.set(matrix.subarray(chosen * EMBEDDING_DIMS, (chosen + 1) * EMBEDDING_DIMS), offset);
    for (let i = 0; i < count; i++) {
      const distance = 1 - dotRow(matrix, i, centroids.subarray(offset, offset + EMBEDDING_DIMS));
      if (distance < nearest[i]) nearest[i] = distance;
    }
  }

  return centroids;
}

/**
 * Run spherical k-means to convergence.
 *
 * @returns {{ assignments: Int32Array, centroids: Float32Array }}
 */
function kmeans(matrix, count, k, seed = DEFAULT_SEED) {
  const random = makeRandom(seed);
  let centroids = seedCentroids(matrix, count, k, random);
  const assignments = new Int32Array(count).fill(-1);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let moved = 0;

    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < k; c++) {
        const score = dotRow(matrix, i, centroids.subarray(c * EMBEDDING_DIMS, (c + 1) * EMBEDDING_DIMS));
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; moved++; }
    }

    const next = new Float32Array(k * EMBEDDING_DIMS);
    const sizes = new Int32Array(k);
    for (let i = 0; i < count; i++) {
      const offset = assignments[i] * EMBEDDING_DIMS;
      const rowOffset = i * EMBEDDING_DIMS;
      for (let d = 0; d < EMBEDDING_DIMS; d++) next[offset + d] += matrix[rowOffset + d];
      sizes[assignments[i]]++;
    }

    for (let c = 0; c < k; c++) {
      const centre = next.subarray(c * EMBEDDING_DIMS, (c + 1) * EMBEDDING_DIMS);
      // A cluster nobody joined is a wasted group: restart it on the song that
      // fits its own cluster worst, which is where a new group is most needed.
      if (sizes[c] === 0 || !normalize(centre)) {
        const orphan = worstFitting(matrix, count, assignments, centroids, k);
        centre.set(matrix.subarray(orphan * EMBEDDING_DIMS, (orphan + 1) * EMBEDDING_DIMS));
      }
    }

    centroids = next;
    if (moved === 0) break;
  }

  return { assignments, centroids };
}

/** The song least well described by the cluster it currently sits in. */
function worstFitting(matrix, count, assignments, centroids, k) {
  let worst = 0;
  let worstScore = Infinity;
  for (let i = 0; i < count; i++) {
    const c = assignments[i];
    if (c < 0 || c >= k) continue;
    const score = dotRow(matrix, i, centroids.subarray(c * EMBEDDING_DIMS, (c + 1) * EMBEDDING_DIMS));
    if (score < worstScore) { worstScore = score; worst = i; }
  }
  return worst;
}

/**
 * Mean silhouette over a sample: for each sampled song, how much closer it is to
 * its own cluster than to the nearest other one, scaled to [-1, 1]. Higher is a
 * cleaner split.
 */
function silhouette(matrix, count, assignments, k, seed = DEFAULT_SEED) {
  const random = makeRandom(seed);
  const sample = [];
  // Reservoir-free sampling: keep each song with a fixed probability. Cheaper
  // than a shuffle and the sample size only needs to be approximate.
  const keepRate = Math.min(1, SILHOUETTE_SAMPLE / count);
  for (let i = 0; i < count; i++) {
    if (random() < keepRate) sample.push(i);
  }
  if (sample.length < k + 1) return -1;

  let total = 0;
  let scored = 0;

  for (const i of sample) {
    const sums = new Float64Array(k);
    const counts = new Int32Array(k);
    for (const j of sample) {
      if (j === i) continue;
      const c = assignments[j];
      sums[c] += rowDistance(matrix, i, j);
      counts[c]++;
    }

    const own = assignments[i];
    if (counts[own] === 0) continue; // alone in the sample: no opinion to give

    const a = sums[own] / counts[own];
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || counts[c] === 0) continue;
      b = Math.min(b, sums[c] / counts[c]);
    }
    if (b === Infinity) continue;

    total += (b - a) / Math.max(a, b);
    scored++;
  }

  return scored === 0 ? -1 : total / scored;
}

/** The candidate cluster counts worth trying for a library of this size. */
function candidateKs(count) {
  const maxK = Math.min(K_MAX, Math.floor(count / MIN_SONGS_PER_CLUSTER));
  const candidates = [];
  for (let k = K_MIN; k <= maxK; k++) candidates.push(k);
  return candidates;
}

/**
 * Group the library, choosing the number of groups by silhouette score.
 *
 * @param {{ count: number, matrix: Float32Array, songIds: Int32Array }} index
 * @param {{ seed?: number }} [options]
 * @returns {{ k: number, score: number, assignments: Array<{songId: number, clusterId: number}>, sizes: number[] }}
 */
function clusterLibrary(index, options = {}) {
  const { seed = DEFAULT_SEED } = options;
  const { count, matrix, songIds } = index;
  const empty = { k: 0, score: -1, assignments: [], sizes: [] };

  if (count < MIN_SONGS_TO_CLUSTER) return empty;
  const candidates = candidateKs(count);
  if (candidates.length === 0) return empty;

  let best = null;
  for (const k of candidates) {
    const { assignments } = kmeans(matrix, count, k, seed);
    const score = silhouette(matrix, count, assignments, k, seed);
    if (!best || score > best.score) best = { k, score, assignments };
  }

  // A cluster can end up with nobody in it (two restarts landing on the same
  // song). Renumber so cluster ids are always 0..k-1 with no gaps -- everything
  // downstream indexes by cluster id.
  const rawSizes = new Array(best.k).fill(0);
  for (let i = 0; i < count; i++) rawSizes[best.assignments[i]]++;

  const remap = new Map();
  const sizes = [];
  rawSizes.forEach((size, clusterId) => {
    if (size === 0) return;
    remap.set(clusterId, sizes.length);
    sizes.push(size);
  });

  return {
    k: sizes.length,
    score: best.score,
    assignments: Array.from({ length: count }, (unused, i) => ({
      songId: songIds[i],
      clusterId: remap.get(best.assignments[i]),
    })),
    sizes,
  };
}

// A label has to describe a decent share of the cluster before it can name it.
// Without this, one song with a rare tag names the group it happens to land in.
const MIN_LABEL_SHARE = 0.3;
const MIN_LABEL_SONGS = 3;
const LABELS_PER_NAME = 2;

// ...and it has to be more common here than in the library at large. A label
// carried by everything describes the collection, not the group: naming a
// cluster "rock" in an all-rock library is true and useless.
const MIN_LABEL_LIFT = 1.25;

/**
 * Name each cluster after the labels it has more of than the library does.
 *
 * Frequency alone would name every cluster after whatever tag is commonest
 * overall. What identifies a group is over-representation: "rock" naming the
 * cluster that is 80% rock in a library that is 30% rock.
 *
 * @param {Array<{songId: number, clusterId: number}>} assignments
 * @param {Map<number, string[]>} labelsBySongId
 * @param {number} k
 * @returns {string[]} one name per cluster id
 */
function nameClusters(assignments, labelsBySongId, k) {
  const libraryCounts = new Map();
  const clusterCounts = Array.from({ length: k }, () => new Map());
  const sizes = new Array(k).fill(0);

  for (const { songId, clusterId } of assignments) {
    sizes[clusterId]++;
    const labels = new Set(labelsBySongId.get(songId) || []);
    for (const label of labels) {
      libraryCounts.set(label, (libraryCounts.get(label) || 0) + 1);
      const counts = clusterCounts[clusterId];
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  const total = assignments.length;
  return Array.from({ length: k }, (unused, clusterId) => {
    const size = sizes[clusterId];
    const ranked = [];
    for (const [label, inCluster] of clusterCounts[clusterId]) {
      if (inCluster < MIN_LABEL_SONGS || inCluster / size < MIN_LABEL_SHARE) continue;
      const lift = (inCluster / size) / (libraryCounts.get(label) / total);
      if (lift < MIN_LABEL_LIFT) continue;
      ranked.push({ label, lift, inCluster });
    }
    // Ties broken by how much of the cluster the label covers, then by name, so
    // the same library always produces the same names.
    ranked.sort((a, b) => (b.lift - a.lift) || (b.inCluster - a.inCluster) || a.label.localeCompare(b.label));

    const chosen = ranked.slice(0, LABELS_PER_NAME).map(entry => entry.label);
    return chosen.length > 0 ? chosen.join(' / ') : `Group ${clusterId + 1}`;
  });
}

module.exports = {
  clusterLibrary,
  nameClusters,
  kmeans,
  silhouette,
  candidateKs,
  // Exported for map-projection.js, which needs its own reproducible randomness
  // for exactly the same reason this module does.
  makeRandom,
  DEFAULT_SEED,
  MIN_SONGS_TO_CLUSTER,
  K_MIN,
  K_MAX,
  MIN_SONGS_PER_CLUSTER,
  MIN_LABEL_SHARE,
  MIN_LABEL_SONGS,
  MIN_LABEL_LIFT,
};
