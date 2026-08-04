import { createSignal, createMemo, createRoot } from 'solid-js';
import * as api from '../utils/api.js';
import { clearSearch } from './search.js';
import { clearSimilar } from './similar.js';
import { closeMap } from './musicMap.js';
import { closeFacets } from './facets.js';

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
} = createRoot(() => {
  const [clusters, setClusters] = createSignal([]);
  const [activeCluster, setActiveCluster] = createSignal(null); // { id, name, size } | null
  const [clusterSongs, setClusterSongs] = createSignal([]);
  const [clustering, setClustering] = createSignal(false);

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

/** Show one group's songs in the explorer. */
async function showCluster(cluster) {
  // A group, a search, a similarity ranking, the map and the facet browser are
  // five answers to "what should the explorer show", so opening one puts the
  // others away.
  clearSearch();
  clearSimilar();
  closeMap();
  closeFacets();
  setActiveCluster(cluster);
  setClusterSongs(await api.getClusterSongs(cluster.id));
}

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
  refreshClusters,
  regenerateClusters,
  showCluster,
  renameCluster,
  clearCluster,
};
