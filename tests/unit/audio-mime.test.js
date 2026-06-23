import { describe, it, expect } from 'vitest';
import audioMime from '../../src/main/audio-mime.js';

const { audioContentType } = audioMime;

describe('audioContentType', () => {
  it('maps .mp3 to audio/mpeg', () => {
    expect(audioContentType('/music/Artist/Album/01 Song.mp3')).toBe('audio/mpeg');
  });

  it('maps .m4a to audio/mp4 (the bug: was served as audio/mpeg and would not decode)', () => {
    expect(audioContentType('/music/Artist/Album/Song feat. X.m4a')).toBe('audio/mp4');
  });

  it('maps .ogg to audio/ogg', () => {
    expect(audioContentType('/music/Artist/Album/Song.ogg')).toBe('audio/ogg');
  });

  it('is case-insensitive on the extension', () => {
    expect(audioContentType('/music/A/B/SONG.M4A')).toBe('audio/mp4');
  });

  it('defaults to audio/mpeg for unknown extensions', () => {
    expect(audioContentType('/music/A/B/weird.bin')).toBe('audio/mpeg');
  });
});
