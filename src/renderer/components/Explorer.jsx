import { createSignal, Show } from 'solid-js';
import { currentListId } from '../stores/navigation.js';
import { showRenameModal, hideRenameModal, showConfirmModal, hideConfirmModal } from '../stores/modals.js';
import { ExplorerHeader } from './ExplorerHeader.jsx';
import { ColumnHeaders } from './ColumnHeaders.jsx';
import { TreeView } from './TreeView.jsx';
import { ContextMenu } from './ContextMenu.jsx';
import { RenameModal, ConfirmModal } from './Modal.jsx';
import { useKeyboard } from '../hooks/useKeyboard.js';
import {
  addFolder,
  deleteItemWithFiles,
  renameFolder,
  getListItems,
  updateFolderExpanded,
} from '../utils/api.js';
import { selectedItems, clearSelection } from '../stores/navigation.js';

/**
 * Explorer panel - contains header, column headers, and tree view
 */
export function Explorer(props) {
  // Context menu state
  const [contextMenu, setContextMenu] = createSignal(null);

  // Tree refetch function
  let refetchTree = null;

  // Get list title
  const getListTitle = () => {
    if (currentListId() === 0) return 'Main Library';
    return props.listTitle || 'Library';
  };

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

  // Show context menu
  const handleContextMenu = (x, y, item) => {
    setContextMenu({ x, y, item });
  };

  // Add folder inside another folder
  const handleAddFolderInside = async (parentListId) => {
    showRenameModal('New Folder', async (folderName) => {
      await addFolder(parentListId, 0, folderName);
      refetchTree?.();
      hideRenameModal();
    });
  };

  // Add folder after an item
  const handleAddFolderAfter = async (parentListId, position) => {
    showRenameModal('New Folder', async (folderName) => {
      await addFolder(parentListId, position, folderName);
      refetchTree?.();
      hideRenameModal();
    });
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
    });
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
    });
  };

  // Rename a folder
  const handleRename = (item) => {
    showRenameModal(item.list_title, async (newName) => {
      await renameFolder(item.list_id, newName);
      refetchTree?.();
      hideRenameModal();
    });
  };

  // Delete item(s) with confirmation dialog
  // Used by both context menu and keyboard shortcut for consistent behavior
  const handleDeleteWithConfirm = async (itemIds) => {
    if (itemIds.length === 0) return;

    // Get item descriptions for confirm dialog
    let message = `Move ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} to the Trash?`;

    if (itemIds.length === 1) {
      const item = await window.electronAPI?.getItem?.(itemIds[0]);
      if (item) {
        const name = item.list_id !== null ? item.list_title : item.song_title;
        const truncated = name.length > 50 ? name.substring(0, 50) + '...' : name;
        message = `Move "${truncated}" to the Trash?`;
      }
    }

    showConfirmModal('<i class="bi bi-trash" style="margin-right: 8px;"></i>Confirm Delete', message, async () => {
      for (const id of itemIds) {
        await deleteItemWithFiles(id);
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

  // Collapse all folders
  const handleCollapseAll = async () => {
    const folders = document.querySelectorAll('[data-folder-id]');
    for (const folder of folders) {
      const folderId = parseInt(folder.dataset.folderId);
      await updateFolderExpanded(folderId, false);
    }
    refetchTree?.();
  };

  // Expand all folders
  const handleExpandAll = async () => {
    const folders = document.querySelectorAll('[data-folder-id]');
    for (const folder of folders) {
      const folderId = parseInt(folder.dataset.folderId);
      await updateFolderExpanded(folderId, true);
    }
    refetchTree?.();
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

      if (visible) {
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

  // Toggle folder expansion
  const handleToggleFolder = async (folderId) => {
    const el = document.querySelector(`[data-folder-id="${folderId}"]`);
    if (!el) return;

    const icon = el.querySelector('.tree-item-icon.chevron');
    const isExpanded = icon?.classList.contains('expanded');
    await updateFolderExpanded(folderId, !isExpanded);
    refetchTree?.();
  };

  // Initialize keyboard navigation
  useKeyboard({
    getVisibleItemIds,
    onDelete: handleDeleteSelected,
    onPlayFolder: props.onPlayFolder,
    onPlaySong: props.onPlaySong,
    onToggleFolder: handleToggleFolder,
    onSeek: props.onSeek,
    scrollSelectedIntoView,
  });

  return (
    <main class="main-panel">
      <ExplorerHeader
        title={getListTitle()}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
      />

      <ColumnHeaders />

      <TreeView
        onRefetch={handleRefetch}
        onPlayFolder={props.onPlayFolder}
        onPlaySong={props.onPlaySong}
        onContextMenu={handleContextMenu}
      />

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <ContextMenu
          x={contextMenu().x}
          y={contextMenu().y}
          item={contextMenu().item}
          onClose={closeContextMenu}
          onAddFolderInside={handleAddFolderInside}
          onAddFolderAfter={handleAddFolderAfter}
          onMoveIntoNewFolder={handleMoveIntoNewFolder}
          onPlayFolder={props.onPlayFolder}
          onCollapseAll={handleCollapseAll}
          onExpandAll={handleExpandAll}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      </Show>
    </main>
  );
}
