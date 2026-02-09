import { describe, it, expect } from 'vitest';
import { LayerManager } from './LayerManager';
import { TimelineDate } from './TimelineDate';
import type { LayerableItem } from './LayerManager';

// Helper to create mock TFile objects for testing
function mockFile(path: string): any {
  return { path, basename: path.split('/').pop() ?? path };
}

// Helper to create a LayerableItem
function makeItem(
  path: string,
  startStr: string,
  endStr: string,
  layer?: number,
  frontmatterLayer?: number
): LayerableItem {
  return {
    file: mockFile(path),
    dateStart: TimelineDate.fromString(startStr)!,
    dateEnd: TimelineDate.fromString(endStr)!,
    layer,
    frontmatterLayer
  };
}

describe('LayerManager', () => {
  describe('rangesOverlap', () => {
    it('should detect overlapping ranges', () => {
      const s1 = TimelineDate.fromString('2024-01-01')!;
      const e1 = TimelineDate.fromString('2024-06-01')!;
      const s2 = TimelineDate.fromString('2024-03-01')!;
      const e2 = TimelineDate.fromString('2024-09-01')!;

      expect(LayerManager.rangesOverlap(s1, e1, s2, e2)).toBe(true);
    });

    it('should detect non-overlapping ranges', () => {
      const s1 = TimelineDate.fromString('2024-01-01')!;
      const e1 = TimelineDate.fromString('2024-03-01')!;
      const s2 = TimelineDate.fromString('2024-06-01')!;
      const e2 = TimelineDate.fromString('2024-09-01')!;

      expect(LayerManager.rangesOverlap(s1, e1, s2, e2)).toBe(false);
    });

    it('should detect adjacent ranges as overlapping (touching endpoints)', () => {
      const s1 = TimelineDate.fromString('2024-01-01')!;
      const e1 = TimelineDate.fromString('2024-06-01')!;
      const s2 = TimelineDate.fromString('2024-06-01')!;
      const e2 = TimelineDate.fromString('2024-12-01')!;

      // Touching at boundary - start1 <= end2 && end1 >= start2
      expect(LayerManager.rangesOverlap(s1, e1, s2, e2)).toBe(true);
    });

    it('should detect when one range contains another', () => {
      const s1 = TimelineDate.fromString('2024-01-01')!;
      const e1 = TimelineDate.fromString('2024-12-31')!;
      const s2 = TimelineDate.fromString('2024-03-01')!;
      const e2 = TimelineDate.fromString('2024-06-01')!;

      expect(LayerManager.rangesOverlap(s1, e1, s2, e2)).toBe(true);
      expect(LayerManager.rangesOverlap(s2, e2, s1, e1)).toBe(true);
    });

    it('should detect identical ranges as overlapping', () => {
      const s = TimelineDate.fromString('2024-01-01')!;
      const e = TimelineDate.fromString('2024-06-01')!;

      expect(LayerManager.rangesOverlap(s, e, s, e)).toBe(true);
    });

    it('should handle BCE date ranges', () => {
      const s1 = TimelineDate.fromString('-1000-01-01')!;
      const e1 = TimelineDate.fromString('-500-01-01')!;
      const s2 = TimelineDate.fromString('-800-01-01')!;
      const e2 = TimelineDate.fromString('-200-01-01')!;

      expect(LayerManager.rangesOverlap(s1, e1, s2, e2)).toBe(true);
    });
  });

  describe('isLayerBusy', () => {
    it('should return false for empty layer', () => {
      const start = TimelineDate.fromString('2024-01-01')!;
      const end = TimelineDate.fromString('2024-06-01')!;

      expect(LayerManager.isLayerBusy(0, start, end, [])).toBe(false);
    });

    it('should return true when layer has overlapping item', () => {
      const items: LayerableItem[] = [
        makeItem('file1.md', '2024-01-01', '2024-06-01', 0)
      ];

      const start = TimelineDate.fromString('2024-03-01')!;
      const end = TimelineDate.fromString('2024-09-01')!;

      expect(LayerManager.isLayerBusy(0, start, end, items)).toBe(true);
    });

    it('should return false when layer has non-overlapping item', () => {
      const items: LayerableItem[] = [
        makeItem('file1.md', '2024-01-01', '2024-03-01', 0)
      ];

      const start = TimelineDate.fromString('2024-06-01')!;
      const end = TimelineDate.fromString('2024-09-01')!;

      expect(LayerManager.isLayerBusy(0, start, end, items)).toBe(false);
    });

    it('should return false when overlapping item is on different layer', () => {
      const items: LayerableItem[] = [
        makeItem('file1.md', '2024-01-01', '2024-06-01', 1) // Layer 1
      ];

      const start = TimelineDate.fromString('2024-03-01')!;
      const end = TimelineDate.fromString('2024-09-01')!;

      expect(LayerManager.isLayerBusy(0, start, end, items)).toBe(false); // Checking layer 0
    });

    it('should exclude specified file from check', () => {
      const file1 = mockFile('file1.md');
      const items: LayerableItem[] = [
        { file: file1, dateStart: TimelineDate.fromString('2024-01-01')!, dateEnd: TimelineDate.fromString('2024-06-01')!, layer: 0 }
      ];

      const start = TimelineDate.fromString('2024-03-01')!;
      const end = TimelineDate.fromString('2024-09-01')!;

      // Should be busy normally
      expect(LayerManager.isLayerBusy(0, start, end, items)).toBe(true);
      // Should not be busy when excluding file1
      expect(LayerManager.isLayerBusy(0, start, end, items, file1)).toBe(false);
    });
  });

  describe('layerToY', () => {
    it('should return 0 for layer 0', () => {
      expect(LayerManager.layerToY(0)).toBeCloseTo(0, 5);
    });

    it('should return negative Y for positive layers (above)', () => {
      expect(LayerManager.layerToY(1)).toBe(-50);
      expect(LayerManager.layerToY(2)).toBe(-100);
    });

    it('should return positive Y for negative layers (below)', () => {
      expect(LayerManager.layerToY(-1)).toBe(50);
      expect(LayerManager.layerToY(-2)).toBe(100);
    });

    it('should use 50px grid spacing', () => {
      expect(LayerManager.layerToY(3)).toBe(-150);
      expect(LayerManager.layerToY(-3)).toBe(150);
    });
  });

  describe('assignLayers', () => {
    it('should assign all non-overlapping items to layer 0', () => {
      const items: LayerableItem[] = [
        makeItem('a.md', '2024-01-01', '2024-02-01'),
        makeItem('b.md', '2024-03-01', '2024-04-01'),
        makeItem('c.md', '2024-05-01', '2024-06-01'),
      ];

      LayerManager.assignLayers(items);

      items.forEach(item => {
        expect(item.layer).toBe(0);
      });
    });

    it('should assign overlapping items to different layers', () => {
      const items: LayerableItem[] = [
        makeItem('a.md', '2024-01-01', '2024-06-01'),
        makeItem('b.md', '2024-03-01', '2024-09-01'),
      ];

      LayerManager.assignLayers(items);

      // Items should be on different layers
      expect(items[0]!.layer).not.toBe(items[1]!.layer);
    });

    it('should assign three overlapping items to three different layers', () => {
      const items: LayerableItem[] = [
        makeItem('a.md', '2024-01-01', '2024-12-31'),
        makeItem('b.md', '2024-01-01', '2024-12-31'),
        makeItem('c.md', '2024-01-01', '2024-12-31'),
      ];

      LayerManager.assignLayers(items);

      const layers = new Set(items.map(i => i.layer));
      expect(layers.size).toBe(3); // All on unique layers
    });

    it('should respect frontmatterLayer preference', () => {
      const items: LayerableItem[] = [
        makeItem('a.md', '2024-01-01', '2024-12-31', undefined, 5),
      ];

      LayerManager.assignLayers(items);

      expect(items[0]!.layer).toBe(5);
    });

    it('should use alternating pattern when preferred layer is busy', () => {
      const items: LayerableItem[] = [
        makeItem('a.md', '2024-01-01', '2024-12-31', undefined, 0),
        makeItem('b.md', '2024-01-01', '2024-12-31', undefined, 0),
      ];

      LayerManager.assignLayers(items);

      // First gets layer 0, second should get layer 1 (+1 in alternating pattern)
      expect(items[0]!.layer).toBe(0);
      expect(items[1]!.layer).toBe(1);
    });
  });

  describe('sortByDate', () => {
    it('should sort items by start date', () => {
      const items: LayerableItem[] = [
        makeItem('c.md', '2024-06-01', '2024-12-01'),
        makeItem('a.md', '2024-01-01', '2024-03-01'),
        makeItem('b.md', '2024-03-01', '2024-06-01'),
      ];

      const sorted = LayerManager.sortByDate(items);

      expect(sorted[0]!.file.path).toBe('a.md');
      expect(sorted[1]!.file.path).toBe('b.md');
      expect(sorted[2]!.file.path).toBe('c.md');
    });

    it('should sort by end date when start dates are equal', () => {
      const items: LayerableItem[] = [
        makeItem('b.md', '2024-01-01', '2024-12-01'),
        makeItem('a.md', '2024-01-01', '2024-06-01'),
      ];

      const sorted = LayerManager.sortByDate(items);

      expect(sorted[0]!.file.path).toBe('a.md'); // Shorter range first
      expect(sorted[1]!.file.path).toBe('b.md');
    });

    it('should not mutate original array', () => {
      const items: LayerableItem[] = [
        makeItem('b.md', '2024-06-01', '2024-12-01'),
        makeItem('a.md', '2024-01-01', '2024-03-01'),
      ];

      const sorted = LayerManager.sortByDate(items);

      expect(items[0]!.file.path).toBe('b.md'); // Original unchanged
      expect(sorted[0]!.file.path).toBe('a.md'); // Sorted copy
    });

    it('should handle empty array', () => {
      expect(LayerManager.sortByDate([])).toEqual([]);
    });
  });
});
