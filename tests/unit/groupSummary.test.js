import { describe, it, expect } from 'vitest';
import { summarizeSongs } from '../../src/renderer/utils/groupSummary.js';

const tag = (id, name) => ({ id, name, color: '#fff', source: 'manual' });
const song = (fields) => ({ track_number: null, duration_seconds: null, rating: null, artist: '', album: '',
  genre: null, date_added: null, play_count: 0, last_played_at: null, tags: [], ...fields });

describe('summarizeSongs', () => {
  it('spans the track numbers and adds up the times and plays', () => {
    const summary = summarizeSongs([
      song({ track_number: 6, duration_seconds: 200, play_count: 2 }),
      song({ track_number: 1, duration_seconds: 100.5, play_count: 3 }),
      song({ track_number: null }),
    ]);
    expect(summary.track).toBe('1-6');
    expect(summary.duration).toBe(300.5);
    expect(summary.plays).toBe(5);
    expect(summarizeSongs([song({ track_number: 3 })]).track).toBe('3');
  });

  it('averages only the rated songs, to the nearest tenth of a star', () => {
    expect(summarizeSongs([song({ rating: 4 }), song({ rating: 3 }), song({ rating: 3 }), song({})]).rating).toBe(3.3);
    expect(summarizeSongs([song({})]).rating).toBeNull();
  });

  it('names the most common artist and album, counting the others', () => {
    const summary = summarizeSongs([
      song({ artist: 'B', album: 'X' }), song({ artist: 'A', album: 'X' }),
      song({ artist: 'A', album: 'X' }), song({ artist: 'Unknown', album: 'X' }), song({ artist: 'C', album: 'X' }),
    ]);
    expect(summary.artist).toBe('A + 2');
    expect(summary.album).toBe('X');
  });

  it('shows the earliest date added and the latest play', () => {
    const summary = summarizeSongs([
      song({ date_added: '2015-03-01', last_played_at: '2024-01-01T10:00:00Z' }),
      song({ date_added: '2011-04-02', last_played_at: '2025-06-01T10:00:00Z' }),
      song({}),
    ]);
    expect(summary.date_added).toBe('2011-04-02');
    expect(summary.last_played).toBe('2025-06-01T10:00:00Z');
  });

  it('lists every hand-applied tag with the share of songs carrying it, most common first', () => {
    const chill = tag(1, 'chill');
    const loud = tag(2, 'loud');
    const summary = summarizeSongs([
      song({ tags: [loud] }),
      song({ tags: [chill, loud] }),
      song({ tags: [{ ...tag(3, 'robot'), source: 'auto' }] }),
      song({ tags: [] }),
    ]);
    expect(summary.tags).toEqual([{ tag: loud, share: 0.5 }, { tag: chill, share: 0.25 }]);
  });
});
