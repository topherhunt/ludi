/**
 * Import star ratings from a Swinsian library into Ludi.
 *
 * Ratings are the one part of a music library that can't be recomputed -- they
 * are years of accumulated judgement -- so this reads the foreign database
 * defensively rather than trusting a remembered schema:
 *
 *  - the track table is located by looking for one that actually has `path` and
 *    `rating` columns, instead of hardcoding a name;
 *  - the rating scale is inferred from the data (Swinsian and iTunes have both
 *    used 0-5 and 0-100 over the years), instead of assuming one and silently
 *    turning every 100 into an out-of-range number;
 *  - nothing is written until the caller has seen a preview of the counts.
 *
 * The foreign database is opened read-only. Ludi never writes to it.
 */

const Database = require('better-sqlite3');
const path = require('path');

const MAX_RATING = 5;

/** Locate a table that looks like a track list: it has both a path and a rating. */
function findTrackTable(foreign) {
  const tables = foreign
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map(row => row.name);

  for (const name of tables) {
    const columns = foreign.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name);
    if (columns.includes('path') && columns.includes('rating')) {
      return { name, columns };
    }
  }
  return null;
}

/**
 * Convert a foreign rating to 1-5.
 *
 * `scaleMax` is the largest rating seen in the file: 5 means the column is
 * already in stars, 100 (or anything above 5) means it's the iTunes-style
 * percentage that Swinsian also stores. Deriving it from the data is what keeps
 * a 100 from arriving here as an invalid rating.
 */
function toStars(rawRating, scaleMax) {
  const stars = scaleMax > MAX_RATING
    ? Math.round((rawRating / scaleMax) * MAX_RATING)
    : Math.round(rawRating);
  return Math.min(MAX_RATING, Math.max(1, stars));
}

const normalize = (s) => (s || '').trim().toLowerCase();

/**
 * Read every rated track out of a Swinsian library file.
 * @returns {{ tracks: Array<{stars: number, basename: string, title: string}>, scaleMax: number, tableName: string }}
 */
function readRatedTracks(swinsianDbPath) {
  const foreign = new Database(swinsianDbPath, { readonly: true, fileMustExist: true });
  try {
    const table = findTrackTable(foreign);
    if (!table) {
      throw new Error(
        'No track table found in that file -- it has no table with both a "path" and a "rating" column. Is it a Swinsian library?'
      );
    }

    const hasTitle = table.columns.includes('title');
    const titleSelect = hasTitle ? 'title' : `'' AS title`;
    const rows = foreign
      .prepare(`SELECT path, rating, ${titleSelect} FROM "${table.name}" WHERE rating IS NOT NULL AND rating > 0`)
      .all();

    // The scale comes from the file itself, not from an assumption about which
    // Swinsian version wrote it.
    const scaleMax = rows.reduce((max, row) => Math.max(max, row.rating), 0);

    // `basename`/`title` are normalized for matching; `label` keeps the original
    // spelling so the unmatched report reads the way the library does.
    const tracks = rows.map(row => ({
      stars: toStars(row.rating, scaleMax),
      basename: normalize(path.basename(row.path || '')),
      title: normalize(row.title),
      label: row.title || path.basename(row.path || ''),
    }));

    return { tracks, scaleMax, tableName: table.name };
  } finally {
    foreign.close();
  }
}

/**
 * Match rated foreign tracks against Ludi's songs.
 *
 * Filename first, then title: the files were copied into Ludi's library so
 * their names survived, while titles are more likely to collide across a
 * library ("Intro", "Untitled"). A key matching several Ludi songs rates all of
 * them -- a duplicate of a track you rated 5 stars is still a 5-star track.
 *
 * @param {Array} ludiSongs - rows from db.getSongsForRatingMatch()
 */
function matchTracks(tracks, ludiSongs) {
  const byBasename = new Map();
  const byTitle = new Map();
  const addTo = (map, key, song) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(song);
  };

  for (const song of ludiSongs) {
    addTo(byBasename, normalize(path.basename(song.file_path)), song);
    addTo(byTitle, normalize(song.title), song);
  }

  // songId -> stars. A song reached by two foreign tracks keeps the first
  // (filename) match, which is the more trustworthy of the two.
  const ratings = new Map();
  let matchedByFilename = 0;
  let matchedByTitle = 0;
  const unmatched = [];

  for (const track of tracks) {
    const hits = byBasename.get(track.basename) || byTitle.get(track.title);
    if (!hits || hits.length === 0) {
      unmatched.push(track.label || track.title || track.basename);
      continue;
    }
    if (byBasename.has(track.basename)) matchedByFilename++;
    else matchedByTitle++;

    for (const song of hits) {
      if (!ratings.has(song.id)) ratings.set(song.id, track.stars);
    }
  }

  const overwrites = ludiSongs.filter(
    song => ratings.has(song.id) && song.rating !== null && song.rating !== ratings.get(song.id)
  ).length;

  unmatched.sort((a, b) => a.localeCompare(b));

  return {
    ratings,
    matchedByFilename,
    matchedByTitle,
    songsToRate: ratings.size,
    overwrites,
    unmatched,
  };
}

/**
 * Read a Swinsian library and report what importing it would do, without
 * writing anything.
 */
function previewImport(swinsianDbPath, ludiSongs) {
  const { tracks, scaleMax, tableName } = readRatedTracks(swinsianDbPath);
  const match = matchTracks(tracks, ludiSongs);

  return {
    tableName,
    scaleMax,
    ratedTracks: tracks.length,
    matchedByFilename: match.matchedByFilename,
    matchedByTitle: match.matchedByTitle,
    songsToRate: match.songsToRate,
    overwrites: match.overwrites,
    unmatched: match.unmatched,
  };
}

/**
 * Resolve a Swinsian library into the song-id -> stars writes to apply.
 * @returns {{ writes: Array<{songIds: number[], rating: number}>, songsRated: number }}
 */
function resolveImport(swinsianDbPath, ludiSongs) {
  const { tracks } = readRatedTracks(swinsianDbPath);
  const { ratings } = matchTracks(tracks, ludiSongs);

  // Group by rating so the write side runs five statements, not one per song.
  const byRating = new Map();
  for (const [songId, stars] of ratings) {
    if (!byRating.has(stars)) byRating.set(stars, []);
    byRating.get(stars).push(songId);
  }

  return {
    writes: Array.from(byRating, ([rating, songIds]) => ({ rating, songIds })),
    songsRated: ratings.size,
  };
}

module.exports = { previewImport, resolveImport, matchTracks, toStars, MAX_RATING };
