// What a collapsed group shows in each column: a preview of the songs inside.

/** A metadata value worth showing ('Unknown' is the scanner's placeholder). */
export const knownText = (value) => (value && value !== 'Unknown' ? value : '');

/** "1-6" from the lowest to the highest track number, "3" when they agree. */
function trackRange(songs) {
  const numbers = songs.map((s) => s.track_number).filter(Boolean);
  if (numbers.length === 0) return '';
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? String(min) : `${min}-${max}`;
}

/** The most common value, plus how many other distinct values there are: "Abbey Road + 2". */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  if (counts.size === 0) return '';
  // Ties go to the value that comes first in the group.
  let top = null;
  for (const [value, count] of counts) if (top === null || count > counts.get(top)) top = value;
  return counts.size === 1 ? top : `${top} + ${counts.size - 1}`;
}

/** The average of the rated songs to the nearest 0.1 star, or null when none is rated. */
function averageRating(songs) {
  const ratings = songs.map((s) => s.rating).filter(Boolean);
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10;
}

/** Every tag a song in the group carries, with the share of songs carrying it, most common first. */
function tagShares(songs) {
  const byId = new Map();
  for (const song of songs) {
    for (const tag of song.tags) {
      if (tag.source === 'auto') continue; // rows show only the tags you applied
      const entry = byId.get(tag.id) || { tag, count: 0 };
      entry.count += 1;
      byId.set(tag.id, entry);
    }
  }
  return [...byId.values()]
    .map(({ tag, count }) => ({ tag, share: count / songs.length }))
    .sort((a, b) => b.share - a.share || a.tag.name.localeCompare(b.tag.name));
}

const extreme = (values, pick) => {
  const present = values.filter(Boolean).sort();
  if (present.length === 0) return null;
  return pick === 'first' ? present[0] : present[present.length - 1];
};

/**
 * One value per column for a group of songs. Dates are YYYY-MM-DD (date added)
 * and ISO timestamps (last played), so they compare as strings.
 */
export function summarizeSongs(songs) {
  return {
    track: trackRange(songs),
    duration: songs.reduce((sum, s) => sum + (s.duration_seconds || 0), 0),
    rating: averageRating(songs),
    artist: mostCommon(songs.map((s) => knownText(s.artist))),
    album: mostCommon(songs.map((s) => knownText(s.album))),
    genre: mostCommon(songs.map((s) => s.genre)),
    date_added: extreme(songs.map((s) => s.date_added), 'first'),
    plays: songs.reduce((sum, s) => sum + (s.play_count || 0), 0),
    last_played: extreme(songs.map((s) => s.last_played_at), 'last'),
    tags: tagShares(songs),
  };
}
