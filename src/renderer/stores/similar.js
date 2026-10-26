import { createSignal, createMemo, createRoot } from 'solid-js';
import { findSimilarSongs } from '../utils/api.js';
import { clearSearch } from './search.js';
import { clearCluster, closeGroups } from './clusters.js';
import { closeMap } from './musicMap.js';
import { closeFacets } from './facets.js';

/**
 * "Songs like this one" results.
 *
 * This is a ranking, not a filter: the engine sorts the whole library by how
 * close it is to the seed and we show the top slice. So "show more" appends the
 * next slice of the same ranking rather than loosening a threshold -- what you
 * already see never changes when you ask for more.
 */
const PAGE_SIZE = 25;

const {
  similarResults,
  setSimilarResults,
  similarSeeds,
  setSimilarSeeds,
  similarTotal,
  setSimilarTotal,
  similarLoading,
  setSimilarLoading,
  similarNotice,
  setSimilarNotice,
  isShowingSimilar,
  hasMoreSimilar,
} = createRoot(() => {
  const [similarResults, setSimilarResults] = createSignal(null); // null = not in this view
  // The songs the search was seeded from ({ songId, title }), for the header and
  // for replaying the search from history. They're excluded from the results.
  const [similarSeeds, setSimilarSeeds] = createSignal([]);
  const [similarTotal, setSimilarTotal] = createSignal(0);
  const [similarLoading, setSimilarLoading] = createSignal(false);
  // Set when there is something to explain: nothing analyzed, no close matches.
  const [similarNotice, setSimilarNotice] = createSignal(null);

  const isShowingSimilar = createMemo(() => similarResults() !== null);
  const hasMoreSimilar = createMemo(() => (similarResults() || []).length < similarTotal());

  return {
    similarResults,
    setSimilarResults,
    similarSeeds,
    setSimilarSeeds,
    similarTotal,
    setSimilarTotal,
    similarLoading,
    setSimilarLoading,
    similarNotice,
    setSimilarNotice,
    isShowingSimilar,
    hasMoreSimilar,
  };
});

/**
 * Show songs similar to the given ones, replacing whatever the explorer was
 * showing.
 * @param {Array<{ songId: number, title: string }>} seeds
 */
async function showSimilarTo(seeds) {
  setSimilarSeeds(seeds);
  setSimilarResults([]);
  setSimilarTotal(0);
  setSimilarNotice(null);
  setSimilarLoading(true);

  // Only one answer to "what should the explorer show" is on screen at a time.
  clearSearch();
  clearCluster();
  closeGroups();
  closeMap();
  closeFacets();

  const response = await findSimilarSongs(seeds.map(seed => seed.songId), { limit: PAGE_SIZE, offset: 0 });
  setSimilarResults(response.results);
  setSimilarTotal(response.total);
  setSimilarNotice(noticeFor(response, seeds.length));
  setSimilarLoading(false);
}

/** Append the next page of the same ranking. */
async function showMoreSimilar() {
  if (similarLoading() || !hasMoreSimilar()) return;
  setSimilarLoading(true);

  const response = await findSimilarSongs(similarSeeds().map(seed => seed.songId), {
    limit: PAGE_SIZE,
    offset: (similarResults() || []).length,
  });
  setSimilarResults([...(similarResults() || []), ...response.results]);
  setSimilarTotal(response.total);
  setSimilarLoading(false);
}

/**
 * An empty result can mean two very different things, and silently showing
 * "0 songs" for both would send you looking for a bug that isn't there.
 */
function noticeFor(response, seedCount) {
  if (response.seedsAnalyzed === 0) {
    return seedCount === 1
      ? 'This song has not been analyzed yet. Run the audio analysis from Settings to find similar songs.'
      : 'None of the selected songs have been analyzed yet. Run the audio analysis from Settings to find similar songs.';
  }
  if (response.total === 0) {
    return 'Nothing in your library sounds close enough to this to be worth showing.';
  }
  return null;
}

function clearSimilar() {
  setSimilarResults(null);
  setSimilarSeeds([]);
  setSimilarTotal(0);
  setSimilarNotice(null);
  setSimilarLoading(false);
}

export {
  PAGE_SIZE,
  similarResults,
  similarSeeds,
  similarTotal,
  similarLoading,
  similarNotice,
  isShowingSimilar,
  hasMoreSimilar,
  showSimilarTo,
  showMoreSimilar,
  clearSimilar,
};
