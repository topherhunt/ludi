/**
 * Clustering, against a library whose right answer is planted in advance.
 *
 * The fixture is thirty songs sitting on three mutually orthogonal directions,
 * ten each, with a small deterministic wobble so no two songs are identical.
 * Any clustering worth shipping has to recover exactly those three groups, so
 * the assertions are about the grouping itself rather than about numbers copied
 * from a previous run.
 */

import { describe, it, expect } from 'vitest';
import { buildIndex } from '../../src/main/similarity-index.js';
import {
  clusterLibrary,
  nameClusters,
  candidateKs,
  MIN_SONGS_TO_CLUSTER,
  MIN_SONGS_PER_CLUSTER,
} from '../../src/main/cluster-index.js';
import { EMBEDDING_DIMS } from '../../src/main/analysis/vocabulary.js';

const BLOCK = 50;
const BLOCK_SCALE = 1 / Math.sqrt(BLOCK);
const WOBBLE = 0.08;
const GROUP_SIZE = 10;
const GROUPS = 3;

/**
 * A song on group `g`'s direction, nudged by a per-song amount into the fourth
 * (unused) block so members are near each other without being duplicates.
 */
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

/** Which planted group each cluster drew from: clusterId -> Set of group numbers. */
function groupsPerCluster(assignments) {
  const byCluster = new Map();
  for (const { songId, clusterId } of assignments) {
    if (!byCluster.has(clusterId)) byCluster.set(clusterId, new Set());
    byCluster.get(clusterId).add(Math.floor(songId / 100));
  }
  return byCluster;
}

describe('clusterLibrary', () => {
  it('recovers the three groups the library was built from', () => {
    const result = clusterLibrary(plantedLibrary());

    expect(result.k).toBe(3);
    // Each cluster drew from exactly one planted group, and no group was split.
    const byCluster = groupsPerCluster(result.assignments);
    expect(byCluster.size).toBe(3);
    for (const groups of byCluster.values()) expect(groups.size).toBe(1);
    expect(result.sizes).toEqual([GROUP_SIZE, GROUP_SIZE, GROUP_SIZE]);
  });

  it('gives the same answer every run, so clusters do not shuffle themselves', () => {
    const first = clusterLibrary(plantedLibrary());
    const second = clusterLibrary(plantedLibrary());
    expect(second.assignments).toEqual(first.assignments);
  });

  it('scores a clean three-way split far above zero', () => {
    // Silhouette runs 0 (arbitrary) to 1 (perfectly separated). Planted groups
    // this distinct should be unambiguous.
    expect(clusterLibrary(plantedLibrary()).score).toBeGreaterThan(0.5);
  });

  it('declines to cluster a library too small to have groups', () => {
    const tiny = plantedLibrary(3, Math.floor((MIN_SONGS_TO_CLUSTER - 1) / 3));
    const result = clusterLibrary(tiny);
    expect(result.k).toBe(0);
    expect(result.assignments).toEqual([]);
  });

  it('labels every analyzed song with a cluster', () => {
    const result = clusterLibrary(plantedLibrary());
    expect(result.assignments).toHaveLength(GROUPS * GROUP_SIZE);
    for (const { clusterId } of result.assignments) {
      expect(clusterId).toBeGreaterThanOrEqual(0);
      expect(clusterId).toBeLessThan(result.k);
    }
  });
});

describe('candidateKs', () => {
  it('never proposes more clusters than the library can fill', () => {
    const candidates = candidateKs(30);
    expect(Math.max(...candidates)).toBe(Math.floor(30 / MIN_SONGS_PER_CLUSTER));
  });

  it('proposes nothing when even two clusters would be too thin', () => {
    expect(candidateKs(MIN_SONGS_PER_CLUSTER * 2 - 1)).toEqual([]);
  });
});

describe('nameClusters', () => {
  /** Ten songs per cluster, labelled by a { clusterId: [labels...] } spec. */
  function labelled(spec) {
    const assignments = [];
    const labels = new Map();
    let songId = 1;
    for (const [clusterId, perSong] of Object.entries(spec)) {
      for (const songLabels of perSong) {
        assignments.push({ songId, clusterId: Number(clusterId) });
        labels.set(songId, songLabels);
        songId++;
      }
    }
    return { assignments, labels };
  }

  const repeat = (count, labels) => Array.from({ length: count }, () => labels);

  it('names a cluster after what it has more of than the library does', () => {
    // "music" is on everything and says nothing; "jazz" is confined to cluster 1.
    const { assignments, labels } = labelled({
      0: repeat(10, ['music']),
      1: repeat(10, ['music', 'jazz']),
    });
    expect(nameClusters(assignments, labels, 2)[1]).toBe('jazz');
  });

  it('combines the two most distinctive labels', () => {
    const { assignments, labels } = labelled({
      0: repeat(10, ['pop']),
      1: [...repeat(8, ['jazz', 'live']), ...repeat(2, ['pop'])],
    });
    expect(nameClusters(assignments, labels, 2)[1]).toBe('jazz / live');
  });

  it('ignores a label the cluster has no more of than the library does', () => {
    // "pop" covers 80% of cluster 1, but 90% of the library: it says nothing
    // about this group. "rare" is distinctive but only two songs carry it.
    const { assignments, labels } = labelled({
      0: repeat(10, ['pop']),
      1: [...repeat(2, ['rare']), ...repeat(8, ['pop'])],
    });
    expect(nameClusters(assignments, labels, 2)[1]).toBe('Group 2');
  });

  it('ignores a label carried by only a couple of the cluster', () => {
    // "rare" is exclusive to cluster 1 and still not what it is about: two songs
    // out of ten cannot name a group.
    const { assignments, labels } = labelled({
      0: repeat(10, ['pop']),
      1: [...repeat(2, ['rare']), ...repeat(8, [])],
    });
    expect(nameClusters(assignments, labels, 2)[1]).toBe('Group 2');
  });

  it('falls back to a numbered name when nothing has been tagged', () => {
    const { assignments, labels } = labelled({ 0: repeat(10, []), 1: repeat(10, []) });
    expect(nameClusters(assignments, labels, 2)).toEqual(['Group 1', 'Group 2']);
  });
});
