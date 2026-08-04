/**
 * The music map, against the live library.
 *
 * All of the projection maths lives in map-projection.js; this is the part that
 * knows about the database: reading the embeddings, caching the two coordinates
 * per song, and joining them back to the rows the explorer needs in order to
 * play or select a song.
 *
 * Building the map is deliberate and occasional, like regrouping: it costs
 * seconds to minutes, and a map that quietly rearranged itself after every
 * import would be worse than one that is a few songs out of date. Songs analyzed
 * since the last build simply aren't on the map yet, and the view says so.
 */

const db = require('./database');
const { buildIndex } = require('./similarity-index');
const { projectLibrary, MIN_SONGS_TO_MAP } = require('./map-projection');

/**
 * Project the whole library and cache the result.
 *
 * @returns {{ points: number, songs: number }}
 */
function recalculateMap() {
  const embeddings = db.getAllEmbeddings();
  if (embeddings.length < MIN_SONGS_TO_MAP) return { points: 0, songs: embeddings.length };

  const coordinates = projectLibrary(buildIndex(embeddings));
  db.saveMapCoordinates(coordinates);
  return { points: coordinates.length, songs: embeddings.length };
}

/**
 * Every mapped song, with what the map needs to draw it and what the explorer
 * needs to play it.
 *
 * A song with no Main Library placement is left off, the same way search and
 * similarity leave it off: there would be nothing to select or play.
 *
 * @returns {{ points: Array<object>, analyzed: number }}
 */
function getMapPoints() {
  const mapped = db.getMapPoints();
  const rowsBySongId = new Map(
    db.getSongsWithPlacements(mapped.map(row => row.song_id)).map(row => [row.song_id, row])
  );

  const points = [];
  for (const row of mapped) {
    const song = rowsBySongId.get(row.song_id);
    if (!song) continue;
    points.push({
      songId: row.song_id,
      itemId: song.item_id,
      parentListId: song.parent_list_id,
      x: row.map_x,
      y: row.map_y,
      clusterId: row.cluster_id,
      title: song.title,
      artist: song.artist,
    });
  }

  return { points, analyzed: db.getAnalysisStats().analyzed };
}

/**
 * Freeze a lasso'd region of the map into a playlist.
 *
 * The same snapshot bargain as saving a group: the map moves when the library is
 * rebuilt, and a playlist you drew by hand should be yours to keep.
 */
function saveSelectionAsPlaylist(songIds, title) {
  const playlist = db.createPlaylist(title);
  songIds.forEach((songId, position) => {
    db.addSongToList(songId, playlist.id, position);
  });
  return playlist;
}

module.exports = {
  recalculateMap,
  getMapPoints,
  saveSelectionAsPlaylist,
};
