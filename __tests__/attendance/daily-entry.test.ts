import { describe, expect, it } from 'vitest';
import {
  encodableDates,
  pickDefaultDate,
  loadedMarksForDate,
  computeSubmitEntries,
  tally,
  type DailyMark,
} from '@/lib/attendance/daily-entry';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';

function cal(
  date: string,
  dayType: SchoolCalendarRow['dayType'],
  hblOverlay = false
): SchoolCalendarRow {
  return {
    id: date,
    termId: 't1',
    date,
    dayType,
    isHoliday: dayType !== 'school_day' && dayType !== 'hbl',
    label: null,
    audience: 'all',
    hblOverlay,
  };
}
function enr(
  id: string,
  idx: number,
  over: Partial<WideGridEnrolment> = {}
): WideGridEnrolment {
  return {
    enrolmentId: id,
    indexNumber: idx,
    studentNumber: 'S' + idx,
    studentName: 'Name ' + idx,
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: false,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
    ...over,
  };
}
function daily(
  sectionStudentId: string,
  date: string,
  status: DailyEntryRow['status'],
  exReason: DailyEntryRow['exReason'] = null
): DailyEntryRow {
  return {
    id: `${sectionStudentId}-${date}`,
    sectionStudentId,
    termId: 't1',
    date,
    status,
    exReason,
    periodId: null,
    recordedBy: null,
    recordedAt: '2026-06-01T00:00:00Z',
  };
}

describe('encodableDates', () => {
  it('keeps only school_day + hbl + school_holiday-with-overlay, sorted', () => {
    const rows = [
      cal('2026-06-03', 'school_day'),
      cal('2026-06-01', 'public_holiday'),
      cal('2026-06-02', 'hbl'),
      cal('2026-06-04', 'school_holiday', true),
      cal('2026-06-05', 'school_holiday', false),
    ];
    expect(encodableDates(rows)).toEqual([
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });
});

describe('pickDefaultDate', () => {
  const dates = ['2026-06-02', '2026-06-04', '2026-06-08'];
  it('returns today when today is encodable', () => {
    expect(pickDefaultDate(dates, '2026-06-04')).toBe('2026-06-04');
  });
  it('returns nearest encodable day before today when today is not encodable', () => {
    expect(pickDefaultDate(dates, '2026-06-06')).toBe('2026-06-04');
  });
  it('returns first encodable day when today is before all of them', () => {
    expect(pickDefaultDate(dates, '2026-06-01')).toBe('2026-06-02');
  });
  it('returns last encodable day when today is after all of them', () => {
    expect(pickDefaultDate(dates, '2026-12-31')).toBe('2026-06-08');
  });
  it('returns null when there are no encodable days', () => {
    expect(pickDefaultDate([], '2026-06-04')).toBeNull();
  });
});

describe('loadedMarksForDate', () => {
  it('maps the latest mark per student for the given date', () => {
    const rows = [
      daily('a', '2026-06-04', 'A'),
      daily('b', '2026-06-04', 'EX', 'mc'),
      daily('a', '2026-06-03', 'P'),
    ];
    const map = loadedMarksForDate(rows, '2026-06-04');
    expect(map.get('a')).toEqual({ status: 'A', exReason: null });
    expect(map.get('b')).toEqual({ status: 'EX', exReason: 'mc' });
    expect(map.has('c')).toBe(false);
  });
});

describe('computeSubmitEntries', () => {
  const date = '2026-06-04';
  const termId = 't1';
  const roster = [enr('a', 1), enr('b', 2), enr('c', 3)];
  it('writes P for unmarked students and the explicit exceptions', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['b', { status: 'A', exReason: null }],
    ]);
    const loaded = new Map<string, DailyMark>();
    const entries = computeSubmitEntries({
      roster,
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toEqual([
      { sectionStudentId: 'a', termId, date, status: 'P' },
      { sectionStudentId: 'b', termId, date, status: 'A' },
      { sectionStudentId: 'c', termId, date, status: 'P' },
    ]);
  });
  it('includes exReason only for EX marks', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc' }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries).toEqual([
      { sectionStudentId: 'a', termId, date, status: 'EX', exReason: 'mc' },
    ]);
  });
  it('skips a student whose target equals what is already on file (idempotent re-submit)', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
      ['b', { status: 'P', exReason: null }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1), enr('b', 2)],
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toEqual([]);
  });
  it('excludes withdrawn students and late-enrollees before their enrollment date', () => {
    const roster2 = [
      enr('a', 1, { withdrawn: true }),
      enr('b', 2, { enrollmentDate: '2026-06-10' }),
      enr('c', 3, { enrollmentDate: '2026-06-01' }),
    ];
    const entries = computeSubmitEntries({
      roster: roster2,
      marks: new Map(),
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries.map((e) => e.sectionStudentId)).toEqual(['c']);
  });
});

describe('tally', () => {
  it('counts P/L/A/EX and unmarked across the eligible roster', () => {
    const roster = [enr('a', 1), enr('b', 2), enr('c', 3), enr('d', 4)];
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
      ['b', { status: 'L', exReason: null }],
    ]);
    expect(tally({ roster, marks, date: '2026-06-04' })).toEqual({
      P: 0,
      L: 1,
      A: 1,
      EX: 0,
      unmarked: 2,
    });
  });
});
