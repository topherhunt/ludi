import { createSignal, createMemo, createRoot, createEffect, on } from 'solid-js';
import * as api from '../utils/api.js';
import { clearSearch } from './search.js';
import { clearSimilar } from './similar.js';
import { closeMap } from './musicMap.js';
import { closeFacets } from './facets.js';
import { libraryVersion } from './tags.js';

/**
 * The auto-generated groups.
 *
 * A group is the library's own answer to "what goes with what": every analyzed
 * song belongs to exactly one, and the name is whatever its members have more of
 * than the rest of the library. Viewing one replaces what the explorer is
 * showing, the same way a search or a similarity ranking does.
 *
 * Regrouping is explicit. It moves every song at once, so it happens when you
 * press the button and never on its own.
 */
const {
  clusters,
  setClusters,
  activeCluster,
  setActiveCluster,
  clusterSongs,
  setClusterSongs,
  clustering,
  setClustering,
  isShowingCluster,
  groupsOpen,
  setGroupsOpen,
} = createRoot(() => {
  const [clusters, setClusters] = createSignal([]);
  const [activeCluster, setActiveCluster] = createSignal(null); // { id, name, size } | null
  const [clusterSongs, setClusterSongs] = createSignal([]);
  const [clustering, setClustering] = createSignal(false);
  // The list of every group, shown in the explorer.
  const [groupsOpen, setGroupsOpen] = createSignal(false);

  const isShowingCluster = createMemo(() => activeCluster() !== null);

  return {
    clusters,
    setClusters,
    activeCluster,
    setActiveCluster,
    clusterSongs,
    setClusterSongs,
    clustering,
    setClustering,
    isShowingCluster,
    groupsOpen,
    setGroupsOpen,
  };
});

/** Reload the group list from the database. */
async function refreshClusters() {
  setClusters(await api.getClusters());
}

/**
 * Regroup the whole library. Returns the summary so the caller can say what
 * happened -- including "nothing", when too little of the library is analyzed.
 */
async function regenerateClusters() {
  setClustering(true);
  try {
    const summary = await api.recalculateClusters();
    setClusters(summary.clusters);
    // Whatever group was on screen may not exist any more, and its songs
    // certainly moved.
    clearCluster();
    return summary;
  } finally {
    setClustering(false);
  }
}

/** Show the list of groups in the explorer. */
async function openGroups() {
  // Only one answer to "what should the explorer show" is on screen at a time.
  clearSearch();
  clearSimilar();
  clearCluster();
  closeMap();
  closeFacets();
  setGroupsOpen(true);
  await refreshClusters();
}

function closeGroups() {
  setGroupsOpen(false);
}

/** Show one group's songs in the explorer. */
async function showCluster(cluster) {
  clearSearch();
  clearSimilar();
  closeGroups();
  closeMap();
  closeFacets();
  setActiveCluster(cluster);
  setClusterSongs(await api.getClusterSongs(cluster.id));
}

/** Re-read the open group's songs after a library change (a rating, an edit, a delete). */
async function refreshClusterSongs() {
  const cluster = activeCluster();
  if (!cluster) return;
  const songs = await api.getClusterSongs(cluster.id);
  // Another group (or none) was opened while this one was loading.
  if (activeCluster() === null || activeCluster().id !== cluster.id) return;
  setClusterSongs(songs);
}

createRoot(() => createEffect(on(libraryVersion, refreshClusterSongs, { defer: true })));

/** Rename a group. Its membership is untouched. */
async function renameCluster(clusterId, newName) {
  await api.renameCluster(clusterId, newName);
  await refreshClusters();
  const active = activeCluster();
  if (active && active.id === clusterId) setActiveCluster({ ...active, name: newName });
}

function clearCluster() {
  setActiveCluster(null);
  setClusterSongs([]);
}

export {
  clusters,
  activeCluster,
  clusterSongs,
  clustering,
  isShowingCluster,
  groupsOpen,
  openGroups,
  closeGroups,
  refreshClusters,
  regenerateClusters,
  showCluster,
  renameCluster,
  clearCluster,
};
