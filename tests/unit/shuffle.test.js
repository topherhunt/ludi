import { describe, it, expect } from 'vitest';
import {
  shuffleArray,
  createShuffledIndices,
  createShuffledIndicesWithPin,
} from '../../src/renderer/utils/shuffle.js';

describe('Shuffle Utilities', () => {
  describe('shuffleArray', () => {
    it('should return an array of the same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(5);
    });

    it('should not modify the original array', () => {
      const input = [1, 2, 3, 4, 5];
      const original = [...input];
      shuffleArray(input);
      expect(input).toEqual(original);
    });

    it('should contain all original elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should return a different order (statistically likely for large arrays)', () => {
      const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = new Set();

      // Run shuffle 10 times and collect unique results
      for (let i = 0; i < 10; i++) {
        results.add(JSON.stringify(shuffleArray(input)));
      }

      // Statistically, we should get at least 2 different orderings
      expect(results.size).toBeGreaterThan(1);
    });

    it('should handle empty array', () => {
      expect(shuffleArray([])).toEqual([]);
    });

    it('should handle single element array', () => {
      expect(shuffleArray([1])).toEqual([1]);
    });
  });

  describe('createShuffledIndices', () => {
    it('should return indices from 0 to length-1', () => {
      const result = createShuffledIndices(5);
      expect(result.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    it('should return empty array for length 0', () => {
      expect(createShuffledIndices(0)).toEqual([]);
    });

    it('should return [0] for length 1', () => {
      expect(createShuffledIndices(1)).toEqual([0]);
    });
  });

  describe('createShuffledIndicesWithPin', () => {
    it('should keep pinned index at position 0', () => {
      const result = createShuffledIndicesWithPin(5, 3);
      expect(result[0]).toBe(3);
    });

    it('should contain all indices', () => {
      const result = createShuffledIndicesWithPin(5, 2);
      expect(result.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    it('should shuffle remaining elements', () => {
      const results = new Set();

      for (let i = 0; i < 10; i++) {
        const result = createShuffledIndicesWithPin(10, 0);
        // Remove the pinned element and check the rest
        results.add(JSON.stringify(result.slice(1)));
      }

      // Should have multiple different orderings
      expect(results.size).toBeGreaterThan(1);
    });

    it('should work with pin at position 0', () => {
      const result = createShuffledIndicesWithPin(5, 0);
      expect(result[0]).toBe(0);
      expect(result.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    it('should work with pin at last position', () => {
      const result = createShuffledIndicesWithPin(5, 4);
      expect(result[0]).toBe(4);
      expect(result.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
