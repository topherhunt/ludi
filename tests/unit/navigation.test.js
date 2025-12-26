import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentListId,
  setCurrentListId,
  selectedItemIds,
  isSelected,
  selectItem,
  toggleItemSelection,
  selectRange,
  handleItemClick,
  clearSelection,
  getSelectedItemIds,
  hasMultipleSelected,
  selectedCount,
  setVisibleItemIds,
} from '../../src/renderer/stores/navigation.js';

describe('Navigation Store', () => {
  beforeEach(() => {
    // Reset state before each test
    clearSelection();
    setCurrentListId(0);
    setVisibleItemIds([]);
  });

  describe('currentListId', () => {
    it('should default to 0 (Main Library)', () => {
      expect(currentListId()).toBe(0);
    });

    it('should update when set', () => {
      setCurrentListId(5);
      expect(currentListId()).toBe(5);
    });
  });

  describe('selection', () => {
    it('should start with no selection', () => {
      expect(selectedItemIds().size).toBe(0);
      expect(selectedCount()).toBe(0);
    });

    it('should select a single item', () => {
      selectItem(1);
      expect(isSelected(1)).toBe(true);
      expect(selectedCount()).toBe(1);
    });

    it('should clear previous selection when selecting a new item', () => {
      selectItem(1);
      selectItem(2);
      expect(isSelected(1)).toBe(false);
      expect(isSelected(2)).toBe(true);
      expect(selectedCount()).toBe(1);
    });

    it('should toggle selection with cmd+click', () => {
      selectItem(1);
      toggleItemSelection(2);
      expect(isSelected(1)).toBe(true);
      expect(isSelected(2)).toBe(true);
      expect(selectedCount()).toBe(2);
      expect(hasMultipleSelected()).toBe(true);
    });

    it('should deselect item when toggling an already selected item', () => {
      selectItem(1);
      toggleItemSelection(2);
      toggleItemSelection(1);
      expect(isSelected(1)).toBe(false);
      expect(isSelected(2)).toBe(true);
      expect(selectedCount()).toBe(1);
    });

    it('should clear all selections', () => {
      selectItem(1);
      toggleItemSelection(2);
      clearSelection();
      expect(selectedCount()).toBe(0);
      expect(hasMultipleSelected()).toBe(false);
    });

    it('should return selected item IDs as array', () => {
      selectItem(1);
      toggleItemSelection(2);
      toggleItemSelection(3);
      const ids = getSelectedItemIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
    });
  });

  describe('range selection', () => {
    beforeEach(() => {
      // Set up visible items for range selection
      setVisibleItemIds([1, 2, 3, 4, 5]);
    });

    it('should select a range of items', () => {
      selectItem(1);
      selectRange(3);
      expect(isSelected(1)).toBe(true);
      expect(isSelected(2)).toBe(true);
      expect(isSelected(3)).toBe(true);
      expect(isSelected(4)).toBe(false);
      expect(selectedCount()).toBe(3);
    });

    it('should select range in reverse order', () => {
      selectItem(4);
      selectRange(2);
      expect(isSelected(2)).toBe(true);
      expect(isSelected(3)).toBe(true);
      expect(isSelected(4)).toBe(true);
      expect(isSelected(1)).toBe(false);
      expect(selectedCount()).toBe(3);
    });

    it('should fallback to single selection if no previous selection', () => {
      clearSelection();
      selectRange(3);
      expect(isSelected(3)).toBe(true);
      expect(selectedCount()).toBe(1);
    });
  });

  describe('handleItemClick', () => {
    beforeEach(() => {
      setVisibleItemIds([1, 2, 3, 4, 5]);
    });

    it('should select single item on plain click', () => {
      handleItemClick(1);
      expect(isSelected(1)).toBe(true);
      expect(selectedCount()).toBe(1);
    });

    it('should toggle selection on cmd+click', () => {
      handleItemClick(1);
      handleItemClick(2, { cmd: true });
      expect(isSelected(1)).toBe(true);
      expect(isSelected(2)).toBe(true);
    });

    it('should select range on shift+click', () => {
      handleItemClick(1);
      handleItemClick(3, { shift: true });
      expect(selectedCount()).toBe(3);
    });

    it('should replace selection on plain click after multi-select', () => {
      handleItemClick(1);
      handleItemClick(2, { cmd: true });
      handleItemClick(3);
      expect(isSelected(1)).toBe(false);
      expect(isSelected(2)).toBe(false);
      expect(isSelected(3)).toBe(true);
      expect(selectedCount()).toBe(1);
    });
  });
});
