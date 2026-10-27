import { describe, it, expect } from 'vitest';
import { toStars, matchTracks, parseGrouping, trackDay, matchDetails } from '../../src/main/swinsian-import.js';

const song = (id, file_path, title, rating = null) => ({ id, file_path, title, artist: '', rating });
const track = (basename, title, stars, tags = []) => ({ basename, title, stars, tags });

describe('toStars', () => {
  it('passes a 1-5 column through unchanged', () => {
    expect(toStars(1, 5)).toBe(1);
    expect(toStars(4, 5)).toBe(4);
    expect(toStars(5, 5)).toBe(5);
  });

  it('converts an iTunes-style 0-100 column to stars', () => {
    expect(toStars(20, 100)).toBe(1);
    expect(toStars(60, 100)).toBe(3);
    expect(toStars(100, 100)).toBe(5);
  });

  it('clamps into 1-5 rather than emitting an invalid rating', () => {
    expect(toStars(0, 100)).toBe(1);
    expect(toStars(9, 5)).toBe(5);
  });
});

describe('parseGrouping', () => {
  it('splits on any run of whitespace and drops empties', () => {
    expect(parseGrouping('med-e instrumental')).toEqual(['med-e', 'instrumental']);
    expect(parseGrouping('  low-e   lyric ')).toEqual(['low-e', 'lyric']);
    expect(parseGrouping('')).toEqual([]);
    expect(parseGrouping(null)).toEqual([]);
  });
});

describe('matchTracks', () => {
  const songs = [
    song(1, 'Jazz/blue-moon.mp3', 'Blue Moon'),
    song(2, 'Rock/so-what.mp3', 'So What'),
    song(3, 'Misc/untitled-take.mp3', 'Intro'),
  ];

  it('matches on filename, ignoring the differing directory', () => {
    const { ratings, matchedByFilename, matchedByTitle, songsToRate } =
      matchTracks([track('blue-moon.mp3', 'Something Else', 5)], songs);
    expect(ratings.get(1)).toBe(5);
    expect(matchedByFilename).toBe(1);
    expect(matchedByTitle).toBe(0);
    expect(songsToRate).toBe(1);
  });

  it('falls back to title when the filename does not match', () => {
    const { ratings, matchedByFilename, matchedByTitle } =
      matchTracks([track('renamed-file.mp3', 'so what', 4)], songs);
    expect(ratings.get(2)).toBe(4);
    expect(matchedByFilename).toBe(0);
    expect(matchedByTitle).toBe(1);
  });

  it('prefers the filename match when filename and title point at different songs', () => {
    const { ratings } = matchTracks([track('blue-moon.mp3', 'so what', 5)], songs);
    expect(ratings.get(1)).toBe(5);
    expect(ratings.has(2)).toBe(false);
  });

  it('rates every duplicate of a matched filename', () => {
    const withDupe = [...songs, song(4, 'Copies/blue-moon.mp3', 'Blue Moon')];
    const { ratings, songsToRate } = matchTracks([track('blue-moon.mp3', '', 3)], withDupe);
    expect(ratings.get(1)).toBe(3);
    expect(ratings.get(4)).toBe(3);
    expect(songsToRate).toBe(2);
  });

  it('tags a matched song even when the track is unrated, without rating it', () => {
    const { ratings, tags, songsToRate, songsToTag, tagCounts } =
      matchTracks([track('so-what.mp3', '', null, ['low-e', 'instrumental'])], songs);
    expect(ratings.has(2)).toBe(false);
    expect(songsToRate).toBe(0);
    expect(tags.get(2)).toEqual(['low-e', 'instrumental']);
    expect(songsToTag).toBe(1);
    expect(tagCounts).toEqual([{ name: 'instrumental', songs: 1 }, { name: 'low-e', songs: 1 }]);
  });

  it('counts each tag across every song it will land on', () => {
    const { tagCounts } = matchTracks(
      [track('blue-moon.mp3', '', 5, ['high-e', 'lyric']), track('so-what.mp3', '', 3, ['high-e'])],
      songs
    );
    expect(tagCounts).toEqual([{ name: 'high-e', songs: 2 }, { name: 'lyric', songs: 1 }]);
  });

  it('reports unmatched tracks instead of dropping them silently', () => {
    const { unmatched, songsToRate } = matchTracks([track('nowhere.mp3', 'Nowhere Man', 5)], songs);
    expect(unmatched).toEqual(['Nowhere Man']);
    expect(songsToRate).toBe(0);
  });

  it('reports unmatched tracks under their original spelling, not the match key', () => {
    // Matching lowercases; the report should not.
    const raw = { basename: 'nowhere.mp3', title: 'nowhere man', label: 'Nowhere Man', stars: 5 };
    expect(matchTracks([raw], songs).unmatched).toEqual(['Nowhere Man']);
  });

  it('counts overwrites only where an existing rating would actually change', () => {
    const alreadyRated = [
      song(1, 'Jazz/blue-moon.mp3', 'Blue Moon', 2),
      song(2, 'Rock/so-what.mp3', 'So What', 4),
      song(3, 'Misc/untitled-take.mp3', 'Intro', null),
    ];
    const { overwrites, songsToRate } = matchTracks(
      [track('blue-moon.mp3', '', 5), track('so-what.mp3', '', 4), track('untitled-take.mp3', '', 1)],
      alreadyRated
    );
    expect(songsToRate).toBe(3);
    expect(overwrites).toBe(1); // only song 1 (2 stars -> 5)
  });
});

