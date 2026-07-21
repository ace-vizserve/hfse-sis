// __tests__/sis/backfill/attendance/day-classifier-t3.test.ts
import { describe, expect, it } from 'vitest';

import { classifyDatesT3 } from '@/lib/sis/backfill/attendance/day-classifier-t3';

describe('classifyDatesT3', () => {
  it('classifies an SH-tagged date as school_holiday with its label, no event', () => {
    const result = classifyDatesT3(
      ['2026-07-06'],
      new Map([['2026-07-06', 'SH']]),
      new Map([['2026-07-06', 'In Lieu of Youth Day']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-06',
        dayType: 'school_holiday',
        label: 'In Lieu of Youth Day',
        event: null,
      },
    ]);
  });

  it('classifies a PH-tagged date as public_holiday with its label, no event', () => {
    const result = classifyDatesT3(
      ['2026-08-09'],
      new Map([['2026-08-09', 'PH']]),
      new Map([['2026-08-09', 'National Day']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-08-09',
        dayType: 'public_holiday',
        label: 'National Day',
        event: null,
      },
    ]);
  });

  it('classifies an SE-tagged date as school_day with a school_event, when a label was found', () => {
    const result = classifyDatesT3(
      ['2026-07-21'],
      new Map([['2026-07-21', 'SE']]),
      new Map([['2026-07-21', 'Racial Harmony Celebration']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-21',
        dayType: 'school_day',
        label: 'Racial Harmony Celebration',
        event: {
          category: 'school_event',
          label: 'Racial Harmony Celebration',
          labelMissing: false,
        },
      },
    ]);
  });

  it('classifies an EX-tagged date as school_day with a term_exam event', () => {
    const result = classifyDatesT3(
      ['2026-08-26'],
      new Map([['2026-08-26', 'EX']]),
      new Map([['2026-08-26', 'Term 3 Exam (Math, English)']]),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-08-26',
        dayType: 'school_day',
        label: 'Term 3 Exam (Math, English)',
        event: {
          category: 'term_exam',
          label: 'Term 3 Exam (Math, English)',
          labelMissing: false,
        },
      },
    ]);
  });

  it('flags a tagged date with no matching legend entry as labelMissing, never guessing a label', () => {
    const result = classifyDatesT3(
      ['2026-07-27'],
      new Map([['2026-07-27', 'SE']]),
      new Map(),
      new Set()
    );
    expect(result).toEqual([
      {
        date: '2026-07-27',
        dayType: 'school_day',
        label: null,
        event: { category: 'school_event', label: null, labelMissing: true },
      },
    ]);
  });

  it('classifies an untagged date with a real mark as school_day', () => {
    const result = classifyDatesT3(
      ['2026-06-29'],
      new Map(),
      new Map(),
      new Set()
    );
    expect(result).toEqual([
      { date: '2026-06-29', dayType: 'school_day', label: null, event: null },
    ]);
  });

  it('classifies an untagged, all-blank date (a weekend/gap) as no_class', () => {
    const result = classifyDatesT3(
      ['2026-07-04'],
      new Map(),
      new Map(),
      new Set(['2026-07-04'])
    );
    expect(result).toEqual([
      { date: '2026-07-04', dayType: 'no_class', label: null, event: null },
    ]);
  });

  it('preserves input order across a mixed date list', () => {
    const result = classifyDatesT3(
      ['2026-07-06', '2026-06-29', '2026-07-04'],
      new Map([['2026-07-06', 'SH']]),
      new Map([['2026-07-06', 'In Lieu of Youth Day']]),
      new Set(['2026-07-04'])
    );
    expect(result.map((r) => r.dayType)).toEqual([
      'school_holiday',
      'school_day',
      'no_class',
    ]);
  });
});
