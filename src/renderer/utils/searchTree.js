/**
 * Given matched songs with ancestor_folders, build a virtual nested tree rooted
 * at `rootListId` (the list the search was run in -- the Main Library or a
 * playlist).
 * Applies collapsing: folders with exactly 1 matched child are inlined at the parent level.
 * Returns array of nodes: { type:'song'|'folder', ... }
 */
export function buildNestedTree(matchedSongs, rootListId) {
  if (!matchedSongs || matchedSongs.length === 0) return [];

  // folder metadata: list_id -> { title, position, parentListId }
  // The root itself is never rendered; it only anchors the recursion.
  const folderMeta = new Map();
  folderMeta.set(rootListId, { title: '', position: 0, parentListId: null });

  for (const song of matchedSongs) {
    let prevListId = rootListId;
    for (const ancestor of song.ancestor_folders) {
      if (!folderMeta.has(ancestor.list_id)) {
        folderMeta.set(ancestor.list_id, {
          title: ancestor.title,
          position: ancestor.position,
          parentListId: prevListId,
        });
      }
      prevListId = ancestor.list_id;
    }
  }

  // songs by direct parent list_id
  const songsByParent = new Map();
  for (const song of matchedSongs) {
    const pid = song.parent_list_id;
    if (!songsByParent.has(pid)) songsByParent.set(pid, []);
    songsByParent.get(pid).push(song);
  }

  function renderFolder(listId) {
    const rawChildren = [];

    // Direct songs in this folder
    for (const song of (songsByParent.get(listId) || [])) {
      rawChildren.push({ type: 'song', data: song, position: song.position });
    }

    // Subfolders whose parentListId is this folder
    for (const [folderId, meta] of folderMeta) {
      if (meta.parentListId !== listId) continue;

      const subChildren = renderFolder(folderId);
      if (subChildren.length === 0) continue;

      if (subChildren.length === 1) {
        // Collapse: inline the single child at this folder's position
        rawChildren.push({ ...subChildren[0], position: meta.position });
      } else {
        rawChildren.push({
          type: 'folder',
          list_id: folderId,
          title: meta.title,
          position: meta.position,
          children: subChildren,
        });
      }
    }

    rawChildren.sort((a, b) => a.position - b.position);
    return rawChildren;
  }

  return renderFolder(rootListId);
}

/**
 * The songs under `nodes`, top to bottom in the order the tree renders them.
 * Collapsed folders count -- collapsing hides rows, it doesn't drop them from
 * the results.
 */
export function songsInTreeOrder(nodes) {
  const songs = [];
  for (const node of nodes) {
    if (node.type === 'folder') songs.push(...songsInTreeOrder(node.children));
    else songs.push(node.data);
  }
  return songs;
}

/** Find the virtual folder node for `listId` anywhere in the tree. */
export function findTreeFolder(nodes, listId) {
  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    if (node.list_id === listId) return node;
    const inside = findTreeFolder(node.children, listId);
    if (inside) return inside;
  }
  return null;
}
