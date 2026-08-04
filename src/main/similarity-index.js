/**
 * The maths behind "songs like this one".
 *
 * Every analyzed song is a point in 200-dimensional space, and similarity is the
 * cosine of the angle between two of those points. That sounds expensive and
 * isn't: 100k songs is 76 MB of floats, and comparing one song against all of
 * them is a single linear scan -- about 15 ms. So there's no index, no
 * approximate search, no tuning. We load the whole library into one flat
 * Float32Array and scan it.
 *
 * Two details do the real work:
 *
 * CENTERING. Raw MusiCNN embeddings all point roughly the same direction -- the
 * average cosine between two unrelated songs is around 0.9, not 0. That "hub"
 * component is what every song has in common (it's music, recorded, mixed), and
 * it drowns out what makes any one song distinct. Subtracting the library mean
 * before comparing removes it, and turns a meaningless 0.94-vs-0.91 into a
 * usable spread.
 *
 * DEDUPING. Libraries are full of the same song twice: an album copy and a
 * compilation copy, a single and its album version. Those score ~0.99 and would
 * otherwise fill the top of every result list with things you already know about.
 *
 * Nothing here touches the database -- see similarity.js for that. Keeping the
 * split means the ranking can be tested against hand-computed vectors.
 */

const { EMBEDDING_DIMS } = require('./analysis/vocabulary');

// Above this, two recordings are the same performance for practical purposes.
// Genuinely different songs by the same artist on the same album top out well
// below it, so this only catches duplicates and alternate encodings.
const DUPLICATE_THRESHOLD = 0.98;

// Below this the results stop being "similar" and start being "the least
// dissimilar thing left in your library". Better to return 8 good matches than
// 25 with a tail of noise.
const QUALITY_FLOOR = 0.5;

/**
 * Turn raw embedding blobs into a scannable index: one flat matrix of
 * mean-centered, unit-length rows, so a similarity is a single dot product.
 *
 * @param {Array<{ song_id: number, embedding: Buffer|Uint8Array }>} rows
 * @returns {{ count: number, matrix: Float32Array, songIds: Int32Array, mean: Float64Array, indexBySongId: Map }}
 */
function buildIndex(rows) {
  const count = rows.length;
  const matrix = new Float32Array(count * EMBEDDING_DIMS);
  const songIds = new Int32Array(count);

  rows.forEach((row, i) => {
    songIds[i] = row.song_id;
    // Copied rather than viewed: a Buffer's byteOffset is rarely 4-byte aligned,
    // and Float32Array refuses to view a misaligned buffer.
    const bytes = Uint8Array.from(row.embedding);
    matrix.set(new Float32Array(bytes.buffer, 0, EMBEDDING_DIMS), i * EMBEDDING_DIMS);
  });

  // Mean-center: see the module comment. Without this everything is similar to
  // everything and the rankings are dominated by overall loudness/production.
  const mean = new Float64Array(EMBEDDING_DIMS);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < EMBEDDING_DIMS; d++) mean[d] += matrix[i * EMBEDDING_DIMS + d];
  }
  for (let d = 0; d < EMBEDDING_DIMS; d++) mean[d] /= count || 1;

  // Normalize each row to unit length, so cosine similarity is a plain dot
  // product and the per-query work is one multiply-add per dimension.
  for (let i = 0; i < count; i++) {
    const offset = i * EMBEDDING_DIMS;
    let sumSquares = 0;
    for (let d = 0; d < EMBEDDING_DIMS; d++) {
      const centered = matrix[offset + d] - mean[d];
      matrix[offset + d] = centered;
      sumSquares += centered * centered;
    }
    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let d = 0; d < EMBEDDING_DIMS; d++) matrix[offset + d] /= norm;
    }
  }

  const indexBySongId = new Map();
  songIds.forEach((songId, i) => indexBySongId.set(songId, i));

  return { count, matrix, songIds, mean, indexBySongId };
}

/** Unit-length centered vector for one song, or null if it isn't in the index. */
function vectorFor(index, songId) {
  const position = index.indexBySongId.get(songId);
  if (position === undefined) return null;
  return index.matrix.subarray(position * EMBEDDING_DIMS, (position + 1) * EMBEDDING_DIMS);
}

/**
 * The direction to search in, given one or more seed songs.
 *
 * For several seeds this is their centroid: the middle of the region they
 * occupy. Picking three jazz tracks finds the jazz in your library rather than
 * three separate result lists stapled together. Re-normalized because averaging
 * unit vectors doesn't produce one.
 */
function centroidOf(index, songIds) {
  const vectors = songIds.map(songId => vectorFor(index, songId)).filter(Boolean);
  if (vectors.length === 0) return null;
  if (vectors.length === 1) return vectors[0];

  const centroid = new Float32Array(EMBEDDING_DIMS);
  for (const vector of vectors) {
    for (let d = 0; d < EMBEDDING_DIMS; d++) centroid[d] += vector[d];
  }
  let sumSquares = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d++) sumSquares += centroid[d] * centroid[d];
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return null;
  for (let d = 0; d < EMBEDDING_DIMS; d++) centroid[d] /= norm;
  return centroid;
}

/**
 * Rank the library against one or more seed songs.
 *
 * Rank-based rather than threshold-based: you asked for songs like this, so you
 * get the best `limit` of them, in order, each labelled with how similar it is.
 * `offset` walks further down the same ranking for a "show more" button, so page
 * two is the genuine next-best and not a re-query with looser rules.
 *
 * @param {object} index from buildIndex
 * @param {number[]} seedSongIds
 * @param {{ limit?: number, offset?: number, includeDuplicates?: boolean }} [options]
 * @returns {{ page: Array<{songId: number, similarity: number}>, total: number, seedsAnalyzed: number, duplicatesHidden: number }}
 */
function rankSimilar(index, seedSongIds, options = {}) {
  const { limit = 25, offset = 0, includeDuplicates = false } = options;
  const empty = { page: [], total: 0, seedsAnalyzed: 0, duplicatesHidden: 0 };

  const query = centroidOf(index, seedSongIds);
  if (!query) return empty;

  const { count, matrix, songIds } = index;
  const seeds = new Set(seedSongIds);
  const scored = [];
  let duplicatesHidden = 0;

  for (let i = 0; i < count; i++) {
    if (seeds.has(songIds[i])) continue;

    const rowOffset = i * EMBEDDING_DIMS;
    let score = 0;
    for (let d = 0; d < EMBEDDING_DIMS; d++) score += query[d] * matrix[rowOffset + d];

    if (score < QUALITY_FLOOR) continue;
    if (score >= DUPLICATE_THRESHOLD && !includeDuplicates) {
      duplicatesHidden++;
      continue;
    }
    scored.push({ songId: songIds[i], similarity: score });
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  return {
    page: scored.slice(offset, offset + limit),
    total: scored.length,
    seedsAnalyzed: seedSongIds.filter(songId => vectorFor(index, songId) !== null).length,
    duplicatesHidden,
  };
}

module.exports = {
  buildIndex,
  rankSimilar,
  QUALITY_FLOOR,
  DUPLICATE_THRESHOLD,
};
