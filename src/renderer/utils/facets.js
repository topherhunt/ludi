/**
 * Facet drill-down: what the library is made of, one tag at a time.
 *
 * Start with every tag and how many songs carry it. Pick one and the list
 * becomes the tags that appear *alongside* it, with the number of songs carrying
 * both -- so "electronic" leads to "instrumental (48)", that leads to "mellow
 * (19)", and three clicks in you are looking at a corner of the library you had
 * no name for when you started.
 *
 * Counts alone would put the biggest tags at the top of every list, which says
 * more about the library than about the tag you picked. `lift` is the fix: how
 * much more common a tag is here than in the library at large. A lift of 3 means
 * three times as concentrated as usual, which is what "goes with" actually
 * means.
 */

/** Songs carrying every one of `tagIds`. An empty selection matches everything. */
function songsMatchingAll(songs, tagIds) {
  if (tagIds.length === 0) return songs;
  return songs.filter(song => tagIds.every(
    id => (song.tags || []).some(tag => tag.id === id)
  ));
}

/** tagId -> { tag, count } over the given songs. */
function countByTag(songs) {
  const counts = new Map();
  for (const song of songs) {
    for (const tag of song.tags || []) {
      const entry = counts.get(tag.id);
      if (entry) entry.count += 1;
      else counts.set(tag.id, { tag, count: 1 });
    }
  }
  return counts;
}

/**
 * The songs matching the current drill-down, and the tags to drill down into
 * next, commonest first.
 *
 * @param {Array} songs - every song in scope: { id, tags: [{ id, name, ... }] }
 * @param {Array<number>} selectedTagIds - the path drilled so far
 * @returns {{ matching: Array, facets: Array<{ tag, count, share, lift }> }}
 */
function facetsFor(songs, selectedTagIds) {
  const matching = songsMatchingAll(songs, selectedTagIds);
  if (matching.length === 0) return { matching: [], facets: [] };

  const overall = countByTag(songs);
  const selected = new Set(selectedTagIds);

  const facets = Array.from(countByTag(matching).values())
    .filter(entry => !selected.has(entry.tag.id))
    .map(entry => {
      const share = entry.count / matching.length;
      return {
        tag: entry.tag,
        count: entry.count,
        share,
        lift: share / (overall.get(entry.tag.id).count / songs.length),
      };
    });

  facets.sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name));
  return { matching, facets };
}

export { facetsFor, songsMatchingAll, countByTag };
