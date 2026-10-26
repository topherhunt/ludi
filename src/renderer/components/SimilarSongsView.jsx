import { For, Show } from 'solid-js';
import {
  similarResults,
  similarTotal,
  similarLoading,
  similarNotice,
  hasMoreSimilar,
  showMoreSimilar,
  PAGE_SIZE,
} from '../stores/similar.js';
import { clearSelection } from '../stores/navigation.js';
import { SearchSongRow } from './SearchResultsView.jsx';

/**
 * The "songs like this one" results list.
 *
 * Always flat, always best-first: the whole point is the ranking, and nesting
 * the results under their folders would bury it. Rows are the same ones search
 * uses, so selection, drag-out and double-click-to-play all behave identically.
 */
export function SimilarSongsView(props) {
  const handleContainerDblClick = (e) => {
    const songEl = e.target.closest('[data-song-id]');
    if (!songEl) return;
    const itemId = parseInt(songEl.dataset.itemId);
    const song = (similarResults() || []).find(s => s.item_id === itemId);
    if (song) props.onPlaySong?.(song.item_id, song.parent_list_id);
  };

  const handleContainerClick = (e) => {
    if (!e.target.closest('.tree-item-content')) clearSelection();
  };

  const remaining = () => similarTotal() - (similarResults() || []).length;

  return (
    <div
      class="explorer-container qa-similar-view"
      id="explorerContainer"
      onClick={handleContainerClick}
      onDblClick={handleContainerDblClick}
    >
      <Show when={similarNotice()}>
        <div class="search-empty-state qa-similar-notice">
          <i class="bi bi-soundwave" />
          <p>{similarNotice()}</p>
        </div>
      </Show>

      <Show when={(similarResults() || []).length > 0}>
        <ul class="explorer-tree" id="explorerTree">
          <For each={similarResults()}>
            {(song) => <SearchSongRow song={song} depth={0} onContextMenu={props.onContextMenu} similarity={song.similarity} />}
          </For>
        </ul>

        <Show when={hasMoreSimilar()}>
          <div class="similar-show-more">
            <button
              class="similar-show-more-btn qa-similar-show-more"
              disabled={similarLoading()}
              onClick={() => showMoreSimilar()}
            >
              Show {Math.min(PAGE_SIZE, remaining())} more
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
