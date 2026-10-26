import { createSignal, Show, Switch, Match } from 'solid-js';
import { currentListId, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import { showRenameModal, hideRenameModal, showConfirmModal, hideConfirmModal, showAlert } from '../stores/modals.js';
import { ExplorerHeader } from './ExplorerHeader.jsx';
import { ColumnHeaders } from './ColumnHeaders.jsx';
import { TreeView } from './TreeView.jsx';
import { ContextMenu } from './ContextMenu.jsx';
import { BatchRenameModal } from './BatchRenameModal.jsx';
import { RenameModal, ConfirmModal } from './Modal.jsx';
import { useKeyboard } from '../hooks/useKeyboard.js';
import {
  addFolder,
  copyItemsToFolder,
  deleteItemWithFiles,
  removeItemsFromList,
  renameFolder,
  getListItems,
  getItem,
  getSong,
} from '../utils/api.js';
import { selectedItems, clearSelection, selectItem } from '../stores/navigation.js';
import { isSearching, runSearch, searchFolderSongs } from '../stores/search.js';
import { isShowingSimilar, showSimilarTo } from '../stores/similar.js';
import { rateFromRow } from '../stores/ratings.js';
import { SearchResultsView } from './SearchResultsView.jsx';
import { SimilarSongsView } from './SimilarSongsView.jsx';
import { ClusterSongsView } from './ClusterSongsView.jsx';
import { isShowingCluster, groupsOpen } from '../stores/clusters.js';
import { GroupsView } from './GroupsView.jsx';
import { MusicMapView } from './MusicMapView.jsx';
import { mapOpen } from '../stores/musicMap.js';
import { FacetBrowser } from './FacetBrowser.jsx';
import { facetsOpen } from '../stores/facets.js';
import { AdvancedSearchModal } from './AdvancedSearchModal.jsx';

// Every "create a folder here" dialog shares one heading, whether it is opened
// from the sidebar's + menu or from the tree's context menu.
const ADD_FOLDER_TITLE = 'Add Folder In Playlist';

/**
 * Explorer panel - contains header, column headers, and tree view
 */
export function Explorer(props) {
  // Context menu state
  const [contextMenu, setContextMenu] = createSignal(null);

  // Advanced search modal state
  const [advancedSearchOpen, setAdvancedSearchOpen] = createSignal(false);

  // Batch-rename modal state
  const [batchRenameOpen, setBatchRenameOpen] = createSignal(false);
  const [batchRenameCount, setBatchRenameCount] = createSignal(0);

  // Tree refetch function
  let refetchTree = null;

  // Get list title
  const getListTitle = () => props.listTitle || 'Library';

  // Handle refetch callback from TreeView
  const handleRefetch = (fn) => {
    refetchTree = fn;
    // Also expose refetch to parent for sidebar operations
    props.onRefetchReady?.(fn);
  };

  // Close context menu
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // Similar songs, groups and the map show each song's Main Library placement,
  // whatever list the sidebar has selected.
  const showsLibraryPlacements = () => isShowingSimilar() || isShowingCluster() || mapOpen();

  const deleteRemovesFromPlaylist = () =>
    currentListId() !== MAIN_LIBRARY_ID && !showsLibraryPlacements();

  // Show context menu. Remembers whether the rows are pulled out of folders the
  // user can't see (search and the analysis views), where positional actions
  // would land somewhere invisible. Right-clicking outside the selection selects
  // just that row, so the highlight shows what the menu acts on. (A search
  // folder has no item id; its menu acts on the hits inside it.)
  const handleContextMenu = (x, y, item) => {
    if (item.id !== null && !selectedItems().has(item.id)) selectItem(item.id);
    setContextMenu({
      x,
      y,
      item,
      rowsOutOfPlace: isSearching() || showsLibraryPlacements(),
      removesFromPlaylist: deleteRemovesFromPlaylist(),
    });
  };

  // Add folder inside another folder
  const handleAddFolderInside = async (parentListId) => {
    showRenameModal('New Folder', async (folderName) => {
      await addFolder(parentListId, 0, folderName);
      refetchTree?.();
      hideRenameModal();
    }, ADD_FOLDER_TITLE);
  };

  // Add folder after an item
  const handleAddFolderAfter = async (parentListId, position) => {
    showRenameModal('New Folder', async (folderName) => {
      await addFolder(parentListId, position, folderName);
      refetchTree?.();
      hideRenameModal();
    }, ADD_FOLDER_TITLE);
  };

  // Handle new folder from header dropdown
  const handleNewFolder = async () => {
    const selected = selectedItems();
    let position = 0;
    let parentListId = currentListId();

    if (selected.size === 1) {
      const itemId = Array.from(selected)[0];
      const item = await window.electronAPI?.getItem?.(itemId);
      if (item) {
        parentListId = item.parent_list_id;
        position = item.position + 1;
      }
    } else {
      const items = await getListItems(currentListId());
      position = items?.length || 0;
    }

    showRenameModal('New Folder', async (folderName) => {
      await addFolder(parentListId, position, folderName);
      refetchTree?.();
      hideRenameModal();
    }, ADD_FOLDER_TITLE);
  };

  // Move selected items into a new folder
  const handleMoveIntoNewFolder = async () => {
    const selected = Array.from(selectedItems());
    if (selected.length === 0) return;

    // Get first item to determine position
    const items = [];
    for (const id of selected) {
      const item = await window.electronAPI?.getItem?.(id);
      if (item) items.push(item);
    }

    if (items.length === 0) return;

    items.sort((a, b) => a.position - b.position);
    const firstItem = items[0];

    showRenameModal('New Folder', async (folderName) => {
      // Create new folder at first item's position
      const newFolderId = await addFolder(
        firstItem.parent_list_id,
        firstItem.position,
        folderName
      );

      // Move items into new folder (reverse order to maintain order)
      items.sort((a, b) => b.position - a.position);
      for (const item of items) {
        await window.electronAPI?.moveItem?.({
          itemId: item.id,
          newParentListId: newFolderId,
          newPosition: 0,
        });
      }

      clearSelection();
      refetchTree?.();
      hideRenameModal();
    }, 'Move Into New Folder');
  };

  // Reveal a song's audio file in Finder (opens the folder and selects the file)
  const handleShowInFinder = async (item) => {
    const song = await getSong(item.song_id);
    if (song) await window.electronAPI?.showInFinder?.(song.file_path);
  };

  // Copy a song's absolute audio file path to the clipboard
  const handleCopyPath = async (item) => {
    const song = await getSong(item.song_id);
    if (song) await window.electronAPI?.copyToClipboard?.(song.file_path);
  };

  // Copy the selection's audio files into a folder the user picks -- the same
  // thing Option-dragging out to the Finder does, minus the modifier. Acts on
  // the whole selection when the click landed inside it, on the one row when it
  // didn't, like every other context action here. A search folder copies just
  // its hits.
  const handleCopyFilesTo = async (item) => {
    const selected = selectedItems();
    let itemIds;
    if (item.id === null) itemIds = searchFolderSongs(item.list_id).map((hit) => hit.item_id);
    else itemIds = selected.has(item.id) ? Array.from(selected) : [item.id];

    const result = await copyItemsToFolder(itemIds);
    if (result.canceled) return;

    const failures = result.errors.length === 0
      ? ''
      : `<p>${result.errors.length} could not be copied:</p><p style="word-break: break-all; font-family: monospace; font-size: 12px;">${
          result.errors.map((e) => `${e.filePath}: ${e.error}`).join('<br>')
        }</p>`;
    showAlert(
      '<i class="bi bi-folder-symlink" style="margin-right: 8px;"></i>Copy Files To',
      `<p>Copied ${result.copied} of ${result.total} file${result.total === 1 ? '' : 's'} to</p>` +
        `<p style="word-break: break-all; font-family: monospace; font-size: 12px;">${result.targetDir}</p>` +
        failures
    );
  };

  // Show songs that sound like the right-clicked one.
  //
  // Right-clicking inside a multi-selection searches on the whole selection;
  // right-clicking outside it searches on just that song. Same rule the rest of
  // the tree's context actions follow, so the menu label and the result agree.
  const handleFindSimilar = async (item) => {
    const selected = selectedItems();
    const itemIds = selected.has(item.id) && selected.size > 1
      ? Array.from(selected)
      : [item.id];

    const seeds = [];
    for (const id of itemIds) {
      const row = await getItem(id);
      if (row && row.song_id !== null) seeds.push({ songId: row.song_id, title: row.song_title });
    }
    if (seeds.length === 0) return;

    await showSimilarTo(seeds);
  };

  // Rate from the context menu. Same entry point the star column clicks through,
  // so both widen to the selection under the same rule.
  const handleRate = async (itemId, rating) => {
    await rateFromRow(itemId, rating);
  };

  // Rename a folder
  const handleRename = (item) => {
    showRenameModal(item.list_title, async (newName) => {
      await renameFolder(item.list_id, newName);
      refetchTree?.();
      hideRenameModal();
    });
  };

  // Sort a folder's contents (folders above songs) by the given key
  const handleSort = async (listId, sortBy) => {
    await window.electronAPI?.sortFolderContents?.(listId, sortBy);
    refetchTree?.();
  };

  // Open the batch-rename modal for the selected folders
  const handleBatchRename = () => {
    const count = document.querySelectorAll('.tree-item-content.selected[data-is-folder="true"]').length;
    if (count === 0) return;
    setBatchRenameCount(count);
    setBatchRenameOpen(true);
  };

  // Apply a find/replace rename across every selected folder
  const applyBatchRename = async ({ pattern, mode, replacement }) => {
    setBatchRenameOpen(false);
    if (!pattern) return;

    let regex = null;
    if (mode === 'regex') {
      try {
        regex = new RegExp(pattern, 'g');
      } catch (err) {
        showAlert(
          '<i class="bi bi-exclamation-diamond" style="margin-right: 8px;"></i>Invalid Regex',
          `<p>${err.message}</p>`
        );
        return;
      }
    }

    for (const id of Array.from(selectedItems())) {
      const item = await window.electronAPI?.getItem?.(id);
      if (!item || item.list_id === null) continue; // folders only
      const oldTitle = item.list_title;
      const newTitle = mode === 'regex'
        ? oldTitle.replace(regex, replacement)
        : oldTitle.split(pattern).join(replacement);
      if (newTitle !== oldTitle) {
        await renameFolder(item.list_id, newTitle);
      }
    }
    refetchTree?.();
  };

  // Flatten a folder: move all subfolder contents into it and delete the subfolders
  const handleFlatten = async (listId) => {
    await window.electronAPI?.flattenFolder?.(listId);
    refetchTree?.();
  };

  // A search folder plays just its hits, the same as double-clicking it.
  const handlePlayFolder = (listId) => {
    if (isSearching()) props.onPlaySearchFolder(listId);
    else props.onPlayFolder(listId);
  };

  // Delete item(s) with confirmation dialog
  // Used by both context menu and keyboard shortcut for consistent behavior
  //
  // In the Main Library this is the master delete: the song leaves every
  // playlist and its file goes to the Trash. In a playlist it only removes the
  // placement -- the song stays in the library and the file is untouched.
  const handleDeleteWithConfirm = async (itemIds) => {
    if (itemIds.length === 0) return;

    const inPlaylist = deleteRemovesFromPlaylist();

    // Get item descriptions for confirm dialog
    let name = null;
    if (itemIds.length === 1) {
      const item = await window.electronAPI?.getItem?.(itemIds[0]);
      if (item) {
        const raw = item.list_id !== null ? item.list_title : item.song_title;
        name = raw.length > 50 ? raw.substring(0, 50) + '...' : raw;
      }
    }

    const plural = `${itemIds.length} item${itemIds.length > 1 ? 's' : ''}`;
    const subject = name ? `"${name}"` : plural;

    const title = inPlaylist
      ? '<i class="bi bi-dash-circle" style="margin-right: 8px;"></i>Remove from Playlist'
      : '<i class="bi bi-trash" style="margin-right: 8px;"></i>Confirm Delete';
    const message = inPlaylist
      ? `Remove ${subject} from "${getListTitle()}"? The songs stay in your library.`
      : `Move ${subject} to the Trash? This is permanent, and also removes the songs from any playlists they're in.`;

    showConfirmModal(title, message, async () => {
      if (inPlaylist) {
        await removeItemsFromList(itemIds);
      } else {
        for (const id of itemIds) {
          await deleteItemWithFiles(id);
        }
      }
      clearSelection();
      refetchTree?.();
      hideConfirmModal();
    });
  };

  // Delete an item (from context menu)
  const handleDelete = (item) => {
    handleDeleteWithConfirm([item.id]);
  };

  // Handle delete selected (from keyboard)
  const handleDeleteSelected = () => {
    const selected = Array.from(selectedItems());
    handleDeleteWithConfirm(selected);
  };

  // Get visible item IDs for keyboard navigation
  const getVisibleItemIds = () => {
    const ids = [];
    const tree = document.getElementById('explorerTree');
    if (!tree) return ids;

    const elements = tree.querySelectorAll('.tree-item-content');
    elements.forEach((el) => {
      let parent = el.closest('.tree-item').parentElement;
      let visible = true;

      while (parent && parent.id !== 'explorerTree') {
        if (
          parent.classList.contains('tree-item-children') &&
          !parent.classList.contains('expanded')
        ) {
          visible = false;
          break;
        }
        parent = parent.parentElement;
      }

      // Search results render virtual folder rows that have no placement id.
      if (visible && el.dataset.itemId) {
        ids.push(parseInt(el.dataset.itemId));
      }
    });

    return ids;
  };

  // Scroll selected item into view
  const scrollSelectedIntoView = () => {
    const selected = selectedItems();
    if (selected.size === 0) return;

    const firstId = Array.from(selected)[0];
    const el = document.querySelector(
      `.tree-item-content[data-item-id="${firstId}"]`
    );
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  // Initialize keyboard navigation
  useKeyboard({
    getVisibleItemIds,
    onDelete: handleDeleteSelected,
    onPlayFolder: props.onPlayFolder,
    onPlaySong: props.onPlaySong,
    onRenameFolder: handleRename,
    onSeek: props.onSeek,
    scrollSelectedIntoView,
  });

  return (
    <main class="main-panel">
      <ExplorerHeader
        title={getListTitle()}
        advancedSearchOpen={advancedSearchOpen()}
        onAdvancedSearch={() => setAdvancedSearchOpen(true)}
      />

      {/* The map, the facet browser and the groups list aren't lists of songs --
          column headings over them would be labelling nothing. */}
      <Show when={!mapOpen() && !facetsOpen() && !groupsOpen()}>
        <ColumnHeaders />
      </Show>

      {/* Seven things can fill the explorer, and exactly one of them does. */}
      <Switch fallback={
        <TreeView
          onRefetch={handleRefetch}
          listTitle={getListTitle()}
          onPlayFolder={props.onPlayFolder}
          onPlaySong={props.onPlaySong}
          onContextMenu={handleContextMenu}
        />
      }>
        <Match when={mapOpen()}>
          <MusicMapView onPlaySong={props.onPlaySong} onContextMenu={handleContextMenu} />
        </Match>
        <Match when={facetsOpen()}>
          <FacetBrowser />
        </Match>
        <Match when={isShowingSimilar()}>
          <SimilarSongsView onPlaySong={props.onPlaySong} onContextMenu={handleContextMenu} />
        </Match>
        <Match when={isShowingCluster()}>
          <ClusterSongsView onPlaySong={props.onPlaySong} onContextMenu={handleContextMenu} />
        </Match>
        <Match when={groupsOpen()}>
          <GroupsView />
        </Match>
        <Match when={isSearching()}>
          <SearchResultsView
            onPlaySong={props.onPlaySong}
            onPlaySearchFolder={props.onPlaySearchFolder}
            onContextMenu={handleContextMenu}
          />
        </Match>
      </Switch>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <ContextMenu
          x={contextMenu().x}
          y={contextMenu().y}
          item={contextMenu().item}
          rowsOutOfPlace={contextMenu().rowsOutOfPlace}
          removesFromPlaylist={contextMenu().removesFromPlaylist}
          onClose={closeContextMenu}
          onAddFolderInside={handleAddFolderInside}
          onAddFolderAfter={handleAddFolderAfter}
          onMoveIntoNewFolder={handleMoveIntoNewFolder}
          onPlayFolder={handlePlayFolder}
          onCollapseAll={props.onCollapseAll}
          onExpandAll={props.onExpandAll}
          onSort={handleSort}
          onFlatten={handleFlatten}
          onRename={handleRename}
          onBatchRename={handleBatchRename}
          onFindSimilar={handleFindSimilar}
          onRate={handleRate}
          onShowInFinder={handleShowInFinder}
          onCopyFilesTo={handleCopyFilesTo}
          onCopyPath={handleCopyPath}
          onDelete={handleDelete}
        />
      </Show>

      <BatchRenameModal
        open={batchRenameOpen()}
        folderCount={batchRenameCount()}
        onApply={applyBatchRename}
        onCancel={() => setBatchRenameOpen(false)}
      />

      <AdvancedSearchModal
        open={advancedSearchOpen()}
        onClose={() => setAdvancedSearchOpen(false)}
        onSearch={(query) => runSearch(query)}
      />
    </main>
  );
}
