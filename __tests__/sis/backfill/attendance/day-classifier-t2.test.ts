import { describe, expect, it } from 'vitest';

import {
  classifyDatesT2,
  PUBLIC_HOLIDAY_WHITELIST,
} from '@/lib/sis/backfill/attendance/day-classifier-t2';

describe('classifyDatesT2', () => {
  it('classifies a non-blank date as school_day, ignoring any label present', () => {
    const result = classifyDatesT2(
      ['2026-04-06'],
      new Set(),
      new Map([['2026-04-06', 'English Week']])
    );
    expect(result).toEqual([
      {
        date: '2026-04-06',
        dayType: 'school_day',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      },
    ]);
  });

  it('classifies a blank date with no label as no_class, not flagged', () => {
    const result = classifyDatesT2(
      ['2026-04-10'],
      new Set(['2026-04-10']),
      new Map()
    );
    expect(result).toEqual([
      {
        date: '2026-04-10',
        dayType: 'no_class',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      },
    ]);
  });

  it.each(PUBLIC_HOLIDAY_WHITELIST)(
    'classifies a blank date labeled exactly "%s" as public_holiday, not flagged',
    (holidayName) => {
      const result = classifyDatesT2(
        ['2026-04-03'],
        new Set(['2026-04-03']),
        new Map([['2026-04-03', holidayName]])
      );
      expect(result[0]).toEqual({
        date: '2026-04-03',
        dayType: 'public_holiday',
        hblOverlay: false,
        label: holidayName,
        needsConfirmation: false,
      });
    }
  );

  it('classifies a blank date whose label mentions HBL (case-insensitive) as school_holiday with the overlay set, not flagged', () => {
    const result = classifyDatesT2(
      ['2026-04-24'],
      new Set(['2026-04-24']),
      new Map([['2026-04-24', 'hbl - Marking Day']])
    );
    expect(result[0]).toEqual({
      date: '2026-04-24',
      dayType: 'school_holiday',
      hblOverlay: true,
      label: 'hbl - Marking Day',
      needsConfirmation: false,
    });
  });

  it('classifies a blank date with an unrecognized label as no_class AND flags it for confirmation', () => {
    const result = classifyDatesT2(
      ['2026-04-13'],
      new Set(['2026-04-13']),
      new Map([['2026-04-13', 'Student Recollection']])
    );
    expect(result[0]).toEqual({
      date: '2026-04-13',
      dayType: 'no_class',
      hblOverlay: false,
      label: 'Student Recollection',
      needsConfirmation: true,
    });
  });

  it('never guesses public_holiday from a partial/near match to the whitelist', () => {
    const result = classifyDatesT2(
      ['2026-05-01'],
      new Set(['2026-05-01']),
      new Map([['2026-05-01', 'Labor Day (in lieu)']])
    );
    expect(result[0].dayType).toBe('no_class');
    expect(result[0].needsConfirmation).toBe(true);
  });

  it('classifies a full mixed date list correctly and preserves input order', () => {
    const result = classifyDatesT2(
      ['2026-04-02', '2026-04-03', '2026-04-13', '2026-04-06'],
      new Set(['2026-04-03', '2026-04-13']),
      new Map([
        ['2026-04-03', 'Good Friday'],
        ['2026-04-13', 'Student Recollection'],
      ])
    );
    expect(result.map((r) => r.dayType)).toEqual([
      'school_day',
      'public_holiday',
      'no_class',
      'school_day',
    ]);
    expect(result.map((r) => r.needsConfirmation)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });
});
