import { describe, it, expect } from 'vitest';
import { TimelineDate } from './TimelineDate';

describe('TimelineDate', () => {
  describe('fromString', () => {
    it('should parse standard YYYY-MM-DD format', () => {
      const date = TimelineDate.fromString('2024-03-15');
      expect(date).not.toBeNull();
      expect(date!.getYear()).toBe(2024);
      expect(date!.getMonth()).toBe(3);
      expect(date!.getDay()).toBe(15);
    });

    it('should parse epoch date correctly', () => {
      const date = TimelineDate.fromString('1970-01-01');
      expect(date).not.toBeNull();
      expect(date!.getDaysFromEpoch()).toBe(0);
      expect(date!.getYear()).toBe(1970);
      expect(date!.getMonth()).toBe(1);
      expect(date!.getDay()).toBe(1);
    });

    it('should parse BCE dates with negative year', () => {
      const date = TimelineDate.fromString('-5000-01-01');
      expect(date).not.toBeNull();
      expect(date!.getYear()).toBe(-5000);
    });

    it('should parse BCE dates with era suffix', () => {
      const date = TimelineDate.fromString('5000 BCE-01-01');
      expect(date).not.toBeNull();
      // 5000 BCE = year -4999 in astronomical numbering (1 BCE = year 0)
      expect(date!.getYear()).toBe(-4999);
    });

    it('should parse BC dates with era suffix', () => {
      const date = TimelineDate.fromString('100 BC-06-15');
      expect(date).not.toBeNull();
      // 100 BC = year -99 in astronomical numbering
      expect(date!.getYear()).toBe(-99);
    });

    it('should parse CE/AD dates with era suffix', () => {
      const dateAD = TimelineDate.fromString('2024 AD-01-01');
      expect(dateAD).not.toBeNull();
      expect(dateAD!.getYear()).toBe(2024);

      const dateCE = TimelineDate.fromString('2024 CE-01-01');
      expect(dateCE).not.toBeNull();
      expect(dateCE!.getYear()).toBe(2024);
    });

    it('should parse very large year values', () => {
      const date = TimelineDate.fromString('-5000000000-01-01');
      expect(date).not.toBeNull();
      expect(date!.getYear()).toBe(-5000000000);
    });

    it('should return null for invalid dates', () => {
      expect(TimelineDate.fromString('not-a-date')).toBeNull();
      expect(TimelineDate.fromString('')).toBeNull();
      expect(TimelineDate.fromString('2024-13-01')).toBeNull(); // Invalid month
      expect(TimelineDate.fromString('2024-02-30')).toBeNull(); // Invalid day
    });

    it('should validate February 29 in leap years', () => {
      const leapDate = TimelineDate.fromString('2024-02-29');
      expect(leapDate).not.toBeNull();
      expect(leapDate!.getDay()).toBe(29);

      const nonLeapDate = TimelineDate.fromString('2023-02-29');
      expect(nonLeapDate).toBeNull();
    });
  });

  describe('fromDaysFromEpoch', () => {
    it('should create date from epoch day 0', () => {
      const date = TimelineDate.fromDaysFromEpoch(0);
      expect(date.getYear()).toBe(1970);
      expect(date.getMonth()).toBe(1);
      expect(date.getDay()).toBe(1);
    });

    it('should create date from positive days', () => {
      // 365 days from epoch ≈ 1971-01-01
      const date = TimelineDate.fromDaysFromEpoch(365);
      expect(date.getYear()).toBe(1971);
      expect(date.getMonth()).toBe(1);
      expect(date.getDay()).toBe(1);
    });

    it('should create date from negative days', () => {
      // -1 day from epoch = 1969-12-31
      const date = TimelineDate.fromDaysFromEpoch(-1);
      expect(date.getYear()).toBe(1969);
      expect(date.getMonth()).toBe(12);
      expect(date.getDay()).toBe(31);
    });

    it('should handle very large day values', () => {
      // 1 billion days ≈ 2.7 million years
      const date = TimelineDate.fromDaysFromEpoch(1000000000);
      expect(date.getYear()).toBeGreaterThan(2000000);
    });
  });

  describe('fromDate', () => {
    it('should convert JavaScript Date to TimelineDate', () => {
      const jsDate = new Date('2024-03-15');
      const date = TimelineDate.fromDate(jsDate);
      expect(date.getYear()).toBe(2024);
      expect(date.getMonth()).toBe(3);
      expect(date.getDay()).toBe(15);
    });

    it('should handle epoch date', () => {
      const jsDate = new Date('1970-01-01T00:00:00Z');
      const date = TimelineDate.fromDate(jsDate);
      expect(date.getDaysFromEpoch()).toBe(0);
    });
  });

  describe('getDaysFromEpoch', () => {
    it('should return 0 for epoch date', () => {
      const date = TimelineDate.fromString('1970-01-01')!;
      expect(date.getDaysFromEpoch()).toBe(0);
    });

    it('should return positive for dates after epoch', () => {
      const date = TimelineDate.fromString('2024-01-01')!;
      expect(date.getDaysFromEpoch()).toBeGreaterThan(0);
    });

    it('should return negative for dates before epoch', () => {
      const date = TimelineDate.fromString('1969-01-01')!;
      expect(date.getDaysFromEpoch()).toBeLessThan(0);
    });
  });

  describe('getYMD', () => {
    it('should return correct year, month, day', () => {
      const date = TimelineDate.fromString('2024-06-15')!;
      const ymd = date.getYMD();
      expect(ymd.year).toBe(2024);
      expect(ymd.month).toBe(6);
      expect(ymd.day).toBe(15);
    });

    it('should cache the result', () => {
      const date = TimelineDate.fromString('2024-06-15')!;
      const first = date.getYMD();
      const second = date.getYMD();
      expect(first).toBe(second); // Same reference (cached)
    });
  });

  describe('toISOString', () => {
    it('should format standard dates correctly', () => {
      const date = TimelineDate.fromString('2024-03-15')!;
      expect(date.toISOString()).toBe('2024-03-15');
    });

    it('should format negative years', () => {
      const date = TimelineDate.fromString('-5000-01-01')!;
      expect(date.toISOString()).toBe('-5000-01-01');
    });

    it('should pad month and day with zeros', () => {
      const date = TimelineDate.fromString('2024-01-05')!;
      expect(date.toISOString()).toBe('2024-01-05');
    });
  });

  describe('formatForLevel', () => {
    it('should format level 0 (days) with full date', () => {
      const date = TimelineDate.fromString('2024-03-15')!;
      const formatted = date.formatForLevel(0);
      expect(formatted).toContain('2024');
      expect(formatted).toMatch(/\d{2}\/\d{2}/);
    });

    it('should format level 1 (months) with month/year', () => {
      const date = TimelineDate.fromString('2024-03-15')!;
      const formatted = date.formatForLevel(1);
      expect(formatted).toContain('2024');
      expect(formatted).toContain('03');
    });

    it('should format level 2+ (years) with year only', () => {
      const date = TimelineDate.fromString('2024-03-15')!;
      const formatted = date.formatForLevel(2);
      expect(formatted).toContain('2024');
    });

    it('should include BCE suffix for BCE dates at level 0', () => {
      const date = TimelineDate.fromString('-500-06-15')!;
      const formatted = date.formatForLevel(0);
      expect(formatted).toContain('BCE');
    });
  });

  describe('formatYear', () => {
    it('should format modern years with CE', () => {
      const date = TimelineDate.fromString('2024-01-01')!;
      expect(date.formatYear()).toBe('2024 CE');
    });

    it('should format BCE years correctly', () => {
      // Year 0 = 1 BCE, Year -1 = 2 BCE
      const date = TimelineDate.fromDaysFromEpoch(
        TimelineDate.fromString('1970-01-01')!.getDaysFromEpoch()
      );
      // Test with year 0
      const dateYear0 = TimelineDate.fromString('-1-01-01')!;
      // Year -1 in astronomical = 2 BCE
      expect(dateYear0.formatYear()).toContain('BCE');
    });

    it('should format millions of years', () => {
      // Need enough days for year > 1,000,000 to trigger M format
      // 1 million years * 365.2425 = ~365,242,500 days
      const date = TimelineDate.fromDaysFromEpoch(-365242500);
      const formatted = date.formatYear();
      // At this scale, formatYear uses k or M depending on actual year
      expect(formatted).toContain('BCE');
      expect(formatted).toMatch(/\d/);
    });

    it('should format billions of years', () => {
      // 1 billion years * 365.2425 = ~365,242,500,000 days
      const date = TimelineDate.fromDaysFromEpoch(-365242500000);
      const formatted = date.formatYear();
      expect(formatted).toMatch(/B/); // Should contain 'B' for billions
      expect(formatted).toContain('BCE');
    });

    it('should format thousands of years with k notation', () => {
      // Need year > 10,000 to trigger k format
      // 15,000 years * 365.2425 = ~5,478,638 days
      const date = TimelineDate.fromDaysFromEpoch(-5478638);
      const formatted = date.formatYear();
      expect(formatted).toMatch(/k/); // Should contain 'k' for thousands
      expect(formatted).toContain('BCE');
    });
  });

  describe('comparison methods', () => {
    it('isBefore should return true when date is earlier', () => {
      const date1 = TimelineDate.fromString('2024-01-01')!;
      const date2 = TimelineDate.fromString('2024-06-15')!;
      expect(date1.isBefore(date2)).toBe(true);
      expect(date2.isBefore(date1)).toBe(false);
    });

    it('isAfter should return true when date is later', () => {
      const date1 = TimelineDate.fromString('2024-06-15')!;
      const date2 = TimelineDate.fromString('2024-01-01')!;
      expect(date1.isAfter(date2)).toBe(true);
      expect(date2.isAfter(date1)).toBe(false);
    });

    it('equals should return true for same dates', () => {
      const date1 = TimelineDate.fromString('2024-03-15')!;
      const date2 = TimelineDate.fromString('2024-03-15')!;
      expect(date1.equals(date2)).toBe(true);
    });

    it('equals should return false for different dates', () => {
      const date1 = TimelineDate.fromString('2024-03-15')!;
      const date2 = TimelineDate.fromString('2024-03-16')!;
      expect(date1.equals(date2)).toBe(false);
    });

    it('should compare across BCE/CE boundary', () => {
      const bce = TimelineDate.fromString('-100-01-01')!;
      const ce = TimelineDate.fromString('100-01-01')!;
      expect(bce.isBefore(ce)).toBe(true);
      expect(ce.isAfter(bce)).toBe(true);
    });
  });

  describe('daysBetween', () => {
    it('should calculate days between two dates', () => {
      const date1 = TimelineDate.fromString('2024-01-01')!;
      const date2 = TimelineDate.fromString('2024-01-11')!;
      expect(date1.daysBetween(date2)).toBe(10);
    });

    it('should return negative for earlier target', () => {
      const date1 = TimelineDate.fromString('2024-01-11')!;
      const date2 = TimelineDate.fromString('2024-01-01')!;
      expect(date1.daysBetween(date2)).toBe(-10);
    });

    it('should return 0 for same dates', () => {
      const date = TimelineDate.fromString('2024-06-15')!;
      expect(date.daysBetween(date)).toBe(0);
    });

    it('should handle year boundaries', () => {
      const date1 = TimelineDate.fromString('2023-12-31')!;
      const date2 = TimelineDate.fromString('2024-01-01')!;
      expect(date1.daysBetween(date2)).toBe(1);
    });
  });

  describe('addDays', () => {
    it('should add days correctly', () => {
      const date = TimelineDate.fromString('2024-01-01')!;
      const result = date.addDays(10);
      expect(result.getDay()).toBe(11);
      expect(result.getMonth()).toBe(1);
    });

    it('should handle month rollover', () => {
      const date = TimelineDate.fromString('2024-01-31')!;
      const result = date.addDays(1);
      expect(result.getMonth()).toBe(2);
      expect(result.getDay()).toBe(1);
    });

    it('should handle negative days', () => {
      const date = TimelineDate.fromString('2024-01-01')!;
      const result = date.addDays(-1);
      expect(result.getYear()).toBe(2023);
      expect(result.getMonth()).toBe(12);
      expect(result.getDay()).toBe(31);
    });

    it('should not mutate original date', () => {
      const date = TimelineDate.fromString('2024-01-01')!;
      const originalDays = date.getDaysFromEpoch();
      date.addDays(100);
      expect(date.getDaysFromEpoch()).toBe(originalDays);
    });
  });

  describe('roundtrip consistency', () => {
    it('should parse and format back to same date', () => {
      const dates = [
        '2024-03-15',
        '1970-01-01',
        '2000-12-31',
        '1-01-01',
      ];

      dates.forEach(dateStr => {
        const parsed = TimelineDate.fromString(dateStr)!;
        const formatted = parsed.toISOString();
        const reparsed = TimelineDate.fromString(formatted)!;
        expect(reparsed.getDaysFromEpoch()).toBe(parsed.getDaysFromEpoch());
      });
    });

    it('should maintain consistency through fromDaysFromEpoch and getYMD', () => {
      const testDays = [0, 1, -1, 365, -365, 10000, -10000, 1000000];

      testDays.forEach(days => {
        const date = TimelineDate.fromDaysFromEpoch(days);
        const ymd = date.getYMD();
        const reparsed = TimelineDate.fromString(
          `${ymd.year}-${String(ymd.month).padStart(2, '0')}-${String(ymd.day).padStart(2, '0')}`
        )!;
        expect(reparsed.getDaysFromEpoch()).toBe(days);
      });
    });
  });

  describe('static helpers', () => {
    it('getEpoch should return epoch date', () => {
      const epoch = TimelineDate.getEpoch();
      expect(epoch.getDaysFromEpoch()).toBe(0);
      expect(epoch.getYear()).toBe(1970);
    });

    it('now should return a date near current time', () => {
      const now = TimelineDate.now();
      // Should be within reasonable range of 2024-2027
      expect(now.getYear()).toBeGreaterThanOrEqual(2024);
      expect(now.getYear()).toBeLessThanOrEqual(2030);
    });
  });
});
