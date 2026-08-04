/**
 * The similarity ranking, against vectors whose answers are known in advance.
 *
 * The fixture library is built from three mutually orthogonal blocks of
 * dimensions, so every expected cosine below is exact arithmetic rather than a
 * number read off a previous run. Two properties make that possible:
 *
 *   - the songs are constructed so their mean is the zero vector, which means
 *     mean-centering leaves each one exactly as written; and
 *   - a large constant (COMMON) is added to every dimension of every stored
 *     embedding. Centering must remove it completely. If it ever stopped doing
 *     so, every pair in this file would score above 0.999 and the ordering
 *     assertions would collapse -- which is exactly the failure centering
 *     exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { buildIndex, rankSimilar, QUALITY_FLOOR, DUPLICATE_THRESHOLD } from '../../src/main/similarity-index.js';
import { EMBEDDING_DIMS } from '../../src/main/analysis/vocabulary.js';

// Three orthonormal directions, each spread over an equal block of dimensions.
const BLOCK = 50;
const BLOCK_SCALE = 1 / Math.sqrt(BLOCK);
const COMMON = 8;

/** A unit vector with the given coordinates in the (E0, E1, E2) basis. */
function vector([e0, e1, e2]) {
  const values = new Float32Array(EMBEDDING_DIMS).fill(COMMON);
  for (let d = 0; d < BLOCK; d++) {
    values[d] += e0 * BLOCK_SCALE;
    values[BLOCK + d] += e1 * BLOCK_SCALE;
    values[2 * BLOCK + d] += e2 * BLOCK_SCALE;
  }
  return Buffer.from(values.buffer);
}

// Coordinates chosen so each song's cosine to SEED is the number in its name.
// The third coordinate is whatever makes the vector unit length.
const COORDS = {
  seed:      [1, 0, 0],
  duplicate: [1, 0, 0],                    // an exact second copy of the seed
  at95:      [0.95, Math.sqrt(1 - 0.95 ** 2), 0],
  at90:      [0.90, Math.sqrt(1 - 0.90 ** 2), 0],
  at75:      [0.75, Math.sqrt(1 - 0.75 ** 2), 0],
  at55:      [0.55, Math.sqrt(1 - 0.55 ** 2), 0],
  // Orthogonal to the seed, and used as a second seed in the centroid tests.
  offAxis:   [0, 0, 1],
  // Middling on its own, but sits almost on the seed/offAxis centroid.
  between:   [0.6, Math.sqrt(1 - 0.6 ** 2 - 0.6 ** 2), 0.6],
};

const SONG_IDS = {
  seed: 1, duplicate: 2, at95: 3, at90: 4, at75: 5, at55: 6, offAxis: 7, between: 8,
  balance: 9,
};

/**
 * The ninth song cancels the other eight, putting the library mean at zero so
 * every centered vector equals the coordinates above. It ends up pointing away
 * from everything, and is filtered out by the quality floor in every test here.
 */
function balanceCoords() {
  const total = [0, 0, 0];
  for (const coords of Object.values(COORDS)) {
    for (let i = 0; i < 3; i++) total[i] += coords[i];
  }
  return total.map(v => -v);
}

function makeIndex() {
  const rows = Object.entries(COORDS).map(([name, coords]) => ({
    song_id: SONG_IDS[name],
    embedding: vector(coords),
  }));
  rows.push({ song_id: SONG_IDS.balance, embedding: vector(balanceCoords()) });
  return buildIndex(rows);
}

const rank = (seeds, options) => rankSimilar(makeIndex(), seeds, options);
const idsOf = (result) => result.page.map(entry => entry.songId);

