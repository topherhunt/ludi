import { createSignal, createMemo, createRoot } from 'solid-js';

// Create signals inside createRoot to avoid warnings
const {
  isDragging,
  setIsDragging,
  draggedItemIds,
  setDraggedItemIds,
  isInternalDrag,
  setIsInternalDrag,
  dragSource,
  setDragSource,
  dropTargetId,
  setDropTargetId,
  dropPosition,
  setDropPosition,
  dropTargetListId,
  setDropTargetListId,
  isDropIndicatorVisible,
  setIsDropIndicatorVisible,
  dropIndicatorPosition,
  setDropIndicatorPosition,
  isInternalDragOperation,
  isDraggingMultiple,
  draggedItemCount,
} = createRoot(() => {
  // Drag state
  const [isDragging, setIsDragging] = createSignal(false);
  const [draggedItemIds, setDraggedItemIds] = createSignal([]);
  const [isInternalDrag, setIsInternalDrag] = createSignal(false);
  const [dragSource, setDragSource] = createSignal(null);

  // Drop target state
  const [dropTargetId, setDropTargetId] = createSignal(null);
  const [dropPosition, setDropPosition] = createSignal('after');
  const [dropTargetListId, setDropTargetListId] = createSignal(null);

  // Drop indicator visibility and position
  const [isDropIndicatorVisible, setIsDropIndicatorVisible] = createSignal(false);
  const [dropIndicatorPosition, setDropIndicatorPosition] = createSignal({ top: 0, left: 0, width: 0 });

  // Computed
  const isInternalDragOperation = createMemo(() => isInternalDrag());
  const isDraggingMultiple = createMemo(() => draggedItemIds().length > 1);
  const draggedItemCount = createMemo(() => draggedItemIds().length);

  return {
    isDragging,
    setIsDragging,
    draggedItemIds,
    setDraggedItemIds,
    isInternalDrag,
    setIsInternalDrag,
    dragSource,
    setDragSource,
    dropTargetId,
    setDropTargetId,
    dropPosition,
    setDropPosition,
    dropTargetListId,
    setDropTargetListId,
    isDropIndicatorVisible,
    setIsDropIndicatorVisible,
    dropIndicatorPosition,
    setDropIndicatorPosition,
    isInternalDragOperation,
    isDraggingMultiple,
    draggedItemCount,
  };
});

/**
 * Start an internal drag operation
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
 */
function updateDropTarget(itemId, position, listId = null) {
  setDropTargetId(itemId);
  setDropPosition(position);
  setDropTargetListId(listId);
}

/**
 * Show drop indicator at a specific position
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
 */
function isItemBeingDragged(itemId) {
  return draggedItemIds().includes(itemId);
}

/**
 * Get the drop info for executing the drop
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
 * Clear all drag state (alias for endDrag)
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
