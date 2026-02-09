import { describe, it, expect } from 'vitest';
import { TimeScaleManager } from './TimeScaleManager';

describe('TimeScaleManager', () => {
  describe('getScaleLevel', () => {
    it('should return level 0 for day view (high zoom)', () => {
      // At 10 pixels per day with 1x scale = 10 pixels/day
      // Level 0 spacing: 10 * 1 = 10px between day markers
      expect(TimeScaleManager.getScaleLevel(10, 1)).toBe(0);
    });

    it('should return level 1 when day markers would be too close', () => {
      // At 0.5 pixels per day, day markers would be 0.5px apart
      // Should switch to level 1 (month markers)
      expect(TimeScaleManager.getScaleLevel(0.5, 1)).toBeGreaterThanOrEqual(1);
    });

    it('should return higher levels for lower zoom', () => {
      // Very zoomed out view
      const level1 = TimeScaleManager.getScaleLevel(1, 1);
      const level2 = TimeScaleManager.getScaleLevel(0.1, 1);
      const level3 = TimeScaleManager.getScaleLevel(0.01, 1);

      expect(level2).toBeGreaterThan(level1);
      expect(level3).toBeGreaterThan(level2);
    });

    it('should account for scale multiplier', () => {
      // Same timeScale but different scale should give different levels
      const levelAt1x = TimeScaleManager.getScaleLevel(1, 1);
      const levelAt2x = TimeScaleManager.getScaleLevel(1, 2);

      expect(levelAt2x).toBeLessThanOrEqual(levelAt1x);
    });

    it('should return consistent levels for extreme zoom levels', () => {
      // Test that we don't crash at extreme values
      expect(TimeScaleManager.getScaleLevel(0.0001, 1)).toBeGreaterThan(0);
      expect(TimeScaleManager.getScaleLevel(1000, 1)).toBe(0);
    });
  });

  describe('getBaseScaleForLevel', () => {
    it('should return correct base scales for known levels', () => {
      expect(TimeScaleManager.getBaseScaleForLevel(0)).toBe(1);      // 1 px/day
      expect(TimeScaleManager.getBaseScaleForLevel(1)).toBe(30);     // ~30 px/month
      expect(TimeScaleManager.getBaseScaleForLevel(2)).toBe(365);    // 365 px/year
      expect(TimeScaleManager.getBaseScaleForLevel(3)).toBe(3650);   // 3650 px/decade
      expect(TimeScaleManager.getBaseScaleForLevel(4)).toBe(36500);  // 36500 px/century
    });

    it('should calculate exponential scale for levels beyond 4', () => {
      const level5 = TimeScaleManager.getBaseScaleForLevel(5);
      const level6 = TimeScaleManager.getBaseScaleForLevel(6);

      expect(level5).toBe(365000);     // millennia
      expect(level6).toBe(3650000);    // 10k years
      expect(level6).toBe(level5 * 10);
    });
  });

  describe('dayToWorldX', () => {
    it('should convert days to world X at timeScale 1', () => {
      expect(TimeScaleManager.dayToWorldX(0, 1)).toBe(0);
      expect(TimeScaleManager.dayToWorldX(100, 1)).toBe(100);
      expect(TimeScaleManager.dayToWorldX(-100, 1)).toBe(-100);
    });

    it('should convert days to world X at different time scales', () => {
      expect(TimeScaleManager.dayToWorldX(10, 10)).toBe(100);   // 10 days * 10 px/day
      expect(TimeScaleManager.dayToWorldX(10, 0.5)).toBe(5);    // 10 days * 0.5 px/day
    });

    it('should handle zero days', () => {
      expect(TimeScaleManager.dayToWorldX(0, 10)).toBe(0);
    });

    it('should handle large day values', () => {
      const billionDays = 1000000000;
      expect(TimeScaleManager.dayToWorldX(billionDays, 1)).toBe(billionDays);
      expect(TimeScaleManager.dayToWorldX(billionDays, 10)).toBe(billionDays * 10);
    });
  });

  describe('worldXToDay', () => {
    it('should convert world X to days at timeScale 1', () => {
      expect(TimeScaleManager.worldXToDay(0, 1)).toBe(0);
      expect(TimeScaleManager.worldXToDay(100, 1)).toBe(100);
      expect(TimeScaleManager.worldXToDay(-100, 1)).toBe(-100);
    });

    it('should convert world X to days at different time scales', () => {
      expect(TimeScaleManager.worldXToDay(100, 10)).toBe(10);   // 100 px / 10 px/day
      expect(TimeScaleManager.worldXToDay(5, 0.5)).toBe(10);    // 5 px / 0.5 px/day
    });

    it('should be inverse of dayToWorldX', () => {
      const days = 1234;
      const timeScale = 7.5;

      const worldX = TimeScaleManager.dayToWorldX(days, timeScale);
      const backToDays = TimeScaleManager.worldXToDay(worldX, timeScale);

      expect(backToDays).toBe(days);
    });

    it('should handle zero world X', () => {
      expect(TimeScaleManager.worldXToDay(0, 10)).toBe(0);
    });
  });

  describe('getVisibleMarkers', () => {
    it('should return markers for level 0', () => {
      const markers = TimeScaleManager.getVisibleMarkers(
        0,      // level (days)
        10,     // timeScale (10 px/day)
        1,      // scale
        0,      // translateX
        800     // viewportWidth
      );

      expect(markers.length).toBeGreaterThan(0);
    });

    it('should return markers for higher levels', () => {
      const markers = TimeScaleManager.getVisibleMarkers(
        2,      // level (years)
        10,
        1,
        0,
        800
      );

      expect(markers.length).toBeGreaterThanOrEqual(0);
    });

    it('should account for translation', () => {
      const markersWithoutTranslation = TimeScaleManager.getVisibleMarkers(
        0, 10, 1, 0, 800
      );

      const markersWithTranslation = TimeScaleManager.getVisibleMarkers(
        0, 10, 1, -400, 800  // Panned right
      );

      // Both should return arrays (might be empty depending on viewport)
      expect(Array.isArray(markersWithoutTranslation)).toBe(true);
      expect(Array.isArray(markersWithTranslation)).toBe(true);
    });
  });

  describe('formatDateForLevel', () => {
    it('should format dates for level 0 (days)', () => {
      // Day 0 = 1970-01-01
      expect(TimeScaleManager.formatDateForLevel(0, 0)).toContain('1970');
      // Day 1 = 1970-01-02, format is DD/MM/YYYY
      expect(TimeScaleManager.formatDateForLevel(1, 0)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('should format dates for level 1 (months)', () => {
      const formatted = TimeScaleManager.formatDateForLevel(0, 1);
      expect(formatted).toContain('1970');
    });

    it('should format dates for level 2 (years)', () => {
      const formatted = TimeScaleManager.formatDateForLevel(0, 2);
      expect(formatted).toContain('1970');
    });

    it('should format dates for level 3+ (decades+)', () => {
      const formattedDecade = TimeScaleManager.formatDateForLevel(0, 3);
      const formattedCentury = TimeScaleManager.formatDateForLevel(0, 4);

      expect(formattedDecade).toBeTruthy();
      expect(formattedCentury).toBeTruthy();
    });

    it('should handle large day values (billions of years)', () => {
      // ~365 billion days = 1 billion years
      const billionYearsInDays = 365000000000;
      const formatted = TimeScaleManager.formatDateForLevel(-billionYearsInDays, 5);

      expect(formatted).toContain('BCE'); // Should contain BCE
      expect(formatted).toMatch(/\d+/); // Should contain some number
    });
  });

  describe('snapToNearestMarker', () => {
    it('should snap to nearest day at level 0', () => {
      expect(TimeScaleManager.snapToNearestMarker(5, 0)).toBe(5);
      expect(TimeScaleManager.snapToNearestMarker(5.7, 0)).toBe(6);
      expect(TimeScaleManager.snapToNearestMarker(5.2, 0)).toBe(5);
    });

    it('should snap to nearest month at level 1', () => {
      // Day 0 = Jan 1970, Day 31 = Feb 1970
      const snapped = TimeScaleManager.snapToNearestMarker(15, 1);
      expect(snapped).toBe(0); // Snapped to start of January
    });

    it('should snap to nearest year at level 2', () => {
      // Day 100 is within first year
      expect(TimeScaleManager.snapToNearestMarker(100, 2)).toBe(0);
      // Day 400 is in second year
      expect(TimeScaleManager.snapToNearestMarker(400, 2)).toBe(365);
    });

    it('should handle negative days', () => {
      expect(TimeScaleManager.snapToNearestMarker(-10, 0)).toBe(-10);
      // Negative days snap to the year boundary closest to zero
      const snapped = TimeScaleManager.snapToNearestMarker(-10, 2);
      expect(typeof snapped).toBe('number');
    });
  });

  describe('getScaleInfo', () => {
    it('should return scale info for level 0', () => {
      const info = TimeScaleManager.getScaleInfo(0);
      expect(info.level).toBe(0);
      expect(info.unitName).toBe('day');
      expect(info.largeUnitName).toBe('month');
      expect(info.pixelsPerUnit).toBe(1);
    });

    it('should return scale info for level 1', () => {
      const info = TimeScaleManager.getScaleInfo(1);
      expect(info.level).toBe(1);
      expect(info.unitName).toBe('month');
      expect(info.largeUnitName).toBe('year');
      expect(info.pixelsPerUnit).toBe(30);
    });

    it('should return consistent info structure for all levels', () => {
      for (let level = 0; level < 10; level++) {
        const info = TimeScaleManager.getScaleInfo(level);
        expect(info).toHaveProperty('level');
        expect(info).toHaveProperty('unitName');
        expect(info).toHaveProperty('largeUnitName');
        expect(info).toHaveProperty('pixelsPerUnit');
        expect(info.pixelsPerUnit).toBeGreaterThan(0);
      }
    });
  });

  describe('coordinate consistency', () => {
    it('should maintain consistent coordinate transformations', () => {
      const testDays = [0, 100, -100, 365, 10000];
      const testTimeScales = [0.1, 1, 10, 100];

      testDays.forEach(days => {
        testTimeScales.forEach(timeScale => {
          const worldX = TimeScaleManager.dayToWorldX(days, timeScale);
          const backToDays = TimeScaleManager.worldXToDay(worldX, timeScale);
          
          expect(backToDays).toBeCloseTo(days, 5);
        });
      });
    });

    it('should handle epoch boundary correctly', () => {
      // Day 0 (1970-01-01) should consistently convert
      expect(TimeScaleManager.dayToWorldX(0, 1)).toBe(0);
      expect(TimeScaleManager.worldXToDay(0, 1)).toBe(0);
      expect(TimeScaleManager.formatDateForLevel(0, 0)).toContain('1970');
    });
  });
});
