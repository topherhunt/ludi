/**
 * Grouping and sorting for every song list (library, playlists, search,
 * similar songs, groups). Pure: rows in, a tree of nodes out.
 *
 * Nodes are `{ key, type: 'song', data }` or
 * `{ key, type: 'group', title, songCount, children }`. Keys are stable across
 * re-arrangements so a reconciled store keeps each row's DOM in place.
 */

// A song missing the value for a level isn't grouped at that level; it carries
// on to the next level (or stands alone) at the same depth.
const GROUP_LEVELS = {
  album: (row) => knownText(row.album),
  artist: (row) => knownText(row.artist),
  genre: (row) => knownText(row.genre),
  year_added: (row) => (row.date_added ? row.date_added.slice(0, 4) : null),
};

export const GROUP_MODES = {
  none: { label: 'No grouping', levels: [] },
  album: { label: 'Album', levels: ['album'] },
  artist_album: { label: 'Artist, then album', levels: ['artist', 'album'] },
  year_album: { label: 'Year added, then album', levels: ['year_added', 'album'] },
  genre_album: { label: 'Genre, then album', levels: ['genre', 'album'] },
};

// `natural` is the order the rows arrive in: playlist order, library order,
// best match first. Its label depends on the view, so it has none here.
export const SORT_FIELDS = {
  natural: { defaultDir: 'asc', value: (row, index) => index },
  date_added: { label: 'Date added', defaultDir: 'asc', value: (row) => row.date_added || null },
  album: { label: 'Album', defaultDir: 'asc', value: (row) => knownText(row.album) },
  artist: { label: 'Artist', defaultDir: 'asc', value: (row) => knownText(row.artist) },
  title: { label: 'Song name', defaultDir: 'asc', value: (row) => knownText(row.title) },
  genre: { label: 'Genre', defaultDir: 'asc', value: (row) => knownText(row.genre) },
  last_played: { label: 'Last played', defaultDir: 'desc', value: (row) => row.last_played_at || null },
  rating: { label: 'Rating', defaultDir: 'desc', value: (row) => row.rating },
  plays: { label: 'Plays', defaultDir: 'desc', value: (row) => row.play_count },
};

// 'Unknown' is what import writes when a file has no artist/album tag.
function knownText(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed === 'Unknown' ? null : trimmed;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// Nulls sort last whichever way the field runs.
function compareValues(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = typeof a === 'string' ? collator.compare(a, b) : a - b;
  return dir === 'desc' ? -cmp : cmp;
}

function buildLevel(entries, levels, parentKey) {
  if (levels.length === 0) {
    return entries.map((entry) => ({ key: `item:${entry.row.item_id}`, type: 'song', data: entry.row, entries: [entry] }));
  }

  const [level, ...rest] = levels;
  const valueOf = GROUP_LEVELS[level];
  if (!valueOf) throw new Error(`Unknown group level: ${level}`);

  const ungrouped = [];
  const groups = new Map(); // lowercased value -> { title, entries }
  for (const entry of entries) {
    const value = valueOf(entry.row);
    if (value === null) { ungrouped.push(entry); continue; }
    const id = value.toLowerCase();
    if (!groups.has(id)) groups.set(id, { title: value, entries: [] });
    groups.get(id).entries.push(entry);
  }

  const nodes = buildLevel(ungrouped, rest, parentKey);
  for (const [id, group] of groups) {
    const key = `${parentKey}/${level}:${id}`;
    if (group.entries.length === 1) {
      nodes.push(...buildLevel(group.entries, [], key));
      continue;
    }
    nodes.push({
      key,
      type: 'group',
      title: group.title,
      songCount: group.entries.length,
      children: buildLevel(group.entries, rest, key),
      entries: group.entries,
    });
  }
  return nodes;
}

// A group sorts by whichever of its songs' values would come first: the
// smallest when ascending, the largest when descending.
function sortValue(node, valueOf, dir) {
  let best = null;
  for (const entry of node.entries) {
    const value = valueOf(entry.row, entry.index);
    if (value === null || value === undefined) continue;
    if (best === null || compareValues(value, best, dir) < 0) best = value;
  }
  return best;
}

const trackOf = (row) => row.track_number || null;

function sortNodes(nodes, sort) {
  const keyed = nodes.map((node) => ({
    node,
    values: sort.map(({ field, dir }) => sortValue(node, SORT_FIELDS[field].value, dir)),
    track: sortValue(node, trackOf, 'asc'),
    title: node.type === 'group' ? node.title : knownText(node.data.title),
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sort.length; i++) {
      const cmp = compareValues(a.values[i], b.values[i], sort[i].dir);
      if (cmp !== 0) return cmp;
    }
    return compareValues(a.track, b.track, 'asc') || compareValues(a.title, b.title, 'asc');
  });
  return keyed.map(({ node }) => {
    if (node.type === 'group') node.children = sortNodes(node.children, sort);
    return node;
  });
}

function stripEntries(nodes) {
  return nodes.map((node) => {
    const { entries, ...rest } = node;
    if (rest.type === 'group') rest.children = stripEntries(rest.children);
    return rest;
  });
}

/**
 * @param {Array} rows - song rows in the view's natural order; each needs `item_id`
 * @param {{ groupBy: string, sort: Array<{ field: string, dir: 'asc'|'desc' }> }} settings
 */
export function arrangeRows(rows, { groupBy, sort }) {
  const mode = GROUP_MODES[groupBy];
  if (!mode) throw new Error(`Unknown group mode: ${groupBy}`);
  if (sort.length === 0) throw new Error('A sort needs at least one field');
  for (const { field } of sort) {
    if (!SORT_FIELDS[field]) throw new Error(`Unknown sort field: ${field}`);
  }

  const entries = rows.map((row, index) => ({ row, index }));
  return stripEntries(sortNodes(buildLevel(entries, mode.levels, 'group'), sort));
}

/**
 * The songs under `nodes`, top to bottom in the order they render. Collapsed
 * groups count -- collapsing hides rows, it doesn't drop them from the list.
 */
export function songsInTreeOrder(nodes) {
  const songs = [];
  for (const node of nodes) {
    if (node.type === 'group') songs.push(...songsInTreeOrder(node.children));
    else songs.push(node.data);
  }
  return songs;
}

/** Find the group node with `key` anywhere in the tree, or null. */
export function findGroup(nodes, key) {
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    if (node.key === key) return node;
    const inside = findGroup(node.children, key);
    if (inside) return inside;
  }
  return null;
}
