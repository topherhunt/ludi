import { Show, onCleanup, createEffect } from 'solid-js';
import { searchQuery, isSearching, searchViewMode, setSearchViewMode, runSearch, clearSearch } from '../stores/search.js';

export function ExplorerHeader(props) {
  let searchInputRef;
  let debounceTimer = null;

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

  // Sync the input whenever the store's query changes (e.g. after Advanced Search submits)
  createEffect(() => {
    const q = searchQuery();
    if (searchInputRef) { searchInputRef.value = q; updateWidth(q); }
  });

  onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer); });

  return (
    <div class="explorer-header">
      <div class="explorer-header-left">
        <Show
          when={isSearching()}
          fallback={<h1 id="currentListTitle">{props.title || 'Main Library'}</h1>}
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
