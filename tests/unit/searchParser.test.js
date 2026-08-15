import { describe, it, expect } from 'vitest';
import { parseQuery, evaluateSong } from '../../src/renderer/utils/searchParser.js';

const makeSong = (overrides = {}) => ({
  title: 'Blue Moon',
  artist: 'Miles Davis',
  album: 'Kind of Blue',
  track_number: 3,
  ancestorFolderNames: ['Jazz', 'Modal'],
  ...overrides,
});

describe('parseQuery', () => {
  it('returns null for empty string', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery('   ')).toBeNull();
  });

  it('parses plain text token', () => {
    const ast = parseQuery('miles');
    expect(ast).toMatchObject({ type: 'PLAIN', value: 'miles' });
  });

  it('parses field condition', () => {
    const ast = parseQuery('artist=Davis');
    expect(ast).toMatchObject({ type: 'COND', field: 'artist', value: 'Davis' });
  });

  it('parses quoted field value', () => {
    const ast = parseQuery('title="Kind of Blue"');
    expect(ast).toMatchObject({ type: 'COND', field: 'title', value: 'Kind of Blue' });
  });

  it('parses AND expression', () => {
    const ast = parseQuery('jazz AND blues');
    expect(ast).toMatchObject({ type: 'AND' });
  });

  it('parses OR expression', () => {
    const ast = parseQuery('jazz OR rock');
    expect(ast).toMatchObject({ type: 'OR' });
  });

  it('parses parenthesized expression', () => {
    const ast = parseQuery('(jazz OR rock) AND live');
    expect(ast).toMatchObject({ type: 'AND' });
    expect(ast.left).toMatchObject({ type: 'OR' });
  });

  it('treats adjacent terms as implicit AND', () => {
    const ast = parseQuery('jazz blues');
    expect(ast).toMatchObject({ type: 'AND' });
  });

  it('is case-insensitive for AND/OR keywords', () => {
    const ast = parseQuery('jazz and blues');
    expect(ast).toMatchObject({ type: 'AND' });
    const ast2 = parseQuery('jazz or blues');
    expect(ast2).toMatchObject({ type: 'OR' });
  });
});

