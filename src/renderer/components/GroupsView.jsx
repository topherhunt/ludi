import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { clusters, clustering, regenerateClusters, showCluster, renameCluster } from '../stores/clusters.js';
import { clearSelection } from '../stores/navigation.js';
import { showRenameModal, showAlert } from '../stores/modals.js';
import { FloatingMenu } from './FloatingMenu.jsx';

/**
 * Every auto-generated group, with the button that regroups the library.
 * Clicking a group opens its songs; Back returns here.
 */
export function GroupsView() {
  const [menu, setMenu] = createSignal(null); // { x, y, cluster } | null

  const handleRegroup = async () => {
    const summary = await regenerateClusters();
    if (summary.clusters.length === 0) {
      showAlert(
        '<i class="bi bi-diagram-2" style="margin-right: 8px;"></i>Not Enough To Group',
        `Only ${summary.songs} songs have been analyzed. Run the audio analysis from Settings first -- grouping needs a library to find patterns in.`
      );
      return;
    }
    showAlert(
      '<i class="bi bi-diagram-2" style="margin-right: 8px;"></i>Library Grouped',
      `${summary.songs} songs sorted into ${summary.clusters.length} groups.`
    );
  };

  const handleOpen = (cluster) => {
    clearSelection();
    showCluster(cluster);
  };

  const handleContextMenu = (e, cluster) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, cluster });
  };

  const handleRename = (cluster) => {
    setMenu(null);
    showRenameModal(cluster.name, async (newName) => {
      const trimmed = (newName || '').trim();
      if (!trimmed || trimmed === cluster.name) return;
      await renameCluster(cluster.id, trimmed);
    }, 'Rename Group');
  };

  onMount(() => {
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    const onDocClick = (e) => { if (menu() && !e.target.closest('.cluster-context-menu')) setMenu(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDocClick);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
    });
  });

  return (
    <div class="explorer-container facets-container qa-groups-view" id="explorerContainer">
      <div class="facet-summary groups-summary">
        <span class="qa-groups-count">{clusters().length} groups</span>
        <button class="map-status-btn qa-recluster" disabled={clustering()} onClick={handleRegroup}>
          {clustering() ? 'Grouping...' : clusters().length > 0 ? 'Regroup library' : 'Group songs that sound alike'}
        </button>
      </div>

      <div class="facet-list">
        <Show
          when={clusters().length > 0}
          fallback={<div class="facet-empty qa-clusters-empty">Not grouped yet.</div>}
        >
          <For each={clusters()}>
            {(cluster) => (
              <div
                class="facet-row qa-cluster-item"
                data-cluster-id={cluster.id}
                onClick={() => handleOpen(cluster)}
                onContextMenu={(e) => handleContextMenu(e, cluster)}
              >
                <i class="bi bi-diagram-2" />
                <span class="group-name">{cluster.name}</span>
                <span class="facet-count qa-cluster-size">{cluster.size}</span>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={menu()}>
        <FloatingMenu class="context-menu cluster-context-menu" x={menu().x} y={menu().y}>
          <div class="context-menu-item qa-cluster-rename" onClick={() => handleRename(menu().cluster)}>
            <i class="bi bi-pencil context-menu-icon"></i>Rename
          </div>
        </FloatingMenu>
      </Show>
    </div>
  );
}
