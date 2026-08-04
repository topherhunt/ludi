/**
 * Facet drill-down.
 *
 * The library under test is deliberately lopsided: "electronic" is on most of
 * it, "mellow" on a little of it, and "field recording" only ever appears with
 * "mellow". That's what separates the two orderings the view could use -- raw
 * count puts the big tag first everywhere, lift only rewards a tag that is
 * genuinely concentrated in the corner you drilled into.
 */

import { describe, it, expect } from 'vitest';
import { facetsFor, songsMatchingAll, countByTag } from '../../src/renderer/utils/facets.js';

const ELECTRONIC = { id: 1, name: 'electronic' };
const MELLOW = { id: 2, name: 'mellow' };
const FIELD = { id: 3, name: 'field recording' };
const LOUD = { id: 4, name: 'loud' };

// 10 songs: 8 electronic (2 of them mellow), 2 acoustic-ish mellow ones, and
// "field recording" only ever on mellow songs.
const LIBRARY = [
  { id: 1, tags: [ELECTRONIC, LOUD] },
  { id: 2, tags: [ELECTRONIC, LOUD] },
  { id: 3, tags: [ELECTRONIC, LOUD] },
  { id: 4, tags: [ELECTRONIC, LOUD] },
  { id: 5, tags: [ELECTRONIC] },
  { id: 6, tags: [ELECTRONIC] },
  { id: 7, tags: [ELECTRONIC, MELLOW, FIELD] },
  { id: 8, tags: [ELECTRONIC, MELLOW] },
  { id: 9, tags: [MELLOW, FIELD] },
  { id: 10, tags: [MELLOW] },
];

describe('songsMatchingAll', () => {
  it('matches everything when nothing has been picked yet', () => {
    expect(songsMatchingAll(LIBRARY, [])).toHaveLength(10);
  });

  it('requires every picked tag, not just one of them', () => {
    expect(songsMatchingAll(LIBRARY, [ELECTRONIC.id, MELLOW.id]).map(s => s.id)).toEqual([7, 8]);
  });

  it('returns nothing for a combination no song carries', () => {
    expect(songsMatchingAll(LIBRARY, [LOUD.id, MELLOW.id])).toEqual([]);
  });
});

describe('countByTag', () => {
  it('counts each tag once per song that carries it', () => {
    const counts = countByTag(LIBRARY);
    expect(counts.get(ELECTRONIC.id).count).toBe(8);
    expect(counts.get(MELLOW.id).count).toBe(4);
    expect(counts.get(FIELD.id).count).toBe(2);
  });
});

describe('facetsFor', () => {
  it('starts with every tag in the library, commonest first', () => {
    const { facets, matching } = facetsFor(LIBRARY, []);
    expect(matching).toHaveLength(10);
    expect(facets.map(f => [f.tag.name, f.count])).toEqual([
      ['electronic', 8],
      ['loud', 4],
      ['mellow', 4],
      ['field recording', 2],
    ]);
  });

  it('counts only the songs that carry the tags picked so far', () => {
    const { facets, matching } = facetsFor(LIBRARY, [MELLOW.id]);
    expect(matching.map(s => s.id)).toEqual([7, 8, 9, 10]);
    expect(facets.map(f => [f.tag.name, f.count])).toEqual([
      ['electronic', 2],
      ['field recording', 2],
    ]);
  });

  it('drops the tags already picked from the list to pick next', () => {
    const { facets } = facetsFor(LIBRARY, [MELLOW.id]);
    expect(facets.map(f => f.tag.id)).not.toContain(MELLOW.id);
  });

  it('scores a tag that only appears here far above one that is everywhere', () => {
    const { facets } = facetsFor(LIBRARY, [MELLOW.id]);
    const byName = Object.fromEntries(facets.map(f => [f.tag.name, f]));

    // "field recording" is on 2/10 of the library but 2/4 of the mellow songs.
    expect(byName['field recording'].share).toBe(0.5);
    expect(byName['field recording'].lift).toBe(2.5);
    // "electronic" is on 8/10 of the library and only 2/4 here -- less likely
    // than usual, so its lift is below 1 even though its count ties.
    expect(byName['electronic'].lift).toBeLessThan(1);
  });

  it('has nothing to offer once the picked tags match no songs', () => {
    expect(facetsFor(LIBRARY, [LOUD.id, MELLOW.id])).toEqual({ matching: [], facets: [] });
  });

  it('has nothing to offer for an empty library', () => {
    expect(facetsFor([], [])).toEqual({ matching: [], facets: [] });
  });
});
