import { For, Show, createResource, createMemo, onMount } from 'solid-js';
import { currentListId, selectedItems, clearSelection } from '../stores/navigation.js';
import { setDragState, clearDragState, isDropIndicatorVisible, dropIndicatorPosition } from '../stores/dragdrop.js';
import { showAlertModal } from '../stores/modals.js';
import { TreeItem } from './TreeItem.jsx';
import { DropIndicator } from './DropIndicator.jsx';
import { getListItems, getItemById, moveItem, addSongsToList } from '../utils/api.js';

/**
 * Tree view container that renders the full tree structure
 */
export function TreeView(props) {
  let explorerTreeRef;
  let containerRef;

  // Fetch items for current list
  const [items, { refetch: rawRefetch }] = createResource(
    currentListId,
    async (listId) => {
      return await getListItems(listId);
    }
  );

  // Wrap refetch to preserve scroll position
  const refetch = async () => {
    const scrollTop = containerRef?.scrollTop ?? 0;
    await rawRefetch();
    // Restore scroll position after DOM updates
    requestAnimationFrame(() => {
      if (containerRef) {
        containerRef.scrollTop = scrollTop;
      }
    });
  };

  // Expose refetch to parent for refreshing
  onMount(() => {
    props.onRefetch?.(refetch);
  });

  // Drag-drop state
  let draggedItems = [];
  let isInternalDrag = false;

  // External file drop target tracking
  let externalDropTarget = null; // { listId, position, intoFolder: boolean }

  // Track current drop state to avoid unnecessary updates that cause flickering
  let currentDropState = null; // { targetItemId, mode: 'above' | 'into' | 'below' }

  // Get all visible item IDs in order (for range selection)
  const getVisibleItemIds = () => {
    const ids = [];
    if (!explorerTreeRef) return ids;

    const contentElements = explorerTreeRef.querySelectorAll('.tree-item-content');
    contentElements.forEach((element) => {
      // Only include items that are visible (not in collapsed folders)
      const treeItem = element.closest('.tree-item');
      let parent = treeItem.parentElement;
      let isVisible = true;

      while (parent && parent !== explorerTreeRef) {
        if (
          parent.classList.contains('tree-item-children') &&
          !parent.classList.contains('expanded')
        ) {
          isVisible = false;
          break;
        }
        parent = parent.parentElement;
      }

      if (isVisible) {
        ids.push(parseInt(element.dataset.itemId));
      }
    });

    return ids;
  };

  // Handle drag start
  const handleDragStart = (e, itemId) => {
    isInternalDrag = true;

    // If the dragged item is selected, drag all selected items
    // Otherwise, just drag this one item
    if (selectedItems().has(itemId)) {
      draggedItems = Array.from(selectedItems());
    } else {
      draggedItems = [itemId];
    }

    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';

    // Apply opacity to all selected items being dragged
    if (draggedItems.length > 1) {
      draggedItems.forEach((id) => {
        const element = document.querySelector(`[data-item-id="${id}"]`);
        if (element && element !== e.target) {
          element.style.opacity = '0.5';
        }
      });
    }

    setDragState({ isDragging: true, draggedItemId: itemId });
  };

  // Handle drag over - works for both internal and external drags
  const handleDragOver = async (e, targetItemId) => {
    const isExternalFile = e.dataTransfer.types.includes('Files');

    e.preventDefault();
    e.dataTransfer.dropEffect = isExternalFile ? 'copy' : 'move';

    // Get the container's position for coordinate conversion
    const containerRect = containerRef?.getBoundingClientRect();
    if (!containerRect) return;

    // Find the closest tree-item-content
    const targetContent = e.target.closest('.tree-item-content');
    if (!targetContent) return;

    // For internal drags, don't allow dropping on dragged items
    if (!isExternalFile && draggedItems.includes(targetItemId)) {
      if (currentDropState !== null) {
        clearDragState();
        externalDropTarget = null;
        currentDropState = null;
        document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
          el.classList.remove('drop-into');
        });
      }
      return;
    }

    const rect = targetContent.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const heightPercent = relativeY / rect.height;

    // Check if target is a folder
    const isFolder = targetContent.dataset.isFolder === 'true';
    const folderId = targetContent.dataset.folderId ? parseInt(targetContent.dataset.folderId) : null;

    // For folders: top 25% = above, middle 50% = into, bottom 25% = below
    // For songs: top 50% = above, bottom 50% = below
    const inMiddle50 = isFolder && heightPercent >= 0.25 && heightPercent <= 0.75;
    const insertBefore = isFolder ? heightPercent < 0.25 : heightPercent < 0.5;

    // Determine the drop mode
    let dropMode;
    if (isFolder && inMiddle50) {
      dropMode = 'into';
    } else if (insertBefore) {
      dropMode = 'above';
    } else {
      dropMode = 'below';
    }

    // Check if state has changed - skip update if same to prevent flickering
    if (currentDropState?.targetItemId === targetItemId && currentDropState?.mode === dropMode) {
      return;
    }

    // Update current drop state
    currentDropState = { targetItemId, mode: dropMode };

    // Remove drop-into class from all items
    document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
      el.classList.remove('drop-into');
    });

    // Get target item data for position calculation
    const targetItem = await getItemById(targetItemId);

    if (dropMode === 'into') {
      // Drop INTO the folder - show border
      targetContent.classList.add('drop-into');
      setDragState({ isDragging: true, showDropIndicator: false });

      // Track external drop target (position undefined = append to end)
      if (isExternalFile) {
        externalDropTarget = { listId: folderId, position: undefined, intoFolder: true };
      }
    } else {
      // Drop BEFORE/AFTER - show indicator line
      const relativeTop =
        (dropMode === 'above' ? rect.top : rect.bottom) -
        containerRect.top +
        containerRef.scrollTop;

      setDragState({
        isDragging: true,
        showDropIndicator: true,
        dropIndicatorTop: relativeTop,
        dropIndicatorLeft: 0,
        dropIndicatorWidth: containerRect.width,
      });

      // Track external drop target
      if (isExternalFile && targetItem) {
        const position = dropMode === 'above' ? targetItem.position : targetItem.position + 1;
        externalDropTarget = { listId: targetItem.parent_list_id, position, intoFolder: false };
      }
    }
  };

  // Handle drop
  const handleDrop = async (e, targetItemId) => {
    const isExternalFile = e.dataTransfer.types.includes('Files');
    const itemsToMove = [...draggedItems];

    e.stopPropagation();

    // Capture drop-into state BEFORE removing the class
    const targetContent = e.target.closest('.tree-item-content');
    const isDropIntoFolder = targetContent?.classList.contains('drop-into');

    // Clean up UI state
    document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
      el.classList.remove('drop-into');
    });
    clearDragState();
    currentDropState = null;

    // Handle external file drop
    if (isExternalFile) {
      e.preventDefault();

      const files = Array.from(e.dataTransfer.files);
      const audioPaths = files
        .filter((f) => f.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|wma|aiff)$/i))
        .map((f) => f.path);

      if (audioPaths.length > 0 && externalDropTarget) {
        const result = await addSongsToList(externalDropTarget.listId, audioPaths, externalDropTarget.position);
        refetch();

        // Show alert for skipped songs
        const skipped = result?.errors?.filter(e => e.error?.includes('already exists')) || [];
        if (skipped.length > 0) {
          const fileListHtml = skipped.map(e => `<li>${e.file}</li>`).join('');
          showAlertModal(`
            <p>Skipped ${skipped.length} song(s) already in library:</p>
            <div class="skipped-files-list"><ul>${fileListHtml}</ul></div>
          `);
        }
      }
      externalDropTarget = null;
      return;
    }

    // Handle internal drag
    if (itemsToMove.length === 0) {
      return;
    }

    if (!targetContent || itemsToMove.includes(targetItemId)) {
      return;
    }

    try {
      const targetItemData = await getItemById(targetItemId);
      if (!targetItemData) return;

      // Get all items to move with their data
      const allItemsData = [];
      for (const itemId of itemsToMove) {
        const item = await getItemById(itemId);
        if (item) {
          allItemsData.push(item);
        }
      }

      // Build a set of list_ids for folders in the selection
      // These are parent containers that are being moved
      const folderListIdsBeingMoved = new Set();
      for (const item of allItemsData) {
        if (item.list_id !== null) {
          folderListIdsBeingMoved.add(item.list_id);
        }
      }

      // Filter out items whose parent folder is also being moved
      // These items will travel with their parent automatically
      const itemsData = allItemsData.filter(item => {
        return !folderListIdsBeingMoved.has(item.parent_list_id);
      });

      // Sort by position (descending for proper move order)
      itemsData.sort((a, b) => b.position - a.position);

      if (isDropIntoFolder) {
        // Drop INTO folder - move all items to end of folder
        const targetFolderId = parseInt(targetContent.dataset.folderId);
        const folderItems = await getListItems(targetFolderId);
        let endPosition = folderItems.length;
        for (const item of itemsData) {
          await moveItem(item.id, targetFolderId, endPosition);
          endPosition++;
        }
      } else {
        // Drop BEFORE/AFTER - calculate position based on folder rules
        const rect = targetContent.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const heightPercent = relativeY / rect.height;
        const isFolder = targetContent.dataset.isFolder === 'true';
        const insertBefore = isFolder ? heightPercent < 0.25 : heightPercent < 0.5;
        let newPosition = insertBefore ? targetItemData.position : targetItemData.position + 1;

        for (const item of itemsData) {
          let adjustedPosition = newPosition;
          // When moving DOWN within the same list, removing the item first shifts
          // all items below it up by 1, so we need to subtract 1 from target position
          if (item.parent_list_id === targetItemData.parent_list_id &&
              item.position < newPosition) {
            adjustedPosition = newPosition - 1;
          }
          await moveItem(item.id, targetItemData.parent_list_id, adjustedPosition);
        }
      }

      // Refresh the tree
      refetch();
    } catch (err) {
      console.error('Error moving items:', err);
    }
  };

  // Handle drag end
  const handleDragEnd = (e) => {
    isInternalDrag = false;
    draggedItems = [];
    clearDragState();
    currentDropState = null;

    // Reset opacity on all items
    document.querySelectorAll('.tree-item-content').forEach((el) => {
      el.style.opacity = '';
    });
  };

  // Handle external file drops on container (empty space)
  const handleContainerDragOver = async (e) => {
    if (!e.dataTransfer.types.includes('Files') || isInternalDrag) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Check if we're over an item (handled by handleDragOver) or empty space
    const targetContent = e.target.closest('.tree-item-content');
    if (targetContent) {
      // Let handleDragOver on the item handle this
      return;
    }

    // Clear drop-into highlights
    document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
      el.classList.remove('drop-into');
    });

    // Show drop indicator at end of list
    const containerRect = containerRef?.getBoundingClientRect();
    if (!containerRect) return;

    // Find the last visible item to position indicator after it
    const allItems = explorerTreeRef?.querySelectorAll('.tree-item-content');
    const currentItems = await items();
    const itemCount = currentItems?.length || 0;

    if (allItems && allItems.length > 0) {
      const lastItem = allItems[allItems.length - 1];
      const lastRect = lastItem.getBoundingClientRect();
      const relativeTop = lastRect.bottom - containerRect.top + containerRef.scrollTop;

      setDragState({
        isDragging: true,
        showDropIndicator: true,
        dropIndicatorTop: relativeTop,
        dropIndicatorLeft: 0,
        dropIndicatorWidth: containerRect.width,
      });
    } else {
      // Empty list - show at top
      setDragState({
        isDragging: true,
        showDropIndicator: true,
        dropIndicatorTop: 0,
        dropIndicatorLeft: 0,
        dropIndicatorWidth: containerRect.width,
      });
    }

    // Set drop target to end of current list
    externalDropTarget = { listId: currentListId(), position: itemCount, intoFolder: false };
  };

  const handleContainerDrop = async (e) => {
    if (!e.dataTransfer.types.includes('Files') || isInternalDrag) {
      return;
    }
    e.preventDefault();

    clearDragState();

    const files = Array.from(e.dataTransfer.files);
    const audioPaths = files
      .filter((f) =>
        f.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|wma|aiff)$/i)
      )
      .map((f) => f.path);

    if (audioPaths.length > 0) {
      const dropTarget = externalDropTarget || { listId: currentListId(), position: undefined };
      const result = await addSongsToList(dropTarget.listId, audioPaths, dropTarget.position);
      refetch();

      // Show alert for skipped songs
      const skipped = result?.errors?.filter(e => e.error?.includes('already exists')) || [];
      if (skipped.length > 0) {
        const fileListHtml = skipped.map(e => `<li>${e.file}</li>`).join('');
        showAlertModal(`
          <p>Skipped ${skipped.length} song(s) already in library:</p>
          <div class="skipped-files-list"><ul>${fileListHtml}</ul></div>
        `);
      }
    }
    externalDropTarget = null;
  };

  // Handle drag leave on container
  const handleContainerDragLeave = (e) => {
    // Only clear if actually leaving the container
    if (!containerRef?.contains(e.relatedTarget)) {
      clearDragState();
      externalDropTarget = null;
      currentDropState = null;
      document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
        el.classList.remove('drop-into');
      });
    }
  };

  return (
    <div
      class="explorer-container"
      id="explorerContainer"
      ref={containerRef}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      onDragLeave={handleContainerDragLeave}
    >
      <ul
        class="explorer-tree"
        id="explorerTree"
        ref={explorerTreeRef}
        data-list-id={currentListId()}
      >
        <Show
          when={!items.loading}
          fallback={<li class="loading">Loading...</li>}
        >
          <For each={items() || []}>
            {(item) => (
              <TreeItem
                item={item}
                depth={0}
                getVisibleItemIds={getVisibleItemIds}
                onPlayFolder={props.onPlayFolder}
                onPlaySong={props.onPlaySong}
                onContextMenu={props.onContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            )}
          </For>
        </Show>
      </ul>
      <DropIndicator />
    </div>
  );
}
