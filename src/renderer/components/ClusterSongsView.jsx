import { For, Show } from 'solid-js';
import { clusterSongs } from '../stores/clusters.js';
import { clearSelection } from '../stores/navigation.js';
import { SearchSongRow } from './SearchResultsView.jsx';

/**
 * One auto-generated group's songs.
 *
 * Flat, in library order: a group has no ranking to preserve, and its members
 * are already as alike as the analysis could make them. Rows are the same ones
 * search and similarity use, so selection, drag-out and double-click-to-play all
 * behave identically.
 */
export function ClusterSongsView(props) {
  const handleContainerDblClick = (e) => {
    const songEl = e.target.closest('[data-song-id]');
    if (!songEl) return;
    const itemId = parseInt(songEl.dataset.itemId);
    const song = clusterSongs().find(s => s.item_id === itemId);
    if (song) props.onPlaySong?.(song.item_id, song.parent_list_id);
  };

  const handleContainerClick = (e) => {
    if (!e.target.closest('.tree-item-content')) clearSelection();
  };

  return (
    <div
      class="explorer-container qa-cluster-view"
      id="explorerContainer"
      onClick={handleContainerClick}
      onDblClick={handleContainerDblClick}
    >
      <Show
        when={clusterSongs().length > 0}
        fallback={
          <div class="search-empty-state qa-cluster-empty">
            <i class="bi bi-diagram-2" />
            <p>Every song in this group has been removed from your library.</p>
          </div>
        }
      >
        <ul class="explorer-tree" id="explorerTree">
          <For each={clusterSongs()}>
            {(song) => <SearchSongRow song={song} depth={0} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}
