import { createSignal, createMemo, createRoot } from 'solid-js';

// Create store signals inside createRoot to avoid "computations created outside createRoot" warnings
// These are intentionally global and live for the app lifetime
const {
  currentListId,
  setCurrentListId,
  selectedItemIds,
  setSelectedItemIds,
  lastSelectedItemId,
  setLastSelectedItemId,
  visibleItemIds,
  setVisibleItemIds,
  hasMultipleSelected,
  selectedCount,
} = createRoot(() => {
  // Current list being viewed (0 = Main Library)
  const [currentListId, setCurrentListId] = createSignal(0);

  // Set of selected item IDs
  const [selectedItemIds, setSelectedItemIds] = createSignal(new Set());

  // Last selected item ID (for shift-click range selection)
  const [lastSelectedItemId, setLastSelectedItemId] = createSignal(null);

  // Flat list of visible item IDs in order (for range selection)
  const [visibleItemIds, setVisibleItemIds] = createSignal([]);

  /**
   * Check if multiple items are selected
   * @returns {boolean}
   */
  const hasMultipleSelected = createMemo(() => selectedItemIds().size > 1);

  /**
   * Get count of selected items
   * @returns {number}
   */
  const selectedCount = createMemo(() => selectedItemIds().size);

  return {
    currentListId,
    setCurrentListId,
    selectedItemIds,
    setSelectedItemIds,
    lastSelectedItemId,
    setLastSelectedItemId,
    visibleItemIds,
    setVisibleItemIds,
    hasMultipleSelected,
    selectedCount,
  };
});

/**
 * Check if an item is selected
 * @param {number} itemId
 * @returns {boolean}
 */
function isSelected(itemId) {
  return selectedItemIds().has(itemId);
}

/**
 * Select a single item, clearing previous selection
 * @param {number} itemId
 */
function selectItem(itemId) {
  setSelectedItemIds(new Set([itemId]));
  setLastSelectedItemId(itemId);
}

/**
 * Toggle selection of an item (for cmd/ctrl+click)
 * @param {number} itemId
 */
function toggleItemSelection(itemId) {
  setSelectedItemIds(prev => {
    const next = new Set(prev);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
      setLastSelectedItemId(itemId);
    }
    return next;
  });
}

/**
 * Select a range of items (for shift+click)
 * @param {number} itemId - The end of the range
 */
function selectRange(itemId) {
  const lastId = lastSelectedItemId();
  const visible = visibleItemIds();

  if (lastId === null || visible.length === 0) {
    selectItem(itemId);
    return;
  }

  const lastIndex = visible.indexOf(lastId);
  const currentIndex = visible.indexOf(itemId);

  if (lastIndex === -1 || currentIndex === -1) {
    selectItem(itemId);
    return;
  }

  const start = Math.min(lastIndex, currentIndex);
  const end = Math.max(lastIndex, currentIndex);

  const rangeIds = visible.slice(start, end + 1);
  setSelectedItemIds(new Set(rangeIds));
  // Don't update lastSelectedItemId on range select
}

/**
 * Handle click on an item with modifier keys
 * @param {number} itemId
 * @param {Object} modifiers
 * @param {boolean} modifiers.shift
 * @param {boolean} modifiers.cmd
 */
function handleItemClick(itemId, { shift = false, cmd = false } = {}) {
  if (cmd) {
    toggleItemSelection(itemId);
  } else if (shift) {
    selectRange(itemId);
  } else {
    selectItem(itemId);
  }
}

/**
 * Clear all selections
 */
function clearSelection() {
  setSelectedItemIds(new Set());
  setLastSelectedItemId(null);
}

/**
 * Get array of selected item IDs
 * @returns {number[]}
 */
function getSelectedItemIds() {
  return Array.from(selectedItemIds());
}

/**
 * Select a range of items given an array of visible IDs
 * @param {number} itemId - The end of the range
 * @param {number[]} visibleIds - Array of visible item IDs
 */
function rangeSelect(itemId, visibleIds) {
  const lastId = lastSelectedItemId();

  if (lastId === null || visibleIds.length === 0) {
    selectItem(itemId);
    return;
  }

  const lastIndex = visibleIds.indexOf(lastId);
  const currentIndex = visibleIds.indexOf(itemId);

  if (lastIndex === -1 || currentIndex === -1) {
    selectItem(itemId);
    return;
  }

  const start = Math.min(lastIndex, currentIndex);
  const end = Math.max(lastIndex, currentIndex);

  const rangeIds = visibleIds.slice(start, end + 1);
  setSelectedItemIds(new Set(rangeIds));
}

/**
 * Select all items given an array of visible IDs
 * @param {number[]} visibleIds - Array of visible item IDs
 */
function selectAll(visibleIds) {
  if (visibleIds.length === 0) return;
  setSelectedItemIds(new Set(visibleIds));
  setLastSelectedItemId(visibleIds[0]);
}

export {
  // Signals
  currentListId,
  setCurrentListId,
  selectedItemIds,
  lastSelectedItemId,
  setLastSelectedItemId,
  visibleItemIds,
  setVisibleItemIds,

  // Aliases for component usage
  selectedItemIds as selectedItems,
  selectItem as selectOnly,
  toggleItemSelection as toggleSelection,

  // Functions
  isSelected,
  selectItem,
  toggleItemSelection,
  selectRange,
  rangeSelect,
  selectAll,
  handleItemClick,
  clearSelection,
  getSelectedItemIds,

  // Computed
  hasMultipleSelected,
  selectedCount,
};
