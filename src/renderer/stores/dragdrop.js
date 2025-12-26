import { createSignal, createMemo } from 'solid-js';

// Drag state
const [isDragging, setIsDragging] = createSignal(false);
const [draggedItemIds, setDraggedItemIds] = createSignal([]);
const [isInternalDrag, setIsInternalDrag] = createSignal(false);
const [dragSource, setDragSource] = createSignal(null);  // 'tree' | 'sidebar' | 'external'

// Drop target state
const [dropTargetId, setDropTargetId] = createSignal(null);
const [dropPosition, setDropPosition] = createSignal('after');  // 'before' | 'after' | 'inside'
const [dropTargetListId, setDropTargetListId] = createSignal(null);

// Drop indicator visibility and position
const [isDropIndicatorVisible, setIsDropIndicatorVisible] = createSignal(false);
const [dropIndicatorPosition, setDropIndicatorPosition] = createSignal({ top: 0, left: 0, width: 0 });

/**
 * Start an internal drag operation
 * @param {number[]} itemIds - IDs of items being dragged
 * @param {string} source - 'tree' or 'sidebar'
 */
function startInternalDrag(itemIds, source = 'tree') {
  setIsDragging(true);
  setDraggedItemIds(itemIds);
  setIsInternalDrag(true);
  setDragSource(source);
}

/**
 * Start an external drag operation (files from OS)
 */
function startExternalDrag() {
  setIsDragging(true);
  setDraggedItemIds([]);
  setIsInternalDrag(false);
  setDragSource('external');
}

/**
 * Update drop target
 * @param {number|null} itemId - Target item ID (or null to clear)
 * @param {string} position - 'before' | 'after' | 'inside'
 * @param {number|null} listId - Target list ID (for folder drops)
 */
function updateDropTarget(itemId, position, listId = null) {
  setDropTargetId(itemId);
  setDropPosition(position);
  setDropTargetListId(listId);
}

/**
 * Show drop indicator at a specific position
 * @param {number} top
 * @param {number} left
 * @param {number} width
 */
function showDropIndicator(top, left, width) {
  setDropIndicatorPosition({ top, left, width });
  setIsDropIndicatorVisible(true);
}

/**
 * Hide drop indicator
 */
function hideDropIndicator() {
  setIsDropIndicatorVisible(false);
}

/**
 * End drag operation and reset all state
 */
function endDrag() {
  setIsDragging(false);
  setDraggedItemIds([]);
  setIsInternalDrag(false);
  setDragSource(null);
  setDropTargetId(null);
  setDropPosition('after');
  setDropTargetListId(null);
  hideDropIndicator();
}

/**
 * Check if a specific item is being dragged
 * @param {number} itemId
 * @returns {boolean}
 */
function isItemBeingDragged(itemId) {
  return draggedItemIds().includes(itemId);
}

/**
 * Check if current drag operation is internal (tree reorder) vs external (file drop)
 * @returns {boolean}
 */
const isInternalDragOperation = createMemo(() => isInternalDrag());

/**
 * Check if we're dragging multiple items
 * @returns {boolean}
 */
const isDraggingMultiple = createMemo(() => draggedItemIds().length > 1);

/**
 * Get count of items being dragged
 * @returns {number}
 */
const draggedItemCount = createMemo(() => draggedItemIds().length);

/**
 * Get the drop info for executing the drop
 * @returns {{ targetId: number|null, position: string, listId: number|null }}
 */
function getDropInfo() {
  return {
    targetId: dropTargetId(),
    position: dropPosition(),
    listId: dropTargetListId(),
  };
}

/**
 * Set drag state (unified setter for components)
 * @param {Object} state
 */
function setDragState(state) {
  if (state.isDragging !== undefined) {
    setIsDragging(state.isDragging);
  }
  if (state.draggedItemId !== undefined) {
    setDraggedItemIds([state.draggedItemId]);
  }
  if (state.showDropIndicator !== undefined) {
    setIsDropIndicatorVisible(state.showDropIndicator);
  }
  if (state.dropIndicatorTop !== undefined || state.dropIndicatorLeft !== undefined || state.dropIndicatorWidth !== undefined) {
    setDropIndicatorPosition({
      top: state.dropIndicatorTop ?? dropIndicatorPosition().top,
      left: state.dropIndicatorLeft ?? dropIndicatorPosition().left,
      width: state.dropIndicatorWidth ?? dropIndicatorPosition().width,
    });
  }
}

/**
 * Clear all drag state (alias for endDrag for component usage)
 */
function clearDragState() {
  endDrag();
}

export {
  // Drag signals
  isDragging,
  draggedItemIds,
  isInternalDrag,
  dragSource,

  // Drop target signals
  dropTargetId,
  dropPosition,
  dropTargetListId,

  // Drop indicator signals
  isDropIndicatorVisible,
  dropIndicatorPosition,

  // Drag functions
  startInternalDrag,
  startExternalDrag,
  endDrag,
  isItemBeingDragged,
  setDragState,
  clearDragState,

  // Drop functions
  updateDropTarget,
  showDropIndicator,
  hideDropIndicator,
  getDropInfo,

  // Computed
  isInternalDragOperation,
  isDraggingMultiple,
  draggedItemCount,
};
