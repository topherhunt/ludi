import { For, Show, createResource, createMemo, onMount } from 'solid-js';
import { currentListId, selectedItems, clearSelection } from '../stores/navigation.js';
import { setDragState, clearDragState, isDropIndicatorVisible, dropIndicatorPosition } from '../stores/dragdrop.js';
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
  const [items, { refetch }] = createResource(
    currentListId,
    async (listId) => {
      return await getListItems(listId);
    }
  );

  // Expose refetch to parent for refreshing
  onMount(() => {
    props.onRefetch?.(refetch);
  });

  // Drag-drop state
  let draggedItems = [];
  let isInternalDrag = false;

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

  // Handle drag over
  const handleDragOver = (e, targetItemId) => {
    // If this is an external file drop, don't handle it here
    if (e.dataTransfer.types.includes('Files')) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Get the container's position for coordinate conversion
    const containerRect = containerRef?.getBoundingClientRect();
    if (!containerRect) return;

    // Find the closest tree-item-content
    const targetContent = e.target.closest('.tree-item-content');
    if (!targetContent) return;

    // Don't allow dropping on itself or any of the dragged items
    if (draggedItems.includes(targetItemId)) {
      clearDragState();
      document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
        el.classList.remove('drop-into');
      });
      return;
    }

    const rect = targetContent.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const heightPercent = relativeY / rect.height;

    // Check if target is a folder and we're in the middle 50%
    const isFolder = targetContent.dataset.isFolder === 'true';
    const inMiddle50 = heightPercent >= 0.25 && heightPercent <= 0.75;

    // Remove drop-into class from all items
    document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
      el.classList.remove('drop-into');
    });

    if (isFolder && inMiddle50) {
      // Drop INTO the folder - show border
      targetContent.classList.add('drop-into');
      setDragState({ isDragging: true, showDropIndicator: false });
    } else {
      // Drop BEFORE/AFTER - show indicator line
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      const relativeTop =
        (insertBefore ? rect.top : rect.bottom) -
        containerRect.top +
        containerRef.scrollTop;

      setDragState({
        isDragging: true,
        showDropIndicator: true,
        dropIndicatorTop: relativeTop,
        dropIndicatorLeft: 0,
        dropIndicatorWidth: containerRect.width,
      });
    }
  };

  // Handle drop
  const handleDrop = async (e, targetItemId) => {
    const itemsToMove = [...draggedItems];

    // If this is an external file drop, don't handle it here
    if (e.dataTransfer.types.includes('Files')) {
      return;
    }

    e.stopPropagation();
    clearDragState();

    if (itemsToMove.length === 0) {
      document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
        el.classList.remove('drop-into');
      });
      return;
    }

    const targetContent = e.target.closest('.tree-item-content');
    if (!targetContent || itemsToMove.includes(targetItemId)) {
      document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
        el.classList.remove('drop-into');
      });
      return;
    }

    const isDropIntoFolder = targetContent.classList.contains('drop-into');
    document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
      el.classList.remove('drop-into');
    });

    try {
      const targetItemData = await getItemById(targetItemId);
      if (!targetItemData) return;

      // Get all items to move with their data
      const itemsData = [];
      for (const itemId of itemsToMove) {
        const item = await getItemById(itemId);
        if (item) {
          itemsData.push(item);
        }
      }

      // Sort by position (descending for proper move order)
      itemsData.sort((a, b) => b.position - a.position);

      if (isDropIntoFolder) {
        // Drop INTO folder - move all items to position 0 inside the folder
        const targetFolderId = parseInt(targetContent.dataset.folderId);
        for (const item of itemsData) {
          await moveItem(item.id, targetFolderId, 0);
        }
      } else {
        // Drop BEFORE/AFTER - calculate position
        const rect = targetContent.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        let newPosition = insertBefore ? targetItemData.position : targetItemData.position + 1;

        for (const item of itemsData) {
          await moveItem(item.id, targetItemData.parent_list_id, newPosition);
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

    // Reset opacity on all items
    document.querySelectorAll('.tree-item-content').forEach((el) => {
      el.style.opacity = '';
    });
  };

  // Handle external file drops on container
  const handleContainerDragOver = (e) => {
    if (!e.dataTransfer.types.includes('Files') || isInternalDrag) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleContainerDrop = async (e) => {
    if (!e.dataTransfer.types.includes('Files') || isInternalDrag) {
      return;
    }
    e.preventDefault();

    const files = Array.from(e.dataTransfer.files);
    const audioPaths = files
      .filter((f) =>
        f.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|wma|aiff)$/i)
      )
      .map((f) => f.path);

    if (audioPaths.length > 0) {
      await addSongsToList(currentListId(), audioPaths);
      refetch();
    }
  };

  return (
    <div
      class="explorer-container"
      id="explorerContainer"
      ref={containerRef}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
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
