/**
 * The music map's projection, against a library whose shape is planted.
 *
 * Same fixture idea as cluster-index.test.js: three groups of songs on three
 * directions that share no dimensions. UMAP is free to lay those groups out
 * anywhere on the page and to rotate or mirror them, so the assertions are about
 * the only thing the map promises -- that songs which were close in 200
 * dimensions end up close in two.
 */

import { describe, it, expect } from 'vitest';
import { buildIndex } from '../../src/main/similarity-index.js';
import { projectLibrary, MIN_SONGS_TO_MAP, MAP_EXTENT } from '../../src/main/map-projection.js';
import { EMBEDDING_DIMS } from '../../src/main/analysis/vocabulary.js';

const BLOCK = 50;
const BLOCK_SCALE = 1 / Math.sqrt(BLOCK);
const WOBBLE = 0.08;
const GROUP_SIZE = 12;
const GROUPS = 3;

function embedding(group, member) {
  const values = new Float32Array(EMBEDDING_DIMS);
  for (let d = 0; d < BLOCK; d++) {
    values[group * BLOCK + d] = BLOCK_SCALE;
    values[3 * BLOCK + d] = WOBBLE * BLOCK_SCALE * ((member % 5) - 2);
  }
  return Buffer.from(values.buffer);
}

/** song_id = group * 100 + member, so a song's id says which group it belongs in. */
function plantedLibrary(groups = GROUPS, size = GROUP_SIZE) {
  const rows = [];
  for (let group = 0; group < groups; group++) {
    for (let member = 0; member < size; member++) {
      rows.push({ song_id: group * 100 + member, embedding: embedding(group, member) });
    }
  }
  return buildIndex(rows);
}

const groupOf = (point) => Math.floor(point.songId / 100);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Mean distance between every pair of points, split by same-group or not. */
function pairDistances(points) {
  const same = [];
  const different = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const bucket = groupOf(points[i]) === groupOf(points[j]) ? same : different;
      bucket.push(distance(points[i], points[j]));
    }
  }
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  return { same: mean(same), different: mean(different) };
}

describe('projectLibrary', () => {
  it('places songs from the same planted group nearer each other than the rest', () => {
    const points = projectLibrary(plantedLibrary());

    expect(points).toHaveLength(GROUPS * GROUP_SIZE);
    const { same, different } = pairDistances(points);
    expect(same).toBeLessThan(different / 2);
  });

  it('gives every song exactly one position, keyed by its id', () => {
    const points = projectLibrary(plantedLibrary());

    const songIds = points.map(point => point.songId);
    expect(new Set(songIds).size).toBe(songIds.length);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('draws the same map twice from the same library', () => {
    const first = projectLibrary(plantedLibrary());
    const second = projectLibrary(plantedLibrary());

    expect(second).toEqual(first);
  });

  it('fits the whole library inside the map area, without stretching it', () => {
    const points = projectLibrary(plantedLibrary());

    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(MAP_EXTENT + 1e-9);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(MAP_EXTENT + 1e-9);
    }
    // One axis is filled edge to edge; the other keeps the shape's real ratio.
    const widest = Math.max(...points.map(p => Math.abs(p.x)), ...points.map(p => Math.abs(p.y)));
    expect(widest).toBeCloseTo(MAP_EXTENT, 6);
  });

  it('declines to draw a map of a library too small to have any shape', () => {
    const tooSmall = MIN_SONGS_TO_MAP - 1;
    expect(projectLibrary(plantedLibrary(1, tooSmall))).toEqual([]);
  });
});
