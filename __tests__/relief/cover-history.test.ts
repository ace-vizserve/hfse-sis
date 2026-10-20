import { describe, expect, it } from 'vitest';

import {
  ayForDate,
  buildCoverHistory,
  RELIEF_END,
  RELIEF_START,
  type AyDateRange,
  type LivePastCover,
  type ReliefAuditEntry,
} from '@/lib/relief/cover-history-core';

// The History tab's timeline, from the audit log and the rows that still hold
// a finished cover. All timestamps are UTC; 02:00Z is 10:00 in Singapore, so
// the Singapore date is the same calendar day.

const TODAY = '2026-10-20';
const AYS: AyDateRange[] = [
  { ayCode: 'AY2025', startDate: '2025-01-06', endDate: '2025-11-14' },
  { ayCode: 'AY2026', startDate: '2026-01-08', endDate: '2026-11-19' },
];

const at = (day: string, time = '02:00:00') => `${day}T${time}Z`;

function single(
  action: string,
  day: string,
  ctx: Record<string, unknown> = {}
): ReliefAuditEntry {
  return {
    action,
    createdAt: at(day),
    context: {
      assignment_id: 'a-1',
      role: 'subject_teacher',
      section_name: 'P4 Diligence',
      subject_name: 'Mathematics',
      covered_teacher_user_id: 't-away',
      covered_teacher_name: 'Marrie Juni',
      ...(action === RELIEF_START
        ? {
            relief_teacher_user_id: 't-sub',
            relief_teacher_name: 'Jenny Wong',
            relief_started_on: '2026-09-07',
            relief_ended_on: '2026-09-11',
            relief_reason: 'Medical leave',
          }
        : { relief_teacher_user_id: null }),
      ...ctx,
    },
  };
}

function bulk(
  action: string,
  day: string,
  ctx: Record<string, unknown> = {}
): ReliefAuditEntry {
  return {
    action,
    createdAt: at(day),
    context: {
      bulk: true,
      covered_teacher_user_id: 't-away',
      covered_teacher_name: 'Marrie Juni',
      relief_teacher_user_id: action === RELIEF_START ? 't-sub' : null,
      relief_teacher_name: action === RELIEF_START ? 'Jenny Wong' : null,
      relief_started_on: action === RELIEF_START ? '2026-09-07' : null,
      relief_ended_on: action === RELIEF_START ? '2026-09-11' : null,
      relief_reason: action === RELIEF_START ? 'Medical leave' : null,
      assignment_ids: ['a-1', 'a-2', 'a-3'],
      class_labels: [
        'P4 Diligence · MATH',
        'P4 Diligence · SCI',
        'P4 Diligence',
      ],
      classes_covered: 3,
      ...ctx,
    },
  };
}

const previousSept = (id: string) => ({
  assignment_id: id,
  previous_relief_teacher_user_id: 't-sub',
  previous_relief_teacher_name: 'Jenny Wong',
  previous_relief_started_on: '2026-09-07',
  previous_relief_ended_on: '2026-09-11',
  previous_relief_reason: 'Medical leave',
});

const run = (entries: ReliefAuditEntry[], livePast: LivePastCover[] = []) =>
  buildCoverHistory({ entries, livePast, today: TODAY, ayRanges: AYS });

