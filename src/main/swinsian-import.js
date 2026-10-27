/**
 * Import star ratings, and the space-separated tags in the `grouping` field,
 * from a Swinsian library into Ludi. A second, separate import brings in each
 * track's date added and genre.
 *
 * Ratings and tags can't be recomputed -- they are years of accumulated
 * judgement -- so this reads the foreign database
 * defensively rather than trusting a remembered schema:
 *
 *  - the track table is located by looking for one that actually has `path` and
 *    `rating` columns, instead of hardcoding a name;
 *  - the rating scale is inferred from the data (Swinsian and iTunes have both
 *    used 0-5 and 0-100 over the years), instead of assuming one and silently
 *    turning every 100 into an out-of-range number;
 *  - nothing is written until the caller has seen a preview of the counts;
 *  - tags are only ever added, never removed, so re-running the import is safe.
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

/** Split a `grouping` value like "med-e instrumental" into its tag names. */
function parseGrouping(grouping) {
  return (grouping || '').split(/\s+/).filter(Boolean);
}

/**
 * Read every track that has a rating or grouping tags out of a Swinsian library file.
 * @returns {{ tracks: Array<{stars: number|null, tags: string[], basename: string, title: string, label: string}>, scaleMax: number, tableName: string }}
 */
function readTracks(swinsianDbPath) {
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
    const hasGrouping = table.columns.includes('grouping');
    const groupingSelect = hasGrouping ? 'grouping' : `'' AS grouping`;
    const groupingWhere = hasGrouping ? `OR (grouping IS NOT NULL AND TRIM(grouping) != '')` : '';
    const rows = foreign
      .prepare(`SELECT path, rating, ${titleSelect}, ${groupingSelect} FROM "${table.name}"
                WHERE (rating IS NOT NULL AND rating > 0) ${groupingWhere}`)
      .all();

    // The scale comes from the file itself, not from an assumption about which
    // Swinsian version wrote it.
    const scaleMax = rows.reduce((max, row) => Math.max(max, row.rating || 0), 0);

    // `basename`/`title` are normalized for matching; `label` keeps the original
    // spelling so the unmatched report reads the way the library does.
    const tracks = rows.map(row => ({
      stars: row.rating > 0 ? toStars(row.rating, scaleMax) : null,
      tags: parseGrouping(row.grouping),
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
 * Index Ludi's songs for matching foreign tracks, and return a lookup from a
 * track to the songs it matches: `{ songs, byFilename }`, or null.
 *
 * Filename first, then title: the files were copied into Ludi's library so
 * their names survived, while titles are more likely to collide across a
 * library ("Intro", "Untitled"). A key matching several Ludi songs applies to
 * all of them -- a duplicate of a track you rated 5 stars is still a 5-star track.
 *
 * @param {Array} ludiSongs - rows from db.getSongsForSwinsianMatch()
 */
function songMatcher(ludiSongs) {
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

  return (track) => {
    if (byBasename.has(track.basename)) return { songs: byBasename.get(track.basename), byFilename: true };
    if (byTitle.has(track.title)) return { songs: byTitle.get(track.title), byFilename: false };
    return null;
  };
}

/** Match foreign rated/tagged tracks against Ludi's songs (see songMatcher). */
function matchTracks(tracks, ludiSongs) {
  const match = songMatcher(ludiSongs);

  // songId -> stars, and songId -> tag names. A song reached by two foreign
  // tracks keeps the first (filename) match, which is the more trustworthy of the two.
  const ratings = new Map();
  const tags = new Map();
  let matchedByFilename = 0;
  let matchedByTitle = 0;
  const unmatched = [];

  for (const track of tracks) {
    const found = match(track);
    if (!found) {
      unmatched.push(track.label || track.title || track.basename);
      continue;
    }
    if (found.byFilename) matchedByFilename++;
    else matchedByTitle++;
    const hits = found.songs;

    for (const song of hits) {
      if (track.stars !== null && !ratings.has(song.id)) ratings.set(song.id, track.stars);
      if (track.tags.length > 0 && !tags.has(song.id)) tags.set(song.id, track.tags);
    }
  }

  // tag name -> how many songs it will be applied to.
  const tagCounts = new Map();
  for (const names of tags.values()) {
    for (const name of names) tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
  }

  const overwrites = ludiSongs.filter(
    song => ratings.has(song.id) && song.rating !== null && song.rating !== ratings.get(song.id)
  ).length;

  unmatched.sort((a, b) => a.localeCompare(b));

  return {
    ratings,
    tags,
    matchedByFilename,
    matchedByTitle,
    songsToRate: ratings.size,
    songsToTag: tags.size,
    tagCounts: Array.from(tagCounts, ([name, songs]) => ({ name, songs }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    overwrites,
    unmatched,
  };
}

/**
 * Read a Swinsian library and report what importing it would do, without
 * writing anything.
 */
function previewImport(swinsianDbPath, ludiSongs) {
  const { tracks, scaleMax, tableName } = readTracks(swinsianDbPath);
  const match = matchTracks(tracks, ludiSongs);

  return {
    tableName,
    scaleMax,
    foundTracks: tracks.length,
    matchedByFilename: match.matchedByFilename,
    matchedByTitle: match.matchedByTitle,
    songsToRate: match.songsToRate,
    songsToTag: match.songsToTag,
    tagCounts: match.tagCounts,
    overwrites: match.overwrites,
    unmatched: match.unmatched,
  };
}

/**
 * Resolve a Swinsian library into the rating and tag writes to apply.
 * @returns {{ writes: Array<{songIds: number[], rating: number}>, tagWrites: Array<{name: string, songIds: number[]}>, songsRated: number, songsTagged: number }}
 */
function resolveImport(swinsianDbPath, ludiSongs) {
  const { tracks } = readTracks(swinsianDbPath);
  const { ratings, tags } = matchTracks(tracks, ludiSongs);

  // Group by rating so the write side runs five statements, not one per song.
  const byRating = new Map();
  for (const [songId, stars] of ratings) {
    if (!byRating.has(stars)) byRating.set(stars, []);
    byRating.get(stars).push(songId);
  }

  const byTag = new Map();
  for (const [songId, names] of tags) {
    for (const name of names) {
      if (!byTag.has(name)) byTag.set(name, []);
      byTag.get(name).push(songId);
    }
  }

  return {
    writes: Array.from(byRating, ([rating, songIds]) => ({ rating, songIds })),
    tagWrites: Array.from(byTag, ([name, songIds]) => ({ name, songIds })),
    songsRated: ratings.size,
    songsTagged: tags.size,
  };
}

// ---- Date added and genre ----------------------------------------------------

// Swinsian stores dates as Core Data timestamps: seconds since 2001-01-01 UTC.
const CORE_DATA_EPOCH_SECONDS = 978307200;
// Anything earlier is a zeroed or corrupt timestamp (Swinsian has some at the
// Unix epoch), not a real date.
const EARLIEST_PLAUSIBLE = '1990-01-01';

/** A Core Data timestamp as a local YYYY-MM-DD, or null if missing or implausible. */
function coreDataDay(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const d = new Date((seconds + CORE_DATA_EPOCH_SECONDS) * 1000);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return day < EARLIEST_PLAUSIBLE ? null : day;
}

/**
 * When a track joined the library: the earlier of Swinsian's `dateadded` and
 * the file's `datecreated`. A library migrated into Swinsian has one
 * `dateadded` for everything it brought along, while the file's own creation
 * date still says when it was first acquired.
 */
function trackDay(row) {
  const days = [coreDataDay(row.dateadded), coreDataDay(row.datecreated)].filter(Boolean);
  return days.length > 0 ? days.sort()[0] : null;
}

/** Read every track's date added and genre out of a Swinsian library file. */
function readTrackDetails(swinsianDbPath) {
  const foreign = new Database(swinsianDbPath, { readonly: true, fileMustExist: true });
  try {
    const table = findTrackTable(foreign);
    if (!table) {
      throw new Error(
        'No track table found in that file -- it has no table with both a "path" and a "rating" column. Is it a Swinsian library?'
      );
    }
    const missing = ['title', 'genre', 'dateadded', 'datecreated'].filter(c => !table.columns.includes(c));
    if (missing.length > 0) {
      throw new Error(`The track table has no ${missing.join(', ')} column, so this import can't read it.`);
    }
    const rows = foreign
      .prepare(`SELECT path, title, genre, dateadded, datecreated FROM "${table.name}"`)
      .all();
    return rows.map(row => ({
      day: trackDay(row),
      genre: (row.genre || '').trim() || null,
      basename: normalize(path.basename(row.path || '')),
      title: normalize(row.title),
      label: row.title || path.basename(row.path || ''),
    }));
  } finally {
    foreign.close();
  }
}

/**
 * Match tracks to Ludi songs and work out what changes. Every matched song
 * takes the track's date. Genre only fills songs that have none here, so
 * genres set in Ludi are never overwritten.
 */
function matchDetails(tracks, ludiSongs) {
  const match = songMatcher(ludiSongs);
  const dates = new Map();  // songId -> YYYY-MM-DD
  const genres = new Map(); // songId -> genre
  let matched = 0;
  const unmatched = [];

  for (const track of tracks) {
    const found = match(track);
    if (!found) {
      unmatched.push(track.label || track.title || track.basename);
      continue;
    }
    matched++;
    for (const song of found.songs) {
      if (track.day && !dates.has(song.id) && song.date_added !== track.day) dates.set(song.id, track.day);
      if (track.genre && !song.genre && !genres.has(song.id)) genres.set(song.id, track.genre);
    }
  }

  const countBy = (values) => {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    return Array.from(counts, ([value, songs]) => ({ value, songs }));
  };

  unmatched.sort((a, b) => a.localeCompare(b));
  return {
    dates,
    genres,
    matched,
    unmatched,
    yearCounts: countBy([...dates.values()].map(day => day.slice(0, 4)))
      .sort((a, b) => a.value.localeCompare(b.value)),
    genreCounts: countBy(genres.values()).sort((a, b) => b.songs - a.songs || a.value.localeCompare(b.value)),
  };
}

/** Report what importing date added and genre would change, without writing anything. */
function previewDetailsImport(swinsianDbPath, ludiSongs) {
  const tracks = readTrackDetails(swinsianDbPath);
  const { dates, genres, ...rest } = matchDetails(tracks, ludiSongs);
  return { foundTracks: tracks.length, songsToDate: dates.size, songsToGenre: genres.size, ...rest };
}

/** The date and genre writes to apply: `{ dates: [[songId, day]], genres: [[songId, genre]] }`. */
function resolveDetailsImport(swinsianDbPath, ludiSongs) {
  const { dates, genres } = matchDetails(readTrackDetails(swinsianDbPath), ludiSongs);
  return { dates: [...dates], genres: [...genres] };
}

module.exports = {
  previewImport, resolveImport, matchTracks, toStars, parseGrouping, MAX_RATING,
  previewDetailsImport, resolveDetailsImport, matchDetails, trackDay,
};