describe('similarity ranking', () => {
  it('orders results by descending similarity to the seed', () => {
    const result = rank([SONG_IDS.seed]);
    expect(idsOf(result)).toEqual([
      SONG_IDS.at95, SONG_IDS.at90, SONG_IDS.at75, SONG_IDS.between, SONG_IDS.at55,
    ]);
  });

  it('reports the cosine to the seed as the similarity score', () => {
    const [first, second] = rank([SONG_IDS.seed]).page;
    expect(first.similarity).toBeCloseTo(0.95, 3);
    expect(second.similarity).toBeCloseTo(0.90, 3);
  });

  it('strips the component every song shares before comparing', () => {
    // Every stored embedding is dominated by COMMON=8 in all 200 dimensions.
    // Compared raw, the seed and the orthogonal offAxis song would score above
    // 0.99; centered, they are exactly perpendicular and offAxis is cut.
    const result = rank([SONG_IDS.seed]);
    expect(idsOf(result)).not.toContain(SONG_IDS.offAxis);
    expect(result.total).toBe(5);
  });

  it('never returns a seed song as its own match', () => {
    const result = rank([SONG_IDS.seed, SONG_IDS.at90]);
    expect(idsOf(result)).not.toContain(SONG_IDS.seed);
    expect(idsOf(result)).not.toContain(SONG_IDS.at90);
  });

  it('hides a second copy of the seed and says how many it hid', () => {
    const result = rank([SONG_IDS.seed]);
    expect(idsOf(result)).not.toContain(SONG_IDS.duplicate);
    expect(result.duplicatesHidden).toBe(1);
  });

  it('includes duplicates when explicitly asked for them', () => {
    const result = rank([SONG_IDS.seed], { includeDuplicates: true });
    expect(idsOf(result)[0]).toBe(SONG_IDS.duplicate);
    expect(result.duplicatesHidden).toBe(0);
  });

  it('drops matches below the quality floor rather than padding the list', () => {
    // at55 is the weakest match that survives; offAxis (0.0) and balance do not.
    const result = rank([SONG_IDS.seed]);
    expect(result.total).toBe(5);
    for (const entry of result.page) {
      expect(entry.similarity).toBeGreaterThanOrEqual(QUALITY_FLOOR);
    }
  });

  it('ranks several seeds by their centroid, not by any one of them', () => {
    // Alone, the seed prefers at90 (0.90) over between (0.60). Paired with
    // offAxis, the centroid swings toward between, which is the point of
    // seeding from a selection rather than running one search per song.
    expect(idsOf(rank([SONG_IDS.seed])).indexOf(SONG_IDS.at90))
      .toBeLessThan(idsOf(rank([SONG_IDS.seed])).indexOf(SONG_IDS.between));

    const paired = rank([SONG_IDS.seed, SONG_IDS.offAxis]);
    expect(idsOf(paired)[0]).toBe(SONG_IDS.between);
    expect(paired.page[0].similarity).toBeCloseTo(0.8485, 3);
  });

  it('walks further down the same ranking when given an offset', () => {
    const firstPage = rank([SONG_IDS.seed], { limit: 2, offset: 0 });
    const secondPage = rank([SONG_IDS.seed], { limit: 2, offset: 2 });

    expect(idsOf(firstPage)).toEqual([SONG_IDS.at95, SONG_IDS.at90]);
    expect(idsOf(secondPage)).toEqual([SONG_IDS.at75, SONG_IDS.between]);
    // Both pages report the full ranking length, so "show 25 more" knows when to stop.
    expect(firstPage.total).toBe(5);
    expect(secondPage.total).toBe(5);
  });

  it('reports no analyzed seeds when the seed song has no embedding', () => {
    const result = rank([9999]);
    expect(result.seedsAnalyzed).toBe(0);
    expect(result.page).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('counts only the seeds it could actually use', () => {
    const result = rank([SONG_IDS.seed, 9999]);
    expect(result.seedsAnalyzed).toBe(1);
    expect(result.total).toBeGreaterThan(0);
  });

  it('scores an exact copy at 1.0, above the duplicate threshold', () => {
    const result = rank([SONG_IDS.seed], { includeDuplicates: true });
    expect(result.page[0].similarity).toBeCloseTo(1, 5);
    expect(result.page[0].similarity).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });
});
