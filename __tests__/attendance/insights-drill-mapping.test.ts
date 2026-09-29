import { describe, expect, it } from 'vitest';

import {
  buildTermWindowMap,
  MIX_SERIES_TARGET,
  MIX_SLICE_TARGET,
  resolveSelectedTermId,
  termWindowFor,
} from '@/lib/attendance/insights-drill';

describe('attendance mix → drill target', () => {
  it('maps every pie slice the Insights page draws', () => {
    expect(MIX_SLICE_TARGET).toEqual({
      Present: 'present',
      Late: 'lates',
      Excused: 'excused',
      Absent: 'absent',
    });
  });

  it('maps every composition series key the Insights page draws', () => {
    expect(MIX_SERIES_TARGET).toEqual({
      present: 'present',
      late: 'lates',
      excused: 'excused',
      absent: 'absent',
    });
  });
});

describe('term windows per year', () => {
  const map = buildTermWindowMap([
    {
      ayCode: 'AY2026',
      byNumber: {
        1: { from: '2026-01-05', to: '2026-03-13' },
        2: { from: '2026-03-23', to: '2026-05-29' },
        3: null,
        4: null,
      },
    },
    {
      ayCode: 'AY2025',
      byNumber: {
        1: { from: '2025-01-06', to: '2025-03-14' },
        2: { from: '2025-03-24', to: '2025-05-30' },
        3: { from: '2025-06-23', to: '2025-09-05' },
        4: null,
      },
    },
  ]);

  it('returns the window of the year that was clicked, not the page year', () => {
    expect(termWindowFor(map, 'AY2025', 'T2')).toEqual({
      from: '2025-03-24',
      to: '2025-05-30',
    });
    expect(termWindowFor(map, 'AY2026', 'T2')).toEqual({
      from: '2026-03-23',
      to: '2026-05-29',
    });
  });

  it('returns null for a term with no dates, or a year it was not given', () => {
    expect(termWindowFor(map, 'AY2026', 'T3')).toBeNull();
    expect(termWindowFor(map, 'AY2024', 'T1')).toBeNull();
  });
});

describe('resolveSelectedTermId', () => {
  const terms = [
    { id: 't1', term_number: 1 },
    { id: 't2', term_number: 2 },
    { id: 't3', term_number: 3 },
  ];

  it('returns the id of the term the picker selected', () => {
    expect(resolveSelectedTermId(terms, 2)).toBe('t2');
  });

  it('returns null when the year has no row for that term', () => {
    expect(resolveSelectedTermId(terms, 4)).toBeNull();
  });
});
