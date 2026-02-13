import { describe, it, expect } from 'vitest';
import { PositionService } from './PositionService';

describe('PositionService', () => {
  describe('with timeScale 10', () => {
    const service = new PositionService({ timeScale: 10 });

    describe('worldXToDate', () => {
      it('should convert epoch position to 1970-01-01', () => {
        const date = service.worldXToDate(0);
        expect(date).toBe('1970-01-01');
      });

      it('should convert positive world X to later dates', () => {
        // 10 px/day, worldX=100 = day 10 = 1970-01-11
        const date = service.worldXToDate(100);
        expect(date).toBe('1970-01-11');
      });

      it('should convert negative world X to earlier dates', () => {
        const date = service.worldXToDate(-10);
        // worldX=-10 at timeScale 10 = day -1 = 1969-12-31
        expect(date).toBe('1969-12-31');
      });
    });

    describe('calculateDatesFromResize', () => {
      it('should calculate correct start and end dates', () => {
        const result = service.calculateDatesFromResize(0, 100);
        // worldX=0 → 1970-01-01, worldX=100 → day 10 → 1970-01-11
        expect(result.dateStart).toBe('1970-01-01');
        expect(result.dateEnd).toBe('1970-01-11');
      });

      it('should handle wide cards', () => {
        const result = service.calculateDatesFromResize(0, 3650);
        // 3650 px at 10 px/day = 365 days ≈ 1 year
        expect(result.dateStart).toBe('1970-01-01');
        expect(result.dateEnd).toBe('1971-01-01');
      });
    });

    describe('formatDateForLevel', () => {
      it('should format day 0 with year 1970', () => {
        const formatted = service.formatDateForLevel(0);
        expect(formatted).toContain('1970');
      });
    });

    describe('getCurrentScaleLevel', () => {
      it('should return a numeric scale level', () => {
        const level = service.getCurrentScaleLevel();
        expect(typeof level).toBe('number');
        expect(level).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('setTimeScale', () => {
    it('should update time scale and change calculations', () => {
      const service = new PositionService({ timeScale: 10 });

      // At timeScale 10: worldX=100 = day 10
      const date1 = service.worldXToDate(100);

      service.setTimeScale(1);

      // At timeScale 1: worldX=100 = day 100
      const date2 = service.worldXToDate(100);

      expect(date1).not.toBe(date2);
    });
  });

  describe('recalculatePositions', () => {
    it('should recalculate item positions for new time scale', () => {
      const service = new PositionService({ timeScale: 10 });

      const items = [
        {
          type: 'note' as const,
          file: { path: 'test.md' } as any,
          title: 'Test',
          x: 0,
          y: 0,
          width: 100,
          dateStart: '1970-01-01',
          dateEnd: '1970-01-11',
        }
      ];

      // Change time scale and recalculate
      service.setTimeScale(20);
      const recalculated = service.recalculatePositions(items);

      // At timeScale 20, same date range should produce width = 10 days * 20 = 200
      expect(recalculated[0]!.width).toBe(200);
      expect(recalculated[0]!.x).toBe(0); // Epoch start should still be 0
    });

    it('should not mutate original items', () => {
      const service = new PositionService({ timeScale: 10 });

      const items = [
        {
          type: 'note' as const,
          file: { path: 'test.md' } as any,
          title: 'Test',
          x: 0,
          y: 0,
          width: 100,
          dateStart: '1970-01-01',
          dateEnd: '1970-01-11',
        }
      ];

      service.setTimeScale(20);
      service.recalculatePositions(items);

      expect(items[0]!.width).toBe(100); // Original unchanged
    });

    it('should handle items with invalid dates gracefully', () => {
      const service = new PositionService({ timeScale: 10 });

      const items = [
        {
          type: 'note' as const,
          file: { path: 'test.md' } as any,
          title: 'Test',
          x: 50,
          y: 0,
          width: 100,
          dateStart: 'invalid',
          dateEnd: 'also-invalid',
        }
      ];

      const result = service.recalculatePositions(items);
      // Should return item unchanged
      expect(result[0]!.x).toBe(50);
      expect(result[0]!.width).toBe(100);
    });
  });
});
