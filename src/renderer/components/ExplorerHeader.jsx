import { Show, onCleanup, createEffect } from 'solid-js';
import { searchQuery, isSearching, searchViewMode, setSearchViewMode, runSearch, clearSearch } from '../stores/search.js';
import { isShowingSimilar, similarSeeds, similarTotal, clearSimilar } from '../stores/similar.js';
import { saveSearch } from '../stores/savedSearches.js';
import { isShowingCluster, activeCluster, clusterSongs, clearCluster, groupsOpen, clusters, closeGroups } from '../stores/clusters.js';
import { goBack, goForward, backTarget, forwardTarget, viewLabel } from '../stores/viewHistory.js';
import { mapOpen, mapPoints, closeMap } from '../stores/musicMap.js';
import { facetsOpen, facetMatches, closeFacets } from '../stores/facets.js';
import { bumpLibraryVersion } from '../stores/tags.js';
import { saveClusterAsPlaylist } from '../utils/api.js';
import { showRenameModal, showAlert } from '../stores/modals.js';

export function ExplorerHeader(props) {
  let searchInputRef;
  let debounceTimer = null;

  // Naming the seed only works for one song. Past that the honest heading is the
  // count, since the results come from the middle of the selection rather than
  // from any one of them.
  const similarHeading = () => {
    const seeds = similarSeeds();
    const suffix = similarTotal() > 0 ? ` (${similarTotal()})` : '';
    if (seeds.length === 1) return `Songs like "${seeds[0].title}"${suffix}`;
    return `Songs like ${seeds.length} selected songs${suffix}`;
  };

  const updateWidth = (val) => {
    if (!searchInputRef) return;
    const w = Math.min(400, Math.max(200, (val || '').length * 7.5 + 56));
    searchInputRef.style.width = w + 'px';
  };

  const scheduleSearch = (val) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!val.trim()) { clearSearch(); return; }
    debounceTimer = setTimeout(() => { debounceTimer = null; runSearch(val); }, 500);
  };

  const handleSearchInput = (e) => {
    const val = e.target.value;
    updateWidth(val);
    scheduleSearch(val);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      runSearch(searchInputRef?.value || '');
    } else if (e.key === 'Escape') {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      clearSearch();
      if (searchInputRef) { searchInputRef.value = ''; updateWidth(''); }
    }
  };

  const handleClearSearch = () => {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    clearSearch();
    if (searchInputRef) { searchInputRef.value = ''; updateWidth(''); searchInputRef.focus(); }
  };

  // Freeze the group being viewed into a real playlist, named after the group by
  // default. The library version bump is what puts it in the sidebar.
  const handleSaveClusterAsPlaylist = () => {
    const cluster = activeCluster();
    showRenameModal(cluster.name, async (title) => {
      const trimmed = (title || '').trim();
      if (!trimmed) return;
      await saveClusterAsPlaylist(cluster.id, trimmed);
      bumpLibraryVersion();
      showAlert(
        '<i class="bi bi-music-note-list" style="margin-right: 8px;"></i>Playlist Created',
        `"${trimmed}" now holds ${clusterSongs().length} songs.`
      );
    }, 'Save Group As Playlist');
  };

  // Pin the current query to the sidebar under a name of your choosing. The
  // query itself is the suggested name, since a facet combination like
  // "tag=jazz tag=live" already reads as a title.
  const handleSaveSearch = () => {
    const query = searchQuery();
    showRenameModal(query, async (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return;
      await saveSearch(trimmed, query);
    }, 'Save Search');
  };

  // Sync the input whenever the store's query changes (e.g. after Advanced Search submits)
  createEffect(() => {
    const q = searchQuery();
    if (searchInputRef) { searchInputRef.value = q; updateWidth(q); }
  });

  onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer); });

  return (
    <div class="explorer-header">
      <div class="explorer-header-left">
        <div class="nav-buttons">
          <button
            class="nav-btn qa-nav-back"
            disabled={!backTarget()}
            data-tooltip={backTarget() ? `Back to ${viewLabel(backTarget())}` : undefined}
            onClick={goBack}
          >
            <i class="bi bi-chevron-left" />
          </button>
          <button
            class="nav-btn qa-nav-forward"
            disabled={!forwardTarget()}
            data-tooltip={forwardTarget() ? `Forward to ${viewLabel(forwardTarget())}` : undefined}
            onClick={goForward}
          >
            <i class="bi bi-chevron-right" />
          </button>
        </div>

        <Show when={isShowingSimilar()}>
          <h1 id="currentListTitle" class="qa-similar-title">{similarHeading()}</h1>
          <button
            class="search-clear-btn qa-exit-similar"
            onClick={() => clearSimilar()}
            title="Back to the library"
          >
            <i class="bi bi-x-lg" />
          </button>
        </Show>

        <Show when={isShowingCluster()}>
          <h1 id="currentListTitle" class="qa-cluster-title">
            {activeCluster().name} ({clusterSongs().length})
          </h1>
          <button
            class="search-save-btn qa-cluster-save-playlist"
            onClick={handleSaveClusterAsPlaylist}
            title="Save this group as a playlist"
          >
            <i class="bi bi-music-note-list" />
          </button>
          <button
            class="search-clear-btn qa-exit-cluster"
            onClick={() => clearCluster()}
            title="Back to the library"
          >
            <i class="bi bi-x-lg" />
          </button>
        </Show>

        <Show when={groupsOpen()}>
          <h1 id="currentListTitle" class="qa-groups-title">Groups ({clusters().length})</h1>
          <button
            class="search-clear-btn qa-exit-groups"
            onClick={() => closeGroups()}
            title="Back to the library"
          >
            <i class="bi bi-x-lg" />
          </button>
        </Show>

        <Show when={mapOpen()}>
          <h1 id="currentListTitle" class="qa-map-title">Music Map ({mapPoints().length})</h1>
          <button
            class="search-clear-btn qa-exit-map"
            onClick={() => closeMap()}
            title="Back to the library"
          >
            <i class="bi bi-x-lg" />
          </button>
        </Show>

        <Show when={facetsOpen()}>
          <h1 id="currentListTitle" class="qa-facets-title">Facets ({facetMatches().length})</h1>
          <button
            class="search-clear-btn qa-exit-facets"
            onClick={() => closeFacets()}
            title="Back to the library"
          >
            <i class="bi bi-x-lg" />
          </button>
        </Show>

        <Show
          when={isSearching()}
          fallback={
            <Show when={!isShowingSimilar() && !isShowingCluster() && !groupsOpen() && !mapOpen() && !facetsOpen()}>
              <h1 id="currentListTitle">{props.title || 'Main Library'}</h1>
            </Show>
          }
        >
          <h1 id="currentListTitle">Search Results in {props.title || 'Main Library'}</h1>
          <div class="search-view-toggle">
            <button
              class="search-toggle-btn"
              classList={{ active: searchViewMode() === 'nested' }}
              onClick={() => setSearchViewMode('nested')}
              title="Nested view"
            >
              <i class="bi bi-diagram-3" />
            </button>
            <button
              class="search-toggle-btn"
              classList={{ active: searchViewMode() === 'flat' }}
              onClick={() => setSearchViewMode('flat')}
              title="Flat view"
            >
              <i class="bi bi-list-ul" />
            </button>
          </div>
        </Show>
      </div>

      <div class="explorer-header-right">
        <div class="search-input-wrapper">
          <i class="bi bi-search search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            class="search-input"
            placeholder="Search..."
            spellcheck={false}
            onInput={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
          />
          <Show when={isSearching()}>
            <button class="search-clear-btn" onClick={handleClearSearch} title="Clear search">
              <i class="bi bi-x-lg" />
            </button>
          </Show>
        </div>
        <Show when={isSearching()}>
          <button
            class="search-save-btn qa-save-search"
            onClick={handleSaveSearch}
            title="Save this search to the sidebar"
          >
            <i class="bi bi-bookmark-plus" />
          </button>
        </Show>
        <button
          class="search-advanced-btn"
          classList={{ active: props.advancedSearchOpen }}
          onClick={props.onAdvancedSearch}
          title="Advanced search"
        >
          <i class="bi bi-gear-wide-connected" />
        </button>
      </div>
    </div>
  );
}