describe('evaluateSong -- plain text (substring)', () => {
  it('matches title substring (case-insensitive)', () => {
    expect(evaluateSong(parseQuery('blue'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('BLUE'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('moon'), makeSong())).toBe(true);
  });

  it('matches artist substring', () => {
    expect(evaluateSong(parseQuery('miles'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('Davis'), makeSong())).toBe(true);
  });

  it('matches album substring', () => {
    expect(evaluateSong(parseQuery('kind'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('blue'), makeSong())).toBe(true);
  });

  it('matches ancestor folder name substring', () => {
    expect(evaluateSong(parseQuery('jazz'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('modal'), makeSong())).toBe(true);
  });

  it('does not match on unrelated terms', () => {
    expect(evaluateSong(parseQuery('classical'), makeSong())).toBe(false);
  });
});

describe('evaluateSong -- field conditions (substring)', () => {
  it('title= matches substring', () => {
    expect(evaluateSong(parseQuery('title=blue'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('title=moon'), makeSong())).toBe(true);
  });

  it('title= does NOT match folder names', () => {
    expect(evaluateSong(parseQuery('title=Jazz'), makeSong())).toBe(false);
  });

  it('artist= matches substring', () => {
    expect(evaluateSong(parseQuery('artist=miles'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('artist=Davis'), makeSong())).toBe(true);
  });

  it('album= matches substring', () => {
    expect(evaluateSong(parseQuery('album=kind'), makeSong())).toBe(true);
  });

  it('any= matches title/album/artist substring', () => {
    expect(evaluateSong(parseQuery('any=miles'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('any=blue'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('any=kind'), makeSong())).toBe(true);
  });

  it('any= does NOT match folder names', () => {
    expect(evaluateSong(parseQuery('any=Jazz'), makeSong())).toBe(false);
  });

  it('track= matches integer exactly', () => {
    expect(evaluateSong(parseQuery('track=3'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('track=2'), makeSong())).toBe(false);
    expect(evaluateSong(parseQuery('track=33'), makeSong())).toBe(false);
  });

  it('track= returns false for non-numeric value', () => {
    expect(evaluateSong(parseQuery('track=abc'), makeSong())).toBe(false);
  });

  it('tag= always returns false', () => {
    expect(evaluateSong(parseQuery('tag=jazz'), makeSong())).toBe(false);
  });
});

describe('evaluateSong -- boolean operators', () => {
  it('AND requires both conditions', () => {
    expect(evaluateSong(parseQuery('title=blue AND artist=miles'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('title=blue AND artist=coltrane'), makeSong())).toBe(false);
  });

  it('OR matches either condition', () => {
    expect(evaluateSong(parseQuery('title=blue OR title=red'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('title=red OR title=green'), makeSong())).toBe(false);
  });

  it('parentheses control precedence', () => {
    // (true OR false) AND true = true
    expect(evaluateSong(parseQuery('(title=blue OR title=red) AND artist=miles'), makeSong())).toBe(true);
    // (false OR false) AND true = false
    expect(evaluateSong(parseQuery('(title=red OR title=green) AND artist=miles'), makeSong())).toBe(false);
  });

  it('implicit AND: adjacent terms both required', () => {
    expect(evaluateSong(parseQuery('blue miles'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('blue coltrane'), makeSong())).toBe(false);
  });
});

describe('evaluateSong -- edge cases', () => {
  it('returns false for null AST', () => {
    expect(evaluateSong(null, makeSong())).toBe(false);
  });

  it('handles missing song fields gracefully', () => {
    const sparse = { title: '', artist: null, album: undefined, track_number: null, ancestorFolderNames: [] };
    expect(evaluateSong(parseQuery('title=blue'), sparse)).toBe(false);
    expect(evaluateSong(parseQuery('artist=miles'), sparse)).toBe(false);
  });

  it('handles quoted multi-word field value', () => {
    expect(evaluateSong(parseQuery('album="Kind of Blue"'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('album="Kind of Green"'), makeSong())).toBe(false);
  });
});

describe('evaluateSong -- rating', () => {
  const rated = (rating) => makeSong({ rating });

  it('parses and matches an exact rating', () => {
    expect(parseQuery('rating=4')).toMatchObject({ type: 'COND', field: 'rating', op: '=', value: '4' });
    expect(evaluateSong(parseQuery('rating=4'), rated(4))).toBe(true);
    expect(evaluateSong(parseQuery('rating=4'), rated(3))).toBe(false);
  });

  it('supports threshold operators', () => {
    expect(parseQuery('rating>=4')).toMatchObject({ field: 'rating', op: '>=', value: '4' });
    expect(evaluateSong(parseQuery('rating>=4'), rated(5))).toBe(true);
    expect(evaluateSong(parseQuery('rating>=4'), rated(3))).toBe(false);
    expect(evaluateSong(parseQuery('rating<=2'), rated(1))).toBe(true);
    expect(evaluateSong(parseQuery('rating<=2'), rated(3))).toBe(false);
    expect(evaluateSong(parseQuery('rating>3'), rated(4))).toBe(true);
    expect(evaluateSong(parseQuery('rating>3'), rated(3))).toBe(false);
    expect(evaluateSong(parseQuery('rating<3'), rated(2))).toBe(true);
  });

  it('rating=none finds the unrated, rating=any finds the rated', () => {
    expect(evaluateSong(parseQuery('rating=none'), rated(null))).toBe(true);
    expect(evaluateSong(parseQuery('rating=none'), rated(1))).toBe(false);
    expect(evaluateSong(parseQuery('rating=any'), rated(1))).toBe(true);
    expect(evaluateSong(parseQuery('rating=any'), rated(null))).toBe(false);
    expect(evaluateSong(parseQuery('RATING=NONE'), rated(null))).toBe(true);
  });

  it('never sweeps unrated songs into a threshold comparison', () => {
    // "rating<3" must not mean "everything I haven't rated yet".
    for (const query of ['rating<3', 'rating<=5', 'rating>=1', 'rating>0', 'rating=1']) {
      expect(evaluateSong(parseQuery(query), rated(null))).toBe(false);
      expect(evaluateSong(parseQuery(query), makeSong())).toBe(false);
    }
  });

  it('supports threshold operators on track numbers too', () => {
    expect(evaluateSong(parseQuery('track>=3'), makeSong())).toBe(true);
    expect(evaluateSong(parseQuery('track>3'), makeSong())).toBe(false);
  });

  it('leaves < and > as ordinary text outside numeric fields', () => {
    expect(parseQuery('<3')).toMatchObject({ type: 'PLAIN', value: '<3' });
    // Ordering operators are numeric-only, so artist>=x never becomes a comparison.
    expect(parseQuery('artist>=x').type).not.toBe('COND');
    expect(evaluateSong(parseQuery('<3'), makeSong({ title: 'I <3 Jazz' }))).toBe(true);
  });
});
