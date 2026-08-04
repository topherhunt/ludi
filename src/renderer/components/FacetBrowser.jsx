import { For, Show } from 'solid-js';
import {
  facetPath,
  facetRows,
  facetMatches,
  drillInto,
  backTo,
  facetQuery,
} from '../stores/facets.js';
import { runSearch } from '../stores/search.js';
import { TagPill } from './TagPill.jsx';

/**
 * The facet browser: what the library is made of, one tag at a time.
 *
 * Every row is a tag you can drill into, with a bar showing how much of the
 * current selection carries it. Keep clicking and the breadcrumb grows; click a
 * crumb to back out. "Show these songs" turns the path into an ordinary search,
 * which is also how a combination worth keeping gets saved to the sidebar.
 */

// Below this a tag is no more concentrated here than anywhere else, so saying
// so would be noise on every row.
const NOTABLE_LIFT = 1.5;

export function FacetBrowser() {
  const handleShowSongs = () => {
    runSearch(facetQuery());
  };

  return (
    <div class="explorer-container facets-container qa-facets-view" id="explorerContainer">
      <div class="facet-breadcrumb">
        <span class="facet-crumb qa-facet-crumb-root" onClick={() => backTo(0)}>All songs</span>
        <For each={facetPath()}>
          {(tag, i) => (
            <>
              <i class="bi bi-chevron-right facet-crumb-sep" />
              <span class="facet-crumb qa-facet-crumb" onClick={() => backTo(i() + 1)}>
                <TagPill tag={tag} />
              </span>
            </>
          )}
        </For>
      </div>

      <div class="facet-summary">
        <span class="qa-facet-matches">{facetMatches().length} songs</span>
        <Show when={facetPath().length > 0}>
          <button class="map-status-btn qa-facet-show-songs" onClick={handleShowSongs}>
            Show these songs
          </button>
        </Show>
      </div>

      <div class="facet-list">
        <For
          each={facetRows()}
          fallback={
            <div class="facet-empty qa-facet-empty">
              <Show
                when={facetMatches().length > 0}
                fallback="No songs carry this combination of tags."
              >
                Nothing else is tagged on these songs.
              </Show>
            </div>
          }
        >
          {(row) => (
            <div
              class="facet-row qa-facet-row"
              data-tag-id={row.tag.id}
              onClick={() => drillInto(row.tag)}
            >
              <TagPill tag={row.tag} />
              <div class="facet-bar">
                <div class="facet-bar-fill" style={{ width: `${row.share * 100}%` }} />
              </div>
              <span class="facet-count qa-facet-count">{row.count}</span>
              {/* Only meaningful once something has been picked: it says how much
                  more common this tag is here than in the library at large. */}
              <Show when={facetPath().length > 0 && row.lift >= NOTABLE_LIFT}>
                <span class="facet-lift qa-facet-lift" title="More concentrated here than in the library at large">
                  {row.lift.toFixed(1)}x
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
