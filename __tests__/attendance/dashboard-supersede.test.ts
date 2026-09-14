/**
 * The attendance dashboard must count a corrected mark once, at its new value.
 *
 * `attendance_daily` is append-only: a correction is a new row superseding the
 * old one by `recorded_at desc`. Every read is supposed to dedupe to the latest
 * per (student, date, period). The dashboard's own read did not — it selected
 * raw rows with no ordering and no dedupe, and all six of its consumers reduced
 * over them directly.
 *
 * Measured on live AY2026 before the fix: 48,574 ledger rows over 48,401 real
 * (student, date) pairs — 108 pairs with more than one row, 106 of them marks
 * whose value had actually changed. An absence corrected to Excused still
 * counted as an absence in the KPIs, the EX-reason mix, and the top-absentees
 * ranking. The T3 re-import alone wrote 91 corrections, mostly A→EX.
 */
import { describe, expect, it } from 'vitest';

import {
  dedupeLatestMarks,
  type DailyRowRaw,
} from '@/lib/attendance/dashboard';

const student = 'ss-1';

function row(over: Partial<DailyRowRaw> = {}): DailyRowRaw {
  return {
    date: '2026-08-03',
    status: 'P',
    ex_reason: null,
    section_student_id: student,
    period_id: null,
    ...over,
  };
}

describe('dedupeLatestMarks', () => {
  it('keeps the correction and drops the mark it replaced', () => {
    // Caller fetches `recorded_at desc`, so the correction arrives FIRST.
    const out = dedupeLatestMarks([
      row({ status: 'EX', ex_reason: 'Medical' }), // the correction
      row({ status: 'A' }), // the original, now superseded
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('EX');
    expect(out[0].ex_reason).toBe('Medical');
  });

  it('counts a corrected mark once, not twice', () => {
    // The actual bug: both rows survived, so one child was both absent AND
    // excused on the same day.
    const out = dedupeLatestMarks([
      row({ status: 'EX' }),
      row({ status: 'A' }),
    ]);
    expect(out.filter((r) => r.status === 'A')).toHaveLength(0);
  });

  it('leaves uncorrected marks alone', () => {
    const out = dedupeLatestMarks([
      row({ date: '2026-08-03' }),
      row({ date: '2026-08-04' }),
      row({ date: '2026-08-05' }),
    ]);
    expect(out).toHaveLength(3);
  });

  it('keeps different students apart on the same date', () => {
    const out = dedupeLatestMarks([
      row({ section_student_id: 'ss-1', status: 'A' }),
      row({ section_student_id: 'ss-2', status: 'P' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps different periods on one day apart', () => {
    // period_id is NULL everywhere today, but it is part of the ledger's key
    // (migration 014). Keying on it means a future multi-period day is not
    // silently collapsed into a single mark.
    const out = dedupeLatestMarks([
      row({ period_id: 'am', status: 'P' }),
      row({ period_id: 'pm', status: 'A' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('treats a null period as its own key, not a wildcard', () => {
    const out = dedupeLatestMarks([
      row({ period_id: null, status: 'EX' }),
      row({ period_id: null, status: 'A' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('EX');
  });

  it('survives a mark corrected more than once', () => {
    const out = dedupeLatestMarks([
      row({ status: 'L' }), // newest
      row({ status: 'EX' }),
      row({ status: 'A' }), // oldest
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('L');
  });

  it('drops nothing from an empty ledger', () => {
    expect(dedupeLatestMarks([])).toEqual([]);
  });

  it('returns the shape the consumers expect, without the dedupe key', () => {
    // The six consumers read DailyRow; period_id is an implementation detail of
    // the dedupe and must not leak into their reducers.
    const [only] = dedupeLatestMarks([row()]);
    expect(Object.keys(only).sort()).toEqual([
      'date',
      'ex_reason',
      'section_student_id',
      'status',
    ]);
  });
});
