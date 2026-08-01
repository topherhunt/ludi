import { onMount, onCleanup } from 'solid-js';
import {
  selectedItems,
  lastSelectedItemId,
  clearSelection,
  selectOnly,
  selectAll,
  setLastSelectedItemId,
} from '../stores/navigation.js';
import { isAnyModalOpen, closeAllModals } from '../stores/modals.js';
import { getItemById } from '../utils/api.js';

/**
 * Keyboard navigation hook for the explorer tree
 *
 * @param {Object} options
 * @param {Function} options.getVisibleItemIds - Returns array of visible item IDs
 * @param {Function} options.onDelete - Called when backspace pressed with selection
 * @param {Function} options.onPlayFolder - Called when Space pressed on a folder
 * @param {Function} options.onPlaySong - Called when Enter/Space pressed on a song
 * @param {Function} options.onRenameFolder - Called when Enter pressed on a single selected folder
 * @param {Function} options.onSeek - Called when Left/Right pressed with no folder selected
 * @param {Function} options.scrollSelectedIntoView - Called after arrow navigation
 */
export function useKeyboard(options) {
  const {
    getVisibleItemIds,
    onDelete,
    onPlayFolder,
    onPlaySong,
    onRenameFolder,
    onSeek,
    scrollSelectedIntoView,
  } = options;

  const handleKeyDown = async (e) => {
    // Only handle keyboard shortcuts when not in an input field. The tag editor
    // captures its own arrow/Backspace keys (pill navigation + removal) while the
    // focus sits on its container div (not an <input>), so guard against it too --
    // otherwise those keys leak to folder expand/collapse and song deletion.
    if (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.closest?.('.tag-editor')
    ) {
      return;
    }

    // Check if any modal is open (except for Escape key which can close modals)
    if (isAnyModalOpen() && e.key !== 'Escape') {
      return;
    }

    // Escape key handling
    if (e.key === 'Escape') {
      if (isAnyModalOpen()) {
        closeAllModals();
        return;
      }

      // Close context menu if open
      const contextMenu = document.querySelector('.context-menu');
      if (contextMenu) {
        contextMenu.remove();
        return;
      }

      // Clear selection if items are selected
      if (selectedItems().size > 0) {
        clearSelection();
      }
      return;
    }

    // Cmd+A to select all
    if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const visibleItems = getVisibleItemIds?.() || [];
      selectAll(visibleItems);
      return;
    }

    // Backspace to delete
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (selectedItems().size === 0) return;
      await onDelete?.();
      return;
    }

    // Arrow key navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();

      const visibleItems = getVisibleItemIds?.() || [];
      if (visibleItems.length === 0) return;

      const selected = selectedItems();
      if (selected.size === 0) {
        // Nothing selected, select first or last item
        const targetId =
          e.key === 'ArrowDown'
            ? visibleItems[0]
            : visibleItems[visibleItems.length - 1];
        selectOnly(targetId);
        setLastSelectedItemId(targetId);
      } else {
        // Find the first (topmost) selected item
        let firstSelectedIndex = -1;
        for (let i = 0; i < visibleItems.length; i++) {
          if (selected.has(visibleItems[i])) {
            firstSelectedIndex = i;
            break;
          }
        }

        if (firstSelectedIndex !== -1) {
          const newIndex =
            e.key === 'ArrowDown'
              ? Math.min(firstSelectedIndex + 1, visibleItems.length - 1)
              : Math.max(firstSelectedIndex - 1, 0);

          selectOnly(visibleItems[newIndex]);
          setLastSelectedItemId(visibleItems[newIndex]);
        }
      }

      scrollSelectedIntoView?.();
      return;
    }

    // Left/Right arrows for folder expand/collapse or seeking
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();

      // Check if any selected items are folders
      let hasSelectedFolder = false;
      const selected = selectedItems();

      for (const itemId of selected) {
        const element = document.querySelector(
          `.tree-item-content[data-item-id="${itemId}"]`
        );
        if (element && element.dataset.isFolder === 'true') {
          hasSelectedFolder = true;
          break;
        }
      }

      if (hasSelectedFolder) {
        // Collapse (left) or expand (right) selected folders. Click the chevron so
        // this uses the exact same smooth, no-refetch code path as a manual chevron
        // click -- the old refetch path reloaded the whole tree, flashing "Loading..."
        // and jumping the scroll position.
        for (const itemId of selected) {
          const element = document.querySelector(
            `.tree-item-content[data-item-id="${itemId}"]`
          );
          if (element && element.dataset.isFolder === 'true') {
            const chevron = element.querySelector('.tree-item-icon.chevron');
            const isExpanded = chevron?.classList.contains('expanded');
            const shouldExpand = e.key === 'ArrowRight';

            if (shouldExpand !== isExpanded) {
              chevron?.click();
            }
          }
        }
      } else {
        // No folder selected, seek in current song
        const seekAmount = e.key === 'ArrowRight' ? 5 : -5;
        onSeek?.(seekAmount);
      }
      return;
    }

    // Enter renames a single selected folder (same as right-click -> Rename).
    // Space plays a folder; Enter/Space both play a song.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();

      const selected = selectedItems();
      if (selected.size === 0) return;

      const firstSelectedId = Array.from(selected)[0];
      const element = document.querySelector(
        `.tree-item-content[data-item-id="${firstSelectedId}"]`
      );
      if (!element) return;

      if (element.dataset.isFolder === 'true') {
        if (e.key === 'Enter' && selected.size === 1) {
          const item = await getItemById(firstSelectedId);
          if (item) onRenameFolder?.(item);
        } else {
          const folderId = parseInt(element.dataset.folderId);
          onPlayFolder?.(folderId);
        }
      } else {
        const songId = parseInt(element.dataset.songId);
        const item = await getItemById(firstSelectedId);
        if (item) {
          onPlaySong?.(songId, item.parent_list_id);
        }
      }
      return;
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });
}
