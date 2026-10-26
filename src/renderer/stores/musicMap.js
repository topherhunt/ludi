import { createSignal, createRoot, createEffect, on } from 'solid-js';
import * as api from '../utils/api.js';
import { clearSearch } from './search.js';
import { clearSimilar } from './similar.js';
import { clearCluster, closeGroups } from './clusters.js';
import { closeFacets } from './facets.js';
import { libraryVersion } from './tags.js';

/**
 * The music map.
 *
 * Every analyzed song is one dot, placed so that songs which sound alike sit
 * near each other. The positions are computed once and cached in the database,
 * so opening the map is a read; only the "rebuild" button pays the real cost.
 *
 * `analyzed` is carried alongside the points so the view can be honest about
 * what it is showing: songs analyzed since the last build have no position yet
 * and simply aren't there.
 */
const {
  mapOpen,
  setMapOpen,
  mapPoints,
  setMapPoints,
  mapAnalyzed,
  setMapAnalyzed,
  mapLoading,
  setMapLoading,
  mapBuilding,
  setMapBuilding,
} = createRoot(() => {
  const [mapOpen, setMapOpen] = createSignal(false);
  const [mapPoints, setMapPoints] = createSignal([]);
  const [mapAnalyzed, setMapAnalyzed] = createSignal(0);
  const [mapLoading, setMapLoading] = createSignal(false);
  const [mapBuilding, setMapBuilding] = createSignal(false);

  return {
    mapOpen,
    setMapOpen,
    mapPoints,
    setMapPoints,
    mapAnalyzed,
    setMapAnalyzed,
    mapLoading,
    setMapLoading,
    mapBuilding,
    setMapBuilding,
  };
});

async function loadMapPoints() {
  setMapLoading(true);
  try {
    const { points, analyzed } = await api.getMapPoints();
    setMapPoints(points);
    setMapAnalyzed(analyzed);
  } finally {
    setMapLoading(false);
  }
}

/** Open the map, replacing whatever the explorer was showing. */
async function openMap() {
  // Only one answer to "what should the explorer show" is on screen at a time.
  clearSearch();
  clearSimilar();
  clearCluster();
  closeGroups();
  closeFacets();
  setMapOpen(true);
  await loadMapPoints();
}

function closeMap() {
  setMapOpen(false);
}

// Deleted songs leave the map and edited titles show in its tooltip.
createRoot(() => createEffect(on(libraryVersion, () => { if (mapOpen()) loadMapPoints(); }, { defer: true })));

/**
 * Every song on the map, the one at `itemId` first and then outward by distance
 * -- what plays after a dot you double-click is whatever sounds closest to it.
 */
function mapPointsNearestTo(itemId) {
  const origin = mapPoints().find(point => point.itemId === itemId);
  if (!origin) throw new Error(`Item ${itemId} is not on the map`);
  const distance = point => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
  return [...mapPoints()].sort((a, b) => distance(a) - distance(b));
}

/**
 * Re-project the whole library. The slowest thing the app does -- seconds for a
 * few thousand songs -- so it only ever happens on request.
 */
async function rebuildMap() {
  setMapBuilding(true);
  try {
    const summary = await api.recalculateMap();
    await loadMapPoints();
    return summary;
  } finally {
    setMapBuilding(false);
  }
}

export {
  mapOpen,
  mapPoints,
  mapAnalyzed,
  mapLoading,
  mapBuilding,
  openMap,
  closeMap,
  mapPointsNearestTo,
  rebuildMap,
};
