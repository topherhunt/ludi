import { describe, it, expect } from 'vitest';
import { toStars, matchTracks } from '../../src/main/swinsian-import.js';

const song = (id, file_path, title, rating = null) => ({ id, file_path, title, artist: '', rating });
const track = (basename, title, stars) => ({ basename, title, stars });

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
