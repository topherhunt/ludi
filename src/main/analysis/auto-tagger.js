/**
 * Turning model scores into tags in the database.
 *
 * The interesting decisions -- which labels are distinctive enough to stick, and
 * how confident we are -- live in tag-calibration.js. This module is the part
 * that knows about storage: reading every analysis back, resolving tag names to
 * rows, and replacing the machine-applied assignments.
 */

const db = require('../database');
const TAG_COLORS = require('../../shared/tag-colors.json');
const { selectMsdTags, selectAxisTags } = require('./tag-calibration');

// Below this, "the top 16% of your library" is a handful of songs and the
// statistics behind every threshold in tag-calibration.js are noise.
const MIN_SONGS_TO_CALIBRATE = 20;

/**
 * Give an auto-created tag a stable color.
 *
 * Deterministic rather than random so "jazz" is the same color every time the
 * tagger runs, and the same color in your library as in mine.
 */
function colorForTagName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

/**
 * Recompute every machine-applied tag in the library from the stored analyses.
 *
 * Cheap and idempotent: it reads activations that are already on disk, so it can
 * be re-run whenever the library grows without touching a single audio file.
 * Tags you applied or removed by hand are preserved -- see database.js's notes
 * on song_tags.source.
 *
 * @returns {{ songs: number, tags: number, assignments: number, skipped?: string }}
 */
function recalculateAutoTags() {
  const axisRows = db.getAllAxes();
  if (axisRows.length < MIN_SONGS_TO_CALIBRATE) {
    return {
      songs: axisRows.length,
      tags: 0,
      assignments: 0,
      skipped: `needs at least ${MIN_SONGS_TO_CALIBRATE} analyzed songs to calibrate`,
    };
  }

  const activationRows = db.getAllActivations();
  const axesBySongId = new Map(axisRows.map((row) => [row.song_id, row.axes]));
  const rows = activationRows
    .filter((row) => axesBySongId.has(row.song_id))
    .map((row) => ({ ...row, axes: axesBySongId.get(row.song_id) }));

  const msdTags = selectMsdTags(rows);
  const axisTags = selectAxisTags(rows);

  // Resolve tag names to ids once, creating any that don't exist yet.
  const tagIdByName = new Map();
  const resolve = (name) => {
    if (!tagIdByName.has(name)) {
      tagIdByName.set(name, db.getOrCreateAutoTag(name, colorForTagName(name)).id);
    }
    return tagIdByName.get(name);
  };

  const assignments = [];
  for (const row of rows) {
    for (const hit of [...msdTags.get(row.song_id), ...axisTags.get(row.song_id)]) {
      assignments.push({
        songId: row.song_id,
        tagId: resolve(hit.tagName),
        confidence: hit.percentile,
      });
    }
  }

  const applied = db.replaceAutoTags(assignments);
  return { songs: rows.length, tags: tagIdByName.size, assignments: applied };
}

module.exports = {
  recalculateAutoTags,
  colorForTagName,
  MIN_SONGS_TO_CALIBRATE,
};
