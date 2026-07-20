// __tests__/sis/backfill/attendance/day-classifier.test.ts
import { describe, expect, it } from 'vitest';

import {
  classifyDates,
  type LegendRange,
} from '@/lib/sis/backfill/attendance/day-classifier';

describe('classifyDates', () => {
  it('classifies a non-blank date as school_day with no label', () => {
    const result = classifyDates(['2026-01-08'], new Set(), []);
    expect(result).toEqual([
      {
        date: '2026-01-08',
        dayType: 'school_day',
        hblOverlay: false,
        label: null,
      },
    ]);
  });

  it('classifies a blank date with no legend match as no_class', () => {
    const result = classifyDates(['2026-02-17'], new Set(['2026-02-17']), []);
    expect(result).toEqual([
      {
        date: '2026-02-17',
        dayType: 'no_class',
        hblOverlay: false,
        label: null,
      },
    ]);
  });

  it('classifies a blank date matching a schoolHoliday legend entry as public_holiday', () => {
    const legendRanges: LegendRange[] = [
      {
        startDate: '2026-02-17',
        endDate: '2026-02-18',
        label: 'CNY',
        column: 'schoolHoliday',
      },
    ];
    const result = classifyDates(
      ['2026-02-17', '2026-02-18'],
      new Set(['2026-02-17', '2026-02-18']),
      legendRanges
    );
    expect(result).toEqual([
      {
        date: '2026-02-17',
        dayType: 'public_holiday',
        hblOverlay: false,
        label: 'CNY',
      },
      {
        date: '2026-02-18',
        dayType: 'public_holiday',
        hblOverlay: false,
        label: 'CNY',
      },
    ]);
  });

  it('classifies a blank date matching only an importantDates legend entry as no_class', () => {
    const legendRanges: LegendRange[] = [
      {
        startDate: '2026-03-06',
        endDate: '2026-03-06',
        label: 'T1 Marking Day',
        column: 'importantDates',
      },
    ];
    const result = classifyDates(
      ['2026-03-06'],
      new Set(['2026-03-06']),
      legendRanges
    );
    expect(result).toEqual([
      {
        date: '2026-03-06',
        dayType: 'no_class',
        hblOverlay: false,
        label: 'T1 Marking Day',
      },
    ]);
  });

  it('classifies a blank date whose legend text mentions HBL as school_holiday with the overlay set', () => {
    const legendRanges: LegendRange[] = [
      {
        startDate: '2026-02-20',
        endDate: '2026-02-20',
        label: "HBL, Staff Dev't Day",
        column: 'importantDates',
      },
    ];
    const result = classifyDates(
      ['2026-02-20'],
      new Set(['2026-02-20']),
      legendRanges
    );
    expect(result).toEqual([
      {
        date: '2026-02-20',
        dayType: 'school_holiday',
        hblOverlay: true,
        label: "HBL, Staff Dev't Day",
      },
    ]);
  });

  it('prefers an HBL match over a schoolHoliday match on the same date', () => {
    const legendRanges: LegendRange[] = [
      {
        startDate: '2026-02-20',
        endDate: '2026-02-20',
        label: 'Some Holiday',
        column: 'schoolHoliday',
      },
      {
        startDate: '2026-02-20',
        endDate: '2026-02-20',
        label: 'HBL Day',
        column: 'importantDates',
      },
    ];
    const result = classifyDates(
      ['2026-02-20'],
      new Set(['2026-02-20']),
      legendRanges
    );
    expect(result[0].dayType).toBe('school_holiday');
    expect(result[0].hblOverlay).toBe(true);
  });

  it('classifies a full mixed date list correctly and preserves input order', () => {
    const legendRanges: LegendRange[] = [
      {
        startDate: '2026-02-17',
        endDate: '2026-02-18',
        label: 'CNY',
        column: 'schoolHoliday',
      },
    ];
    const result = classifyDates(
      ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19'],
      new Set(['2026-02-17', '2026-02-18']),
      legendRanges
    );
    expect(result.map((r) => r.dayType)).toEqual([
      'school_day',
      'public_holiday',
      'public_holiday',
      'school_day',
    ]);
  });
});
