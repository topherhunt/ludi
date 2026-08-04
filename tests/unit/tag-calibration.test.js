/**
 * Which labels the auto-tagger decides are worth keeping.
 *
 * These thresholds are the difference between a library where every song says
 * "rock" and one where the tags mean something, and the failure is silent: the
 * tagger always produces *some* output. So the fixtures here are score tables
 * whose right answer is arithmetic -- a flat library with one or two songs
 * deliberately pushed out on a single label.
 */

import { describe, it, expect } from 'vitest';
import {
  selectMsdTags, selectAxisTags, percentileOf,
  MAX_MSD_TAGS_PER_SONG, MIREX_MIN_PROBABILITY,
} from '../../src/main/analysis/tag-calibration.js';
import { MSD_CLASSES, ACTIVATION_DIMS } from '../../src/main/analysis/vocabulary.js';

const column = (className) => MSD_CLASSES.indexOf(className);
const BASELINE = 0.1;

/** An activations BLOB: BASELINE everywhere, with the named labels overridden. */
function activations(overrides = {}) {
  const values = new Float32Array(ACTIVATION_DIMS).fill(BASELINE);
  for (const [className, score] of Object.entries(overrides)) {
    values[column(className)] = score;
  }
  return Buffer.from(values.buffer);
}

/**
 * A library of `size` unremarkable songs (ids 1..size), with `standouts` merged
 * in by index. Flat enough that any label a standout is high on has a large z.
 */
function msdRows(size, standouts = {}) {
  return Array.from({ length: size }, (unused, i) => ({
    song_id: i + 1,
    activations: activations(standouts[i] || {}),
  }));
}

const tagNamesFor = (result, songId) => result.get(songId).map((hit) => hit.tagName);

/** Axes with every head at `fill`, so only the overridden ones can fire. */
function axes(overrides = {}) {
  const base = {
    danceability: 0.5, acoustic: 0.5, aggressive: 0.5, electronic: 0.5,
    happy: 0.5, party: 0.5, relaxed: 0.5, sad: 0.5, tonal: 0.5,
    vocal: 0.5, valence: 0.5, arousal: 0.5,
    mirex: [0.2, 0.2, 0.2, 0.2, 0.2],
  };
  return { ...base, ...overrides };
}

function axisRows(size, standouts = {}) {
  return Array.from({ length: size }, (unused, i) => ({
    song_id: i + 1,
    axes: axes(standouts[i] || {}),
  }));
}

describe('MSD label selection', () => {
  it('tags only the songs that stand out on a label', () => {
    const result = selectMsdTags(msdRows(20, { 0: { jazz: 0.4 } }));
    expect(tagNamesFor(result, 1)).toEqual(['jazz']);
    for (let songId = 2; songId <= 20; songId++) {
      expect(tagNamesFor(result, songId)).toEqual([]);
    }
  });

  it('says nothing when every song scores the same on a label', () => {
    // A perfectly flat library has zero standard deviation everywhere, so no
    // label separates anything. Tagging all 20 songs "rock" would be worse than
    // tagging none of them.
    const result = selectMsdTags(msdRows(20));
    for (let songId = 1; songId <= 20; songId++) {
      expect(tagNamesFor(result, songId)).toEqual([]);
    }
  });

  it('judges a song against the library, not against an absolute score', () => {
    // 0.30 for jazz is a strong tag in a library that averages 0.1, and says
    // nothing in a library where every other song scores 0.32.
    const quiet = selectMsdTags(msdRows(20, { 0: { jazz: 0.3 } }));
    expect(tagNamesFor(quiet, 1)).toContain('jazz');

    const jazzy = msdRows(20).map((row, i) => ({
      ...row,
      activations: activations({ jazz: i === 0 ? 0.3 : 0.32 }),
    }));
    expect(tagNamesFor(selectMsdTags(jazzy), 1)).not.toContain('jazz');
  });

  it('keeps only a song\'s most distinctive labels', () => {
    // Song 1 scores 0.5 on eight labels at once. What separates them is how
    // many other songs share each label: "rock" is unique to song 1 and so says
    // the most about it, while "folk" is shared with seven others and says the
    // least. Only the top few survive, strongest first.
    const shared = ['rock', 'pop', 'jazz', 'metal', 'indie', 'dance', 'blues', 'folk'];
    const standouts = { 0: Object.fromEntries(shared.map((name) => [name, 0.5])) };
    shared.forEach((name, competitors) => {
      for (let i = 1; i <= competitors; i++) {
        standouts[i] = { ...standouts[i], [name]: 0.5 };
      }
    });

    const result = selectMsdTags(msdRows(20, standouts));
    expect(tagNamesFor(result, 1)).toEqual(['rock', 'pop', 'jazz', 'metal', 'indie']);
    expect(tagNamesFor(result, 1)).toHaveLength(MAX_MSD_TAGS_PER_SONG);
  });

  it('merges duplicate model classes into one tag, taking the stronger score', () => {
    // The model emits both "female vocalists" and "female vocalist". They are
    // the same tag; a song strong on either should get it exactly once.
    const result = selectMsdTags(msdRows(20, {
      0: { 'female vocalist': 0.5 },
      1: { 'female vocalists': 0.5 },
    }));
    expect(tagNamesFor(result, 1)).toEqual(['female vocals']);
    expect(tagNamesFor(result, 2)).toEqual(['female vocals']);
  });

  it('never tags with a class the model cannot actually hear', () => {
    // Decade labels are release dates, not sounds -- excluded from the
    // vocabulary no matter how confidently the model predicts them.
    const result = selectMsdTags(msdRows(20, { 0: { '80s': 0.9, 'beautiful': 0.9 } }));
    expect(tagNamesFor(result, 1)).toEqual([]);
  });

  it('reports how far up the library a tagged song sits', () => {
    const result = selectMsdTags(msdRows(20, { 0: { jazz: 0.4 } }));
    // Highest of 20, so above all 19 others.
    expect(result.get(1)[0].percentile).toBeCloseTo(1, 5);
  });
});

