import { describe, expect, it } from 'vitest';
import {
  summarizeMarks,
  summarizeByMonth,
  currentTermMonthsFromRaw,
  buildTermSummaryRows,
  monthsInRange,
  type TermSummaryEnrolment,
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

describe('currentTermMonthsFromRaw', () => {
  it('dedupes to the latest recordedAt per (date, periodId), then buckets by month', () => {
    const months = currentTermMonthsFromRaw([
      {
        date: '2026-07-01',
        status: 'A',
        periodId: null,
        recordedAt: '2026-07-01T08:00:00Z',
      },
      {
        // Correction on the same day — later recordedAt wins.
        date: '2026-07-01',
        status: 'P',
        periodId: null,
        recordedAt: '2026-07-01T09:00:00Z',
      },
      {
        date: '2026-06-29',
        status: 'P',
        periodId: null,
        recordedAt: '2026-06-29T08:00:00Z',
      },
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(months[1].stat).toMatchObject({
      present: 1,
      absent: 0,
      totalDays: 1,
    });
  });

  it('returns an empty array for no rows', () => {
    expect(currentTermMonthsFromRaw([])).toEqual([]);
  });
});

describe('monthsInRange', () => {
  it('returns distinct, sorted month keys with labels from a calendar range', () => {
    const months = monthsInRange([
      { date: '2026-06-29' },
      { date: '2026-06-30' },
      { date: '2026-07-01' },
      { date: '2026-08-15' },
    ]);
    expect(months).toEqual([
      { month: '2026-06', label: 'June 2026' },
      { month: '2026-07', label: 'July 2026' },
      { month: '2026-08', label: 'August 2026' },
    ]);
  });

  it('returns an empty array for an empty calendar', () => {
    expect(monthsInRange([])).toEqual([]);
  });
});

describe('buildTermSummaryRows', () => {
  const calendar = [
    { date: '2026-06-29' },
    { date: '2026-06-30' },
    { date: '2026-07-01' },
  ];

  const normal: TermSummaryEnrolment = {
    enrolmentId: 'e1',
    indexNumber: 1,
    studentName: 'DOE, Jane',
    withdrawn: false,
    enrollmentDate: null,
  };

  it('builds a per-month + term breakdown per student from the calendar and daily marks', () => {
    const rows = buildTermSummaryRows([normal], calendar, [
      { sectionStudentId: 'e1', date: '2026-06-29', status: 'P' },
      { sectionStudentId: 'e1', date: '2026-06-30', status: 'A' },
      { sectionStudentId: 'e1', date: '2026-07-01', status: 'P' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(rows[0].months[0].stat).toMatchObject({
      present: 1,
      absent: 1,
      totalDays: 2,
    });
    expect(rows[0].term).toMatchObject({ present: 2, absent: 1, totalDays: 3 });
  });

  it('excludes calendar dates before enrollmentDate (late-enrollee proration)', () => {
    const lateEnrollee: TermSummaryEnrolment = {
      ...normal,
      enrolmentId: 'e2',
      enrollmentDate: '2026-07-01',
    };
    const rows = buildTermSummaryRows([lateEnrollee], calendar, [
      // A back-dated row before enrollment — must be excluded.
      { sectionStudentId: 'e2', date: '2026-06-29', status: 'P' },
      { sectionStudentId: 'e2', date: '2026-07-01', status: 'P' },
    ]);
    expect(rows[0].months.map((m) => m.month)).toEqual(['2026-07']);
    expect(rows[0].term).toMatchObject({ totalDays: 1, present: 1 });
  });

  it('produces a zero-stat month for a student with no marks in a calendar-covered month', () => {
    const rows = buildTermSummaryRows([normal], calendar, []);
    expect(rows[0].months.map((m) => m.month)).toEqual([]);
    expect(rows[0].term).toMatchObject({ totalDays: 0, attendancePct: null });
  });

  it('preserves enrolment identity fields on the row', () => {
    const rows = buildTermSummaryRows([normal], calendar, []);
    expect(rows[0].enrolment).toEqual(normal);
  });
});
