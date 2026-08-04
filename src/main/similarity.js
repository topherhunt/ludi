/**
 * "Songs like this one", against the live library.
 *
 * All of the maths lives in similarity-index.js; this is the part that knows
 * about the database: keeping the index in memory, noticing when it goes stale,
 * and turning a ranking of song ids into rows the explorer can render.
 */

const db = require('./database');
const { buildIndex, rankSimilar, QUALITY_FLOOR, DUPLICATE_THRESHOLD } = require('./similarity-index');

/** The whole library's embeddings, centered and normalized. Built on demand. */
let cache = null;
let cacheRevision = -1;

function getIndex() {
  // The library mean shifts as songs are added, so a stale index doesn't just
  // miss new songs -- it subtly misranks the old ones. Cheaper to rebuild than
  // to reason about which of those two failures you're looking at.
  const revision = db.getAnalysisRevision();
  if (!cache || cacheRevision !== revision) {
    cache = buildIndex(db.getAllEmbeddings());
    cacheRevision = revision;
  }
  return cache;
}

/**
 * Find songs that sound like the given ones.
 *
 * @param {number[]} seedSongIds
 * @param {{ limit?: number, offset?: number, includeDuplicates?: boolean }} [options]
 * @returns {{ results: Array, total: number, seedsAnalyzed: number, duplicatesHidden: number }}
 */
function findSimilar(seedSongIds, options = {}) {
  const { page, total, seedsAnalyzed, duplicatesHidden } =
    rankSimilar(getIndex(), seedSongIds, options);

  // Only look up song details for the page being shown. The scan above is
  // cheap; a hundred thousand SQLite row reads would not be.
  const similarityBySongId = new Map(page.map(({ songId, similarity }) => [songId, similarity]));
  const results = db.getSongsWithPlacements(page.map(({ songId }) => songId))
    .map(row => ({ ...row, similarity: similarityBySongId.get(row.song_id) }));

  return { results, total, seedsAnalyzed, duplicatesHidden };
}

/** Drop the cached index. Only needed by tests that swap the database out. */
function invalidate() {
  cache = null;
  cacheRevision = -1;
}

module.exports = {
  findSimilar,
  invalidate,
  QUALITY_FLOOR,
  DUPLICATE_THRESHOLD,
};
