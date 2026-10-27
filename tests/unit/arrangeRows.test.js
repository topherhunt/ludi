import { describe, it, expect } from 'vitest';
import { arrangeRows, songsInTreeOrder, findGroup } from '../../src/renderer/utils/arrangeRows.js';

let nextId = 1;
const song = (fields) => ({ item_id: nextId++, title: 'Song', artist: 'Unknown', album: 'Unknown', track_number: null, genre: null, date_added: '2020-01-01', rating: null, play_count: 0, last_played_at: null, ...fields });

const titles = (nodes) => nodes.map((n) => (n.type === 'group' ? `[${n.title}]` : n.data.title));
const natural = [{ field: 'natural', dir: 'asc' }];

describe('arrangeRows', () => {
  it('keeps the natural order with no grouping', () => {
    const rows = [song({ title: 'C' }), song({ title: 'A' }), song({ title: 'B' })];
    expect(titles(arrangeRows(rows, { groupBy: 'none', sort: natural }))).toEqual(['C', 'A', 'B']);
  });

  it('groups by album and inlines a song that would be alone in its group', () => {
    const rows = [
      song({ title: 'one', album: 'Solo' }),
      song({ title: 'a1', album: 'Pair', track_number: 2 }),
      song({ title: 'a2', album: 'Pair', track_number: 1 }),
      song({ title: 'loose' }),
    ];
    const nodes = arrangeRows(rows, { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] });
    expect(titles(nodes)).toEqual(['[Pair]', 'one', 'loose']);
    expect(titles(nodes[0].children)).toEqual(['a2', 'a1']);
    expect(nodes[0].songCount).toBe(2);
  });

  it('nests two levels and skips a level a song has no value for', () => {
    const rows = [
      song({ title: 'x', date_added: '2011-03-01', album: 'A' }),
      song({ title: 'y', date_added: '2011-05-01', album: 'A' }),
      song({ title: 'z', date_added: '2011-06-01', album: 'B' }),
      song({ title: 'w', date_added: '2012-01-01', album: 'A' }),
      song({ title: 'g1', genre: null, album: 'G' }),
      song({ title: 'g2', genre: null, album: 'G' }),
    ];
    const byYear = arrangeRows(rows.slice(0, 4), { groupBy: 'year_album', sort: [{ field: 'date_added', dir: 'asc' }] });
    expect(titles(byYear)).toEqual(['[2011]', 'w']);
    expect(titles(byYear[0].children)).toEqual(['[A]', 'z']);

    const byGenre = arrangeRows(rows.slice(4), { groupBy: 'genre_album', sort: natural });
    expect(titles(byGenre)).toEqual(['[G]']);
  });

  it('groups case-insensitively under the first spelling seen', () => {
    const rows = [song({ genre: 'Christmas' }), song({ genre: 'christmas' })];
    const nodes = arrangeRows(rows, { groupBy: 'genre_album', sort: natural });
    expect(titles(nodes)).toEqual(['[Christmas]']);
  });

  it('sorts a group by its earliest value ascending and its latest descending', () => {
    const rows = [
      song({ title: 'a1', album: 'A', date_added: '2015-01-01' }),
      song({ title: 'a2', album: 'A', date_added: '2010-01-01' }),
      song({ title: 'b1', album: 'B', date_added: '2012-01-01' }),
      song({ title: 'b2', album: 'B', date_added: '2013-01-01' }),
    ];
    const asc = arrangeRows(rows, { groupBy: 'album', sort: [{ field: 'date_added', dir: 'asc' }] });
    expect(titles(asc)).toEqual(['[A]', '[B]']);
    const desc = arrangeRows(rows, { groupBy: 'album', sort: [{ field: 'date_added', dir: 'desc' }] });
    expect(titles(desc)).toEqual(['[A]', '[B]']);
    expect(titles(desc[1].children)).toEqual(['b2', 'b1']);
  });

  it('breaks ties with later sort fields, then track #, then title', () => {
    const rows = [
      song({ title: 'b', artist: 'X', rating: 5 }),
      song({ title: 'a', artist: 'X', rating: 5 }),
      song({ title: 'c', artist: 'X', rating: 3, track_number: 1 }),
      song({ title: 'd', artist: 'X', rating: 3 }),
    ];
    const nodes = arrangeRows(rows, { groupBy: 'none', sort: [{ field: 'artist', dir: 'asc' }, { field: 'rating', dir: 'desc' }] });
    expect(titles(nodes)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts missing values last in either direction', () => {
    const rows = [song({ title: 'never', last_played_at: null }), song({ title: 'once', last_played_at: '2026-01-01T00:00:00Z' })];
    for (const dir of ['asc', 'desc']) {
      expect(titles(arrangeRows(rows, { groupBy: 'none', sort: [{ field: 'last_played', dir }] }))).toEqual(['once', 'never']);
    }
  });

  it('compares text case-insensitively and numbers within text numerically', () => {
    const rows = [song({ title: 'track 10' }), song({ title: 'Track 9' }), song({ title: 'apple' })];
    expect(titles(arrangeRows(rows, { groupBy: 'none', sort: [{ field: 'title', dir: 'asc' }] }))).toEqual(['apple', 'Track 9', 'track 10']);
  });

  it('lists songs in render order and finds groups by key', () => {
    const rows = [song({ title: 's1', album: 'A' }), song({ title: 's2', album: 'A' }), song({ title: 's3' })];
    const nodes = arrangeRows(rows, { groupBy: 'album', sort: natural });
    expect(songsInTreeOrder(nodes).map((r) => r.title)).toEqual(['s1', 's2', 's3']);
    expect(findGroup(nodes, nodes[0].key).title).toBe('A');
    expect(findGroup(nodes, 'nope')).toBeNull();
  });

  it('rejects unknown modes and fields', () => {
    expect(() => arrangeRows([], { groupBy: 'decade', sort: natural })).toThrow(/group mode/);
    expect(() => arrangeRows([], { groupBy: 'none', sort: [{ field: 'bpm', dir: 'asc' }] })).toThrow(/sort field/);
  });
});