// Swinsian's timestamps for noon local time on a day, in seconds since 2001-01-01 UTC.
const coreData = (day) => new Date(`${day}T12:00:00`).getTime() / 1000 - 978307200;

describe('trackDay', () => {
  it('takes the earlier of the date added and the file creation date', () => {
    expect(trackDay({ dateadded: coreData('2019-12-10'), datecreated: coreData('2011-04-02') })).toBe('2011-04-02');
    expect(trackDay({ dateadded: coreData('2015-01-01'), datecreated: coreData('2020-06-30') })).toBe('2015-01-01');
  });

  it('ignores a zeroed timestamp at the Unix epoch, and missing ones', () => {
    expect(trackDay({ dateadded: coreData('2019-12-10'), datecreated: -978307200 })).toBe('2019-12-10');
    expect(trackDay({ dateadded: null, datecreated: null })).toBeNull();
  });
});

describe('matchDetails', () => {
  const detailSong = (id, file_path, genre, date_added) => ({ id, file_path, title: '', genre, date_added });
  const detail = (basename, day, genre) => ({ basename, title: '', label: basename, day, genre });

  it('dates every matched song whose date differs, and fills only missing genres', () => {
    const songs = [
      detailSong(1, 'a.mp3', null, '2026-06-01'),
      detailSong(2, 'b.mp3', 'Jazz', '2026-06-01'),
      detailSong(3, 'c.mp3', null, '2012-03-03'),
    ];
    const result = matchDetails(
      [detail('a.mp3', '2011-01-01', 'Rock'), detail('b.mp3', '2012-02-02', 'Pop'), detail('c.mp3', '2012-03-03', 'Rock'),
        detail('gone.mp3', '2013-01-01', 'Folk')],
      songs
    );
    expect([...result.dates]).toEqual([[1, '2011-01-01'], [2, '2012-02-02']]);
    expect([...result.genres]).toEqual([[1, 'Rock'], [3, 'Rock']]);
    expect(result.matched).toBe(3);
    expect(result.unmatched).toEqual(['gone.mp3']);
    expect(result.yearCounts).toEqual([{ value: '2011', songs: 1 }, { value: '2012', songs: 1 }]);
    expect(result.genreCounts).toEqual([{ value: 'Rock', songs: 2 }]);
  });
});
