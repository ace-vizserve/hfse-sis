import { describe, expect, it } from 'vitest';
import {
  summarizeMarks,
  summarizeByMonth,
} from '@/lib/attendance/sheet-summary';

describe('summarizeMarks', () => {
  it('counts P/L/EX/A and computes % as (P+L+EX)/total', () => {
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'L' },
      { date: '2026-07-01', status: 'EX' },
      { date: '2026-07-02', status: 'A' },
    ]);
    expect(stat).toEqual({
      totalDays: 4,
      present: 1,
      late: 1,
      excused: 1,
      absent: 1,
      attendancePct: 75, // (1+1+1)/4 = 75.0
    });
  });

  it('excludes NC and null from both numerator and denominator', () => {
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'NC' },
      { date: '2026-07-01', status: null },
    ]);
    expect(stat.totalDays).toBe(1);
    expect(stat.attendancePct).toBe(100);
  });

  it('returns null % when there are no counted marks', () => {
    expect(
      summarizeMarks([{ date: '2026-06-29', status: 'NC' }]).attendancePct
    ).toBeNull();
    expect(summarizeMarks([]).attendancePct).toBeNull();
  });

  it('rounds % to 1 decimal place', () => {
    // 2 present of 3 marked = 66.666… → 66.7
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'P' },
      { date: '2026-07-01', status: 'A' },
    ]);
    expect(stat.attendancePct).toBe(66.7);
  });
});

describe('summarizeByMonth', () => {
  it('buckets by calendar month (sorted) and returns a term total', () => {
    const { months, term } = summarizeByMonth([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-07-01', status: 'A' },
      { date: '2026-07-02', status: 'P' },
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(months[0].label).toBe('June 2026');
    expect(months[1].stat).toMatchObject({
      present: 1,
      absent: 1,
      totalDays: 2,
    });
    expect(term).toMatchObject({ present: 2, absent: 1, totalDays: 3 });
  });
});
