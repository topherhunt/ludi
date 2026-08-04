/**
 * Flattening the library onto a page you can look at.
 *
 * Same 200-dimensional space as similarity-index.js, squashed down to two
 * dimensions by UMAP. The point of the exercise is that UMAP tries hard to keep
 * *neighbourhoods* intact: songs that were close in 200 dimensions stay close on
 * the map, even though the distances themselves stop meaning anything. So a
 * cluster of related songs shows up as a visible clump, and the empty space
 * between clumps is real.
 *
 * What the axes mean: nothing. There is no "loud" direction or "fast" direction.
 * Left/right and up/down are whatever fell out of the optimisation, and they come
 * out differently for a different library. Only proximity is information.
 *
 * DETERMINISM. UMAP starts from random projections, so an unseeded run would
 * redraw the map from scratch every time -- the same library rearranged, which
 * would be alarming rather than useful. The PRNG is seeded (shared with
 * cluster-index.js, for the same reason).
 *
 * COST. This is the one genuinely slow query in the app: UMAP builds a k-nearest
 * -neighbour graph and then optimises it over hundreds of epochs. Seconds for a
 * few thousand songs, minutes for tens of thousands. That's why the coordinates
 * are cached in song_analysis rather than computed when the map is opened.
 *
 * Nothing here touches the database -- see music-map.js for that.
 */

const { UMAP } = require('umap-js');
const { EMBEDDING_DIMS } = require('./analysis/vocabulary');
const { makeRandom, DEFAULT_SEED } = require('./cluster-index');

// UMAP needs more points than it has neighbours to look at, and a map of eleven
// songs is a diagram, not a map. Same floor as clustering, for the same reason.
const MIN_SONGS_TO_MAP = 12;

// UMAP's two knobs. `nNeighbors` trades local detail (low) against overall shape
// (high); 15 is the library default and is a reasonable middle. `minDist` is how
// tightly points in a clump are allowed to pack -- 0.1 keeps clumps readable
// without smearing them into each other.
const NEIGHBORS = 15;
const MIN_DIST = 0.1;

// The map is drawn in world coordinates spanning [-1, 1] in both directions.
const MAP_EXTENT = 1;

/**
 * Rescale a projection into [-1, 1] without distorting it.
 *
 * Both axes get the same scale factor: UMAP's output is only meaningful up to
 * rotation and uniform scale, so stretching each axis to fill the box separately
 * would invent structure that isn't there.
 */
function normalize(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const halfWidth = (Math.max(...xs) - Math.min(...xs)) / 2;
  const halfHeight = (Math.max(...ys) - Math.min(...ys)) / 2;

  // A library of identical songs projects to a single point. Not an error --
  // just nothing to spread out -- so stack everything at the origin.
  const halfSpan = Math.max(halfWidth, halfHeight);
  const scale = halfSpan > 0 ? MAP_EXTENT / halfSpan : 0;

  return points.map(([x, y]) => [(x - centerX) * scale, (y - centerY) * scale]);
}

/**
 * Project every song in the index onto the map.
 *
 * @param {object} index from similarity-index.buildIndex
 * @param {{ seed?: number }} [options]
 * @returns {Array<{songId: number, x: number, y: number}>} empty if the library is too small
 */
function projectLibrary(index, options = {}) {
  const { seed = DEFAULT_SEED } = options;
  const { count, matrix, songIds } = index;
  if (count < MIN_SONGS_TO_MAP) return [];

  // umap-js wants plain arrays of arrays, not a flat typed matrix.
  const rows = Array.from({ length: count }, (unused, i) => (
    Array.from(matrix.subarray(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS))
  ));

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(NEIGHBORS, count - 1),
    minDist: MIN_DIST,
    random: makeRandom(seed),
  });

  const projected = normalize(umap.fit(rows));
  return projected.map(([x, y], i) => ({ songId: songIds[i], x, y }));
}

module.exports = {
  projectLibrary,
  MIN_SONGS_TO_MAP,
  MAP_EXTENT,
};