describe('a cover that ran its course', () => {
  it('a booking never cleared, last day behind us, is history', () => {
    const out = run([bulk(RELIEF_START, '2026-09-04')]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'ran' });
    expect(out[0].assignmentIds).toEqual(['a-1', 'a-2', 'a-3']);
    expect(out[0].reason).toBe('Medical leave');
    expect(out[0].coveredTeacherName).toBe('Marrie Juni');
  });

  it('a booking still running is not history', () => {
    const out = run([
      single(RELIEF_START, '2026-10-18', {
        relief_started_on: '2026-10-19',
        relief_ended_on: '2026-10-23',
      }),
    ]);
    expect(out).toEqual([]);
  });

  it('an open-ended cover nobody ended is not history', () => {
    const out = run([
      single(RELIEF_START, '2026-09-01', {
        relief_started_on: null,
        relief_ended_on: null,
      }),
    ]);
    expect(out).toEqual([]);
  });

  it('ended after its last day still ran its course', () => {
    const out = run([
      bulk(RELIEF_START, '2026-09-04'),
      bulk(RELIEF_END, '2026-09-20', {
        previous_covers: ['a-1', 'a-2', 'a-3'].map(previousSept),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'ran' });
  });
});

describe('a cover stopped early', () => {
  it('a bulk end before the last day stops it on that Singapore date', () => {
    const out = run([
      bulk(RELIEF_START, '2026-09-04'),
      {
        ...bulk(RELIEF_END, '2026-09-08', {
          previous_covers: ['a-1', 'a-2', 'a-3'].map(previousSept),
        }),
        // 18:30Z on the 8th is 02:30 on the 9th in Singapore.
        createdAt: '2026-09-08T18:30:00Z',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'stopped', on: '2026-09-09' });
    expect(out[0].assignmentIds).toHaveLength(3);
  });

  it('a single-class end without previous_* closes the replayed cover', () => {
    const out = run([
      single(RELIEF_START, '2026-09-04'),
      single(RELIEF_END, '2026-09-09'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'stopped', on: '2026-09-09' });
    expect(out[0].auditLabels['a-1']).toBe('P4 Diligence · Mathematics');
  });

  it('an open-ended cover that was ended reads as ended, not early', () => {
    const out = run([
      single(RELIEF_START, '2026-09-04', {
        relief_started_on: null,
        relief_ended_on: null,
      }),
      single(RELIEF_END, '2026-09-15', {
        previous_relief_teacher_user_id: 't-sub',
        previous_relief_started_on: null,
        previous_relief_ended_on: null,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'ended', on: '2026-09-15' });
    // No first day — the booking date stands in, for the year too.
    expect(out[0].effectiveStart).toBe('2026-09-04');
    expect(out[0].ayCode).toBe('AY2026');
  });
});

describe('a cover cancelled before it started', () => {
  it('ending a booking before its first day cancels it', () => {
    const out = run([
      single(RELIEF_START, '2026-09-01'),
      single(RELIEF_END, '2026-09-03', {
        previous_relief_teacher_user_id: 't-sub',
        previous_relief_started_on: '2026-09-07',
        previous_relief_ended_on: '2026-09-11',
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toEqual({ kind: 'cancelled', on: '2026-09-03' });
  });
});

describe('a cover booked over', () => {
  it('a new substitute mid-absence stops the first one that day', () => {
    const out = run([
      single(RELIEF_START, '2026-09-04'),
      single(RELIEF_START, '2026-09-09', {
        relief_teacher_user_id: 't-other',
        relief_teacher_name: 'R. Fernandez',
        relief_started_on: '2026-09-09',
        relief_ended_on: '2026-09-11',
        previous_relief_teacher_user_id: 't-sub',
        previous_relief_teacher_name: 'Jenny Wong',
        previous_relief_started_on: '2026-09-07',
        previous_relief_ended_on: '2026-09-11',
        previous_relief_reason: 'Medical leave',
      }),
    ]);
    expect(out).toHaveLength(2);
    const first = out.find((g) => g.reliefTeacherId === 't-sub')!;
    const second = out.find((g) => g.reliefTeacherId === 't-other')!;
    expect(first.outcome).toEqual({ kind: 'stopped', on: '2026-09-09' });
    expect(second.outcome).toEqual({ kind: 'ran' });
  });

  it('a re-save with the same substitute and first day is one absence', () => {
    const out = run([
      single(RELIEF_START, '2026-09-04'),
      single(RELIEF_START, '2026-09-08', {
        relief_ended_on: '2026-09-10',
        relief_reason: 'Medical leave, back Thursday',
        previous_relief_teacher_user_id: 't-sub',
        previous_relief_started_on: '2026-09-07',
        previous_relief_ended_on: '2026-09-11',
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].endedOn).toBe('2026-09-10');
    expect(out[0].outcome).toEqual({ kind: 'ran' });
    expect(out[0].reason).toBe('Medical leave, back Thursday');
  });

  it('a new booking over an expired one shows the old one ran its course', () => {
    // The row lost the August window when September was booked over it; only
    // the log's previous_covers remembers it.
    const out = run([
      bulk(RELIEF_START, '2026-09-04', {
        previous_covers: ['a-1', 'a-2'].map((id) => ({
          assignment_id: id,
          previous_relief_teacher_user_id: 't-other',
          previous_relief_started_on: '2026-08-03',
          previous_relief_ended_on: '2026-08-05',
          previous_relief_reason: 'Training',
        })),
      }),
    ]);
    const august = out.find((g) => g.reliefTeacherId === 't-other')!;
    expect(august.outcome).toEqual({ kind: 'ran' });
    expect(august.assignmentIds).toEqual(['a-1', 'a-2']);
    expect(august.reason).toBe('Training');
  });
});

describe('bulk and single shapes merge into one absence', () => {
  it('single-class bookings with the same window are one row', () => {
    const out = run([
      single(RELIEF_START, '2026-09-04', { assignment_id: 'a-1' }),
      single(RELIEF_START, '2026-09-04', {
        assignment_id: 'a-2',
        role: 'form_adviser',
        subject_name: undefined,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].assignmentIds).toEqual(['a-1', 'a-2']);
    expect(out[0].auditLabels['a-2']).toBe('P4 Diligence · Form class');
  });

  it('a bulk booking then a single-class end splits only that class', () => {
    const out = run([
      bulk(RELIEF_START, '2026-09-04'),
      // previousSept carries assignment_id: 'a-2'.
      single(RELIEF_END, '2026-09-09', previousSept('a-2')),
    ]);
    expect(out).toHaveLength(2);
    const ran = out.find((g) => g.outcome.kind === 'ran')!;
    const stopped = out.find((g) => g.outcome.kind === 'stopped')!;
    expect(ran.assignmentIds).toEqual(['a-1', 'a-3']);
    expect(stopped.assignmentIds).toEqual(['a-2']);
  });
});

describe('dedupe with the rows', () => {
  it('a row still holding a logged cover is not counted twice', () => {
    const live: LivePastCover[] = ['a-1', 'a-2', 'a-3'].map((id) => ({
      assignmentId: id,
      coveredTeacherId: 't-away',
      reliefTeacherId: 't-sub',
      startedOn: '2026-09-07',
      endedOn: '2026-09-11',
      reason: 'Medical leave',
    }));
    const out = run([bulk(RELIEF_START, '2026-09-04')], live);
    expect(out).toHaveLength(1);
    expect(out[0].assignmentIds).toHaveLength(3);
  });

  it('a row with no log entry still appears', () => {
    const out = run(
      [],
      [
        {
          assignmentId: 'a-9',
          coveredTeacherId: 't-away',
          reliefTeacherId: 't-sub',
          startedOn: '2026-05-04',
          endedOn: '2026-05-06',
          reason: '',
        },
      ]
    );
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBeNull();
    expect(out[0].outcome).toEqual({ kind: 'ran' });
  });
});

describe('year scoping', () => {
  it('an absence belongs to the year containing its first day', () => {
    const out = run([
      single(RELIEF_START, '2025-03-01', {
        relief_started_on: '2025-03-03',
        relief_ended_on: '2025-03-05',
      }),
      single(RELIEF_START, '2026-09-04', { assignment_id: 'a-2' }),
    ]);
    expect(out.map((g) => g.ayCode).sort()).toEqual(['AY2025', 'AY2026']);
  });

  it('a holiday date falls to the year just ended', () => {
    expect(ayForDate('2025-12-01', AYS)).toBe('AY2025');
    expect(ayForDate('2026-02-01', AYS)).toBe('AY2026');
    expect(ayForDate('2024-12-01', AYS)).toBeNull();
  });
});
