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
  exReason: DailyEntryRow['exReason'] = null,
  exNote: string | null = null
): DailyEntryRow {
  return {
    id: `${sectionStudentId}-${date}`,
    sectionStudentId,
    termId: 't1',
    date,
    status,
    exReason,
    exNote,
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
    expect(map.get('a')).toEqual({ status: 'A', exReason: null, exNote: null });
    expect(map.get('b')).toEqual({
      status: 'EX',
      exReason: 'mc',
      exNote: null,
    });
    expect(map.has('c')).toBe(false);
  });
});

describe('computeSubmitEntries', () => {
  const date = '2026-06-04';
  const termId = 't1';
  const roster = [enr('a', 1), enr('b', 2), enr('c', 3)];
  it('writes P for unmarked students and the explicit exceptions', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['b', { status: 'A', exReason: null, exNote: null }],
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
      ['a', { status: 'EX', exReason: 'mc', exNote: null }],
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
      ['a', { status: 'A', exReason: null, exNote: null }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null, exNote: null }],
      ['b', { status: 'P', exReason: null, exNote: null }],
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
      ['a', { status: 'A', exReason: null, exNote: null }],
      ['b', { status: 'L', exReason: null, exNote: null }],
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

// ── The excused-absence note (migration 109) ──────────────────────────────
//
// Melissa asked for somewhere to record WHY a student was excused, since the
// MC document itself cannot be attached yet. The note rides on the same
// append-only ledger as the mark, which creates one trap worth a dedicated
// block of tests: `sameMark` decides whether a row is written at all, so a
// note it does not compare is a note that silently never saves.
describe('computeSubmitEntries — excused-absence note', () => {
  const date = '2026-06-04';
  const termId = 't1';

  it('writes a row when ONLY the note changed', () => {
    // The regression this whole block exists for. With `sameMark` comparing
    // just status + reason, this returns [] and the UI reports "No changes to
    // submit" while discarding what the teacher typed.
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: 'MC submitted' }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: null }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toEqual([
      {
        sectionStudentId: 'a',
        termId,
        date,
        status: 'EX',
        exReason: 'mc',
        exNote: 'MC submitted',
      },
    ]);
  });

  it('sends an explicit null when a note is cleared', () => {
    // Omitting the key would mean "no opinion" and leave the old text on file,
    // so clearing has to be expressible.
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: '' }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: 'Typed by mistake' }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].exNote).toBeNull();
  });

  it('treats an empty string and null as the same note', () => {
    // An emptied input arrives as '' while the ledger stores null. Without
    // normalising, every re-submit of an untouched day would write a row.
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: '' }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc', exNote: null }],
    ]);
    expect(
      computeSubmitEntries({
        roster: [enr('a', 1)],
        marks,
        loaded,
        termId,
        date,
      })
    ).toEqual([]);
  });

  it('drops the note when the mark moves away from EX', () => {
    // "Medical certificate submitted" must not end up attached to a Present.
    // The database enforces this too, so sending it would be a 400.
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'P', exReason: null, exNote: 'stale text' }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries).toEqual([
      { sectionStudentId: 'a', termId, date, status: 'P' },
    ]);
  });

  it('omits the note key entirely when there is nothing to say', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'vacation', exNote: null }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries[0]).not.toHaveProperty('exNote');
  });

  it('carries a stored note back so a re-submit does not clear it', () => {
    // loadedMarksForDate feeds the baseline for sameMark. If it dropped the
    // note, every unchanged day would look "changed" and rewrite it as null.
    const rows = [daily('a', '2026-06-04', 'EX', 'mc', 'Dental appointment')];
    const map = loadedMarksForDate(rows, '2026-06-04');
    expect(map.get('a')).toEqual({
      status: 'EX',
      exReason: 'mc',
      exNote: 'Dental appointment',
    });
  });
});
