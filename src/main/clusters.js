/**
 * The auto-generated groups, against the live library.
 *
 * All of the maths lives in cluster-index.js; this is the part that knows about
 * the database: reading the embeddings, naming each group from the tags its
 * members already carry, and writing the result back so the sidebar can list it
 * without recomputing anything.
 *
 * Clustering is a deliberate, occasional act rather than something that happens
 * on its own. Regrouping the library is a big visible change -- names move,
 * counts change -- and it should happen when you ask for it, not silently
 * because you imported an album.
 */

const db = require('./database');
const { buildIndex } = require('./similarity-index');
const { clusterLibrary, nameClusters, MIN_SONGS_TO_CLUSTER } = require('./cluster-index');

/**
 * Regroup the whole library and store the result.
 *
 * @returns {{ clusters: Array<{id: number, name: string, size: number}>, songs: number, score: number }}
 */
function recalculateClusters() {
  const embeddings = db.getAllEmbeddings();
  if (embeddings.length < MIN_SONGS_TO_CLUSTER) {
    return { clusters: [], songs: embeddings.length, score: -1 };
  }

  const { k, score, assignments } = clusterLibrary(buildIndex(embeddings));
  if (k === 0) return { clusters: [], songs: embeddings.length, score: -1 };

  const names = nameClusters(assignments, db.getSongTagNames(), k);

  db.saveClusterAssignments(assignments);
  db.replaceClusters(names);

  return { clusters: db.getClusters(), songs: assignments.length, score };
}

/** The songs in one cluster, as explorer rows. */
function getClusterSongs(clusterId) {
  return db.getSongsWithPlacements(db.getClusterSongIds(clusterId));
}

/**
 * Freeze a cluster into a real playlist.
 *
 * A snapshot on purpose: the cluster keeps moving as the library is re-analyzed,
 * and a playlist you made from it should be yours to edit and keep.
 */
function saveClusterAsPlaylist(clusterId, title) {
  const playlist = db.createPlaylist(title);
  db.getClusterSongIds(clusterId).forEach((songId, position) => {
    db.addSongToList(songId, playlist.id, position);
  });
  return playlist;
}

module.exports = {
  recalculateClusters,
  getClusterSongs,
  saveClusterAsPlaylist,
};
