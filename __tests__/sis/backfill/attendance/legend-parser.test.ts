import { describe, expect, it } from 'vitest';

import {
  parseLegendDateRange,
  resolveDate,
  resolveHeaderDate,
} from '@/lib/sis/backfill/attendance/legend-parser';

describe('resolveDate', () => {
  it('resolves a 3-letter month abbreviation', () => {
    expect(resolveDate('Feb', 17, 2026)).toBe('2026-02-17');
  });

  it('pads single-digit days and handles December', () => {
    expect(resolveDate('Dec', 6, 2026)).toBe('2026-12-06');
  });

  it('returns null for an unrecognized month', () => {
    expect(resolveDate('Xyz', 1, 2026)).toBeNull();
  });
});

describe('resolveHeaderDate', () => {
  it('resolves a "Day-Mon" header cell', () => {
    expect(resolveHeaderDate('8-Jan', 2026)).toBe('2026-01-08');
  });

  it('resolves a two-digit day', () => {
    expect(resolveHeaderDate('13-Mar', 2026)).toBe('2026-03-13');
  });

  it('returns null for a malformed header', () => {
    expect(resolveHeaderDate('Days present', 2026)).toBeNull();
  });
});

describe('parseLegendDateRange', () => {
  it('parses a date range with no leading dash', () => {
    expect(parseLegendDateRange('Feb 17-18 CNY', 2026)).toEqual({
      startDate: '2026-02-17',
      endDate: '2026-02-18',
      label: 'CNY',
    });
  });

  it('tolerates double spaces before the label', () => {
    expect(parseLegendDateRange('Feb 17-18  CNY', 2026)).toEqual({
      startDate: '2026-02-17',
      endDate: '2026-02-18',
      label: 'CNY',
    });
  });

  it('parses a single date with a leading dash', () => {
    expect(parseLegendDateRange('Mar 6 - Marking Day', 2026)).toEqual({
      startDate: '2026-03-06',
      endDate: '2026-03-06',
      label: 'Marking Day',
    });
  });

  it('parses a single date with no dash', () => {
    expect(parseLegendDateRange('Mar 6 T1 Marking Day', 2026)).toEqual({
      startDate: '2026-03-06',
      endDate: '2026-03-06',
      label: 'T1 Marking Day',
    });
  });

  it('preserves a comma-containing label mentioning HBL', () => {
    expect(parseLegendDateRange("Feb 20 - HBL, Staff Dev't Day", 2026)).toEqual(
      {
        startDate: '2026-02-20',
        endDate: '2026-02-20',
        label: "HBL, Staff Dev't Day",
      }
    );
  });

  it('parses a multi-day range with a leading dash', () => {
    expect(parseLegendDateRange('Mar 4-5 Term 1 Exams', 2026)).toEqual({
      startDate: '2026-03-04',
      endDate: '2026-03-05',
      label: 'Term 1 Exams',
    });
  });

  it('returns null for text with no leading month/day pattern', () => {
    expect(parseLegendDateRange('DO NOT DELETE OR EDIT', 2026)).toBeNull();
  });
});
