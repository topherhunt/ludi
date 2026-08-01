import { For, Show, createResource, createMemo, onMount } from 'solid-js';
import { currentListId, selectedItems, clearSelection, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import { libraryVersion } from '../stores/tags.js';
import {
  setDragState,
  clearDragState,
  hideDropIndicator,
  startInternalDrag,
  dragSource,
  isDropIndicatorVisible,
  dropIndicatorPosition,
} from '../stores/dragdrop.js';
import { copyIntoPlaylist } from '../stores/playlistCopy.js';
import { showImportSummary } from '../utils/importSummary.js';
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
  // Depend on libraryVersion too, so tag/metadata edits (from the edit panel)
  // refresh the tree reactively.
  const [items, { refetch: rawRefetch }] = createResource(
    () => [currentListId(), libraryVersion()],
    async ([listId]) => {
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

  // Finish an OS-file import. When the drop target lives under a playlist the
  // songs were imported into the Main Library instead (every song must live
  // there), so copy the resulting items into the target via the same path an
  // in-app drag takes -- duplicates dialog included.
  const finishFileImport = async (result, targetListId) => {
    if (result.targetIsPlaylist && result.itemIds.length > 0) {
      await copyIntoPlaylist(result.itemIds, targetListId, props.listTitle);
    }
    await refetch();
    showImportSummary(result);
  };

  // Drag-drop state
  let draggedItems = [];
  let isInternalDrag = false;

  // External file drop target tracking
  let externalDropTarget = null; // { listId, position, intoFolder: boolean }

  // Track current drop state to avoid unnecessary updates that cause flickering
  let currentDropState = null; // { targetItemId, mode: 'above' | 'into' | 'below' }

  // Track if dropping into folder should insert at start (for expanded folders, bottom zone)
  let insertAtFolderStart = false;

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

    // 'copyMove', not 'move': the same drag can be dropped inside the tree (a
    // move) or onto a sidebar playlist (a copy). Chromium refuses a drop whose
    // dropEffect isn't permitted by effectAllowed, so 'move' alone would make
    // every drop on a playlist silently do nothing.
    e.dataTransfer.effectAllowed = 'copyMove';
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

    // Publish the payload so other surfaces (the sidebar) can see what's being
    // dragged. TreeView keeps using its own `draggedItems` for its own logic;
    // nothing is ever written to dataTransfer.
    startInternalDrag(draggedItems, 'tree');
  };

  // Handle drag over - works for both internal and external drags
  const handleDragOver = async (e, targetItemId) => {
    // A playlist chip dragged from the sidebar has no meaning inside the tree.
    if (dragSource() === 'sidebar-playlist') return;

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
        // Hide the visuals only -- clearing the whole drag state here would
        // discard the payload the sidebar needs if the drag continues there.
        hideDropIndicator();
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

    // Check if folder is expanded (has visible children)
    let isFolderExpanded = false;
    if (isFolder) {
      const treeItem = targetContent.closest('.tree-item');
      const childrenContainer = treeItem?.querySelector(':scope > .tree-item-children');
      isFolderExpanded = childrenContainer?.classList.contains('expanded') || false;
    }

    // For folders: top 25% = above, middle 50% = into, bottom 25% = below (or into-first if expanded)
    // For songs: top 50% = above, bottom 50% = below
    const inMiddle50 = isFolder && heightPercent >= 0.25 && heightPercent <= 0.75;
    const inBottom25 = isFolder && heightPercent > 0.75;
    const insertBefore = isFolder ? heightPercent < 0.25 : heightPercent < 0.5;

    // Determine the drop mode
    // For expanded folders, bottom 25% should insert as first child (into-first)
    let dropMode;
    let shouldInsertAtStart = false;
    if (isFolder && inMiddle50) {
      dropMode = 'into';
    } else if (isFolder && inBottom25 && isFolderExpanded) {
      // Expanded folder bottom zone: insert as first child
      dropMode = 'into';
      shouldInsertAtStart = true;
    } else if (insertBefore) {
      dropMode = 'above';
    } else {
      dropMode = 'below';
    }

    // Track insertion mode for handleDrop
    insertAtFolderStart = shouldInsertAtStart;

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

      // Track external drop target
      // position 0 = insert at start, undefined = append to end
      if (isExternalFile) {
        externalDropTarget = { listId: folderId, position: shouldInsertAtStart ? 0 : undefined, intoFolder: true };
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
    hideDropIndicator();
    currentDropState = null;
    const shouldInsertAtStart = insertAtFolderStart;
    insertAtFolderStart = false;

    // Handle external file drop
    if (isExternalFile) {
      e.preventDefault();

      const files = Array.from(e.dataTransfer.files);
      // Pass all file/folder paths to the backend - it handles filtering and folder scanning.
      // Electron 32+ removed File.path; resolve via webUtils exposed in preload.
      const paths = files.map((f) => window.electronAPI.getPathForFile(f));

      if (paths.length > 0 && externalDropTarget) {
        const targetListId = externalDropTarget.listId;
        const result = await addSongsToList(targetListId, paths, externalDropTarget.position);
        await finishFileImport(result, targetListId);
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

      // Sort by position ascending to preserve relative order when moving
      itemsData.sort((a, b) => a.position - b.position);

      if (isDropIntoFolder) {
        // Drop INTO folder
        const targetFolderId = parseInt(targetContent.dataset.folderId);

        if (shouldInsertAtStart) {
          // Insert at beginning of folder (for expanded folder bottom zone)
          let position = 0;
          for (const item of itemsData) {
            await moveItem(item.id, targetFolderId, position);
            position++;
          }
        } else {
          // Append to end of folder
          const folderItems = await getListItems(targetFolderId);
          let endPosition = folderItems.length;
          for (const item of itemsData) {
            await moveItem(item.id, targetFolderId, endPosition);
            endPosition++;
          }
        }
      } else {
        // Drop BEFORE/AFTER - calculate position based on folder rules
        const rect = targetContent.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const heightPercent = relativeY / rect.height;
        const isFolder = targetContent.dataset.isFolder === 'true';
        const insertBefore = isFolder ? heightPercent < 0.25 : heightPercent < 0.5;
        const basePosition = insertBefore ? targetItemData.position : targetItemData.position + 1;

        // Count items moving DOWN (from above the target in the same list)
        const itemsAbove = itemsData.filter(item =>
          item.parent_list_id === targetItemData.parent_list_id &&
          item.position < basePosition
        );
        const itemsNotAbove = itemsData.filter(item =>
          item.parent_list_id !== targetItemData.parent_list_id ||
          item.position >= basePosition
        );

        // Effective base position accounts for all items being removed from above
        const effectiveBase = basePosition - itemsAbove.length;

        // Assign target positions based on original order (ascending)
        const itemTargets = new Map();
        itemsData.forEach((item, index) => {
          itemTargets.set(item.id, effectiveBase + index);
        });

        // Process items moving DOWN in DESCENDING order to avoid interleaving
        // (removing higher-position items first prevents shifting issues)
        const itemsAboveDescending = [...itemsAbove].sort((a, b) => b.position - a.position);
        for (const item of itemsAboveDescending) {
          await moveItem(item.id, targetItemData.parent_list_id, itemTargets.get(item.id));
        }

        // Process remaining items in ASCENDING order
        for (const item of itemsNotAbove) {
          await moveItem(item.id, targetItemData.parent_list_id, itemTargets.get(item.id));
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
    insertAtFolderStart = false;

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

    hideDropIndicator();

    const files = Array.from(e.dataTransfer.files);
    // Pass all file/folder paths to the backend - it handles filtering and folder scanning.
    // Electron 32+ removed File.path; resolve via webUtils exposed in preload.
    const paths = files.map((f) => window.electronAPI.getPathForFile(f));

    if (paths.length > 0) {
      const dropTarget = externalDropTarget || { listId: currentListId(), position: undefined };
      const result = await addSongsToList(dropTarget.listId, paths, dropTarget.position);
      await finishFileImport(result, dropTarget.listId);
    }
    externalDropTarget = null;
  };

  // Handle drag leave on container
  const handleContainerDragLeave = (e) => {
    // Only clear if actually leaving the container
    if (!containerRef?.contains(e.relatedTarget)) {
      // Leaving the tree is exactly the "dragging to the sidebar" case, so hide
      // the visuals but keep the payload alive until dragend.
      hideDropIndicator();
      externalDropTarget = null;
      currentDropState = null;
      document.querySelectorAll('.tree-item-content.drop-into').forEach((el) => {
        el.classList.remove('drop-into');
      });
    }
  };

  // Handle click on empty space in container to clear selection
  const handleContainerClick = (e) => {
    // Only clear if clicking on empty space (not on a tree item)
    if (!e.target.closest('.tree-item-content')) {
      clearSelection();
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
      onClick={handleContainerClick}
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
          <Show when={(items() || []).length === 0 && currentListId() !== MAIN_LIBRARY_ID}>
            <li class="empty-playlist qa-empty-playlist">
              Drag songs here to add them to this playlist.
            </li>
          </Show>
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