describe('axis label selection', () => {
  it('tags the high end of an axis when the head also agrees', () => {
    const rows = axisRows(20, { 0: { acoustic: 0.95 } });
    expect(tagNamesFor(selectAxisTags(rows), 1)).toContain('acoustic');
  });

  it('refuses the top of the library when the head itself is unconvinced', () => {
    // The most acoustic song in a library of electronica is still not acoustic.
    // Being in the top quarter is not enough on its own.
    const rows = axisRows(20).map((row, i) => ({
      ...row,
      axes: axes({ acoustic: 0.1 + i * 0.01 }),
    }));
    expect(tagNamesFor(selectAxisTags(rows), 20)).not.toContain('acoustic');
  });

  it('tags the low end of a two-sided axis with its opposite label', () => {
    const rows = axisRows(20, { 0: { vocal: 0.05 } });
    expect(tagNamesFor(selectAxisTags(rows), 1)).toContain('instrumental');
    expect(tagNamesFor(selectAxisTags(rows), 1)).not.toContain('vocals');
  });

  it('states low-end confidence as certainty, not as the raw score', () => {
    // The least vocal song in the library is 100% certain to be instrumental,
    // even though its vocal score is near zero.
    const rows = axisRows(20, { 0: { vocal: 0.05 } });
    const hit = selectAxisTags(rows).get(1).find((h) => h.tagName === 'instrumental');
    expect(hit.percentile).toBeCloseTo(1, 5);
  });

  it('applies at most one mood cluster, the one the head committed to', () => {
    const rows = axisRows(20, { 0: { mirex: [0.05, 0.05, 0.8, 0.05, 0.05] } });
    const moods = tagNamesFor(selectAxisTags(rows), 1)
      .filter((name) => ['rousing', 'cheerful', 'wistful', 'whimsical', 'intense'].includes(name));
    expect(moods).toEqual(['wistful']);
  });

  it('applies no mood when the five-way head is barely above chance', () => {
    const rows = axisRows(20, { 0: { mirex: [0.3, 0.2, 0.2, 0.15, 0.15] } });
    expect(0.3).toBeLessThan(MIREX_MIN_PROBABILITY);
    expect(tagNamesFor(selectAxisTags(rows), 1)).toEqual([]);
  });
});

describe('percentileOf', () => {
  it('places a value by how many of the library it beats', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentileOf(sorted, 1)).toBe(0);
    expect(percentileOf(sorted, 3)).toBe(0.5);
    expect(percentileOf(sorted, 5)).toBe(1);
  });

  it('calls a lone song top of its library rather than dividing by zero', () => {
    expect(percentileOf([0.4], 0.4)).toBe(1);
  });
});
