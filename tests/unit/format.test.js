import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatFileSize,
  pluralize,
  formatItemCount,
} from '../../src/renderer/utils/format.js';

describe('Format Utilities', () => {
  describe('formatTime', () => {
    it('should format 0 seconds as 0:00', () => {
      expect(formatTime(0)).toBe('0:00');
    });

    it('should format seconds less than a minute', () => {
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(30)).toBe('0:30');
      expect(formatTime(59)).toBe('0:59');
    });

    it('should format minutes and seconds', () => {
      expect(formatTime(60)).toBe('1:00');
      expect(formatTime(90)).toBe('1:30');
      expect(formatTime(125)).toBe('2:05');
    });

    it('should format times over 10 minutes', () => {
      expect(formatTime(600)).toBe('10:00');
      expect(formatTime(754)).toBe('12:34');
    });

    it('should format times over an hour', () => {
      expect(formatTime(3600)).toBe('60:00');
      expect(formatTime(3661)).toBe('61:01');
    });

    it('should handle decimal seconds by flooring', () => {
      expect(formatTime(90.5)).toBe('1:30');
      expect(formatTime(90.9)).toBe('1:30');
    });

    it('should handle null/undefined/NaN', () => {
      expect(formatTime(null)).toBe('0:00');
      expect(formatTime(undefined)).toBe('0:00');
      expect(formatTime(NaN)).toBe('0:00');
    });
  });

  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(5242880)).toBe('5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('pluralize', () => {
    it('should return singular for count of 1', () => {
      expect(pluralize(1, 'item')).toBe('item');
      expect(pluralize(1, 'song')).toBe('song');
    });

    it('should return plural for count of 0', () => {
      expect(pluralize(0, 'item')).toBe('items');
    });

    it('should return plural for count greater than 1', () => {
      expect(pluralize(2, 'item')).toBe('items');
      expect(pluralize(100, 'song')).toBe('songs');
    });

    it('should use custom plural form if provided', () => {
      expect(pluralize(2, 'child', 'children')).toBe('children');
      expect(pluralize(1, 'child', 'children')).toBe('child');
    });
  });

  describe('formatItemCount', () => {
    it('should format singular item', () => {
      expect(formatItemCount(1)).toBe('1 item');
    });

    it('should format plural items', () => {
      expect(formatItemCount(0)).toBe('0 items');
      expect(formatItemCount(5)).toBe('5 items');
      expect(formatItemCount(100)).toBe('100 items');
    });
  });
});
