import { describe, it, expect } from 'vitest';
import { parseQuery, evaluateSong } from '../../src/renderer/utils/searchParser.js';
import { TAG_COLORS, randomAvailableColor } from '../../src/renderer/utils/tagColors.js';

const makeSong = (tags = [], overrides = {}) => ({
  title: 'Blue Moon',
  artist: 'Miles Davis',
  album: 'Kind of Blue',
  track_number: 3,
  ancestorFolderNames: ['Jazz'],
  tags,
  ...overrides,
});

const matches = (query, song) => evaluateSong(parseQuery(query), song);

describe('tag search evaluation', () => {
  it('matches a song that has the exact tag (case-insensitive)', () => {
    expect(matches('tag=fav', makeSong(['fav']))).toBe(true);
    expect(matches('tag=FAV', makeSong(['fav']))).toBe(true);
    expect(matches('tag=fav', makeSong(['favorite']))).toBe(false); // exact, not substring
  });

  it('does not match when the song lacks the tag', () => {
    expect(matches('tag=fav', makeSong([]))).toBe(false);
    expect(matches('tag=fav', makeSong(['live', 'demo']))).toBe(false);
  });

  it('supports quoted multi-word tag names', () => {
    expect(matches('tag="low energy"', makeSong(['low energy']))).toBe(true);
    expect(matches('tag="low energy"', makeSong(['low']))).toBe(false);
  });

  it('combines tags with AND / OR / parentheses', () => {
    const song = makeSong(['fav', 'instrumental']);
    expect(matches('tag=fav AND tag=instrumental', song)).toBe(true);
    expect(matches('tag=fav AND tag=live', song)).toBe(false);
    expect(matches('tag=fav AND (tag=instrumental OR tag=low-e)', song)).toBe(true);
    expect(matches('tag=missing OR tag=instrumental', song)).toBe(true);
  });

  it('bare text does not match tags (tags are explicit)', () => {
    expect(matches('fav', makeSong(['fav']))).toBe(false);
  });
});

describe('NOT / tag absence', () => {
  it('negates with the NOT keyword', () => {
    expect(matches('NOT tag=fav', makeSong([]))).toBe(true);
    expect(matches('NOT tag=fav', makeSong(['fav']))).toBe(false);
  });

  it('negates with the - shorthand', () => {
    expect(matches('-tag=fav', makeSong([]))).toBe(true);
    expect(matches('-tag=fav', makeSong(['fav']))).toBe(false);
  });

  it('combines presence and absence', () => {
    const song = makeSong(['fav']);
    expect(matches('tag=fav AND NOT tag=live', song)).toBe(true);
    expect(matches('tag=fav AND NOT tag=fav', song)).toBe(false);
  });

  it('does not treat internal hyphens as negation', () => {
    expect(matches('tag=low-e', makeSong(['low-e']))).toBe(true);
  });
});

describe('tag color assignment', () => {
  it('picks a color not already in use', () => {
    const used = TAG_COLORS.slice(0, TAG_COLORS.length - 1);
    const color = randomAvailableColor(used);
    expect(color).toBe(TAG_COLORS[TAG_COLORS.length - 1]);
    expect(used).not.toContain(color);
  });

  it('falls back to a palette color when all are used', () => {
    const color = randomAvailableColor(TAG_COLORS);
    expect(TAG_COLORS).toContain(color);
  });
});
