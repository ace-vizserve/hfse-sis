import { describe, it, expect } from 'vitest';
import {
  netMovementByMonth,
  rollupMovements,
} from '@/lib/sis/records-insights';

// ---------------------------------------------------------------------------
// Helpers shared across test suites
// ---------------------------------------------------------------------------

const ev = (over: Record<string, unknown>) => ({
  kind: 'withdrawn',
  studentNumber: 'S1',
  level: 'P1',
  termNumber: 1,
  termLabel: 'Term 1',
  reasonLabel: null,
  ...over,
});

const mkEvent = (
  kind: string,
  date: string
): Parameters<typeof netMovementByMonth>[0][number] =>
  ({
    id: 'x',
    kind,
    studentNumber: null,
    studentName: 'Test',
    enroleeNumber: 'E1',
    level: 'P1',
    ayCode: 'AY2026',
    termNumber: 1,
    termLabel: 'Term 1',
    date,
    actorEmail: null,
  }) as Parameters<typeof netMovementByMonth>[0][number];

// ---------------------------------------------------------------------------
// Bug 1 regression — re-enrollee double-count
//
// When a re-enrolment is also a late-enrolment (route sets BOTH
// lateEnrolleeTransition=true AND reEnrolment=true in one audit row),
// the event must appear exactly ONCE in the movement feed — as 'late-enrolled'
// (dominant kind). The rollup must never increment BOTH lateEnrolled and
// reEnrolled for the same physical event.
// ---------------------------------------------------------------------------

describe('rollupMovements — Bug 1: re-enrollee de-dup', () => {
  it('a "late-enrolled" event is counted once; reEnrolled is NOT also bumped', () => {
    // Simulate the scenario: one student re-enrolled and tagged late.
    // After the Bug-1 fix, fetchMetadataEvents emits only the 'late-enrolled'
    // kind for such a row, so rollupMovements only ever sees one event for it.
    const events = [
      ev({ kind: 'late-enrolled', level: 'P3', termNumber: 2 }),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    // lateEnrolled = 1, reEnrolled = 0 — NOT lateEnrolled=1 AND reEnrolled=1
    expect(out.counts.lateEnrolled).toBe(1);
    expect(out.counts.reEnrolled).toBe(0);
    expect(out.counts.withdrawn).toBe(0);
    expect(out.counts.transferred).toBe(0);
    expect(out.lateByTerm.find((t) => t.termNumber === 2)?.count).toBe(1);
  });

  it('a plain re-enrolled event (no late flag) counts only as reEnrolled', () => {
    const events = [
      ev({ kind: 're-enrolled', level: 'P3', termNumber: null }),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    expect(out.counts.reEnrolled).toBe(1);
    expect(out.counts.lateEnrolled).toBe(0);
  });

  it('net movement: a late-enrolled-re-enrolment adds +1 once, not +2', () => {
    // If double-counted it would add +2 (one as late-enrolled, one as
    // re-enrolled); the fixed behaviour is +1.
    const events = [
      mkEvent('late-enrolled', '2026-03-10'), // the de-duped event
    ];
    const points = netMovementByMonth(events, 'AY2026', '2026-12-31');
    const mar = points.find((p) => p.periodLabel === 'Mar')!;
    expect(mar.value).toBe(1); // exactly +1, not +2
  });
});

// ---------------------------------------------------------------------------
// Bug 3 regression — late-term override
//
// getMovementEvents flips term precedence for 'late-enrolled' events:
// the registrar's explicit ctxTermNumber (lateEnrolleeTermNumber from the audit
// context, set via KD #111) wins over the date-derived term. rollupMovements
// uses whatever termNumber it receives, so the unit-level test verifies the
// rollup buckets correctly when handed an override term.
// ---------------------------------------------------------------------------

describe('rollupMovements — Bug 3: late-term override respected', () => {
  it('buckets by ctxTermNumber (override) when provided, not by date', () => {
    // Scenario: a student physically enrolled on a T2 date, but the registrar
    // explicitly tagged them as joining T3 (lateEnrolleeTermNumber=3).
    // The termNumber on the event should already be 3 (set by getMovementEvents
    // after the Bug-3 fix). rollupMovements then counts it under T3.
    const events = [
      // termNumber=3 reflects the override; date is in T2 but we don't care
      // about the date here — that's movements.ts's responsibility.
      ev({ kind: 'late-enrolled', level: 'S1', termNumber: 3 }),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    expect(out.lateByTerm.find((t) => t.termNumber === 3)?.count).toBe(1);
    expect(out.lateByTerm.find((t) => t.termNumber === 2)).toBeUndefined();
  });
});

describe('rollupMovements', () => {
  it('counts by kind, late by level/term, withdrawals by reason/level', () => {
    const events = [
      ev({ kind: 'withdrawn', level: 'P1', reasonLabel: 'Relocation' }),
      ev({ kind: 'withdrawn', level: 'P1', reasonLabel: 'Fees' }),
      ev({ kind: 'withdrawn', level: 'S1', reasonLabel: 'Relocation' }),
      ev({ kind: 'late-enrolled', level: 'P1', termNumber: 2 }),
      ev({ kind: 'late-enrolled', level: 'P2', termNumber: 2 }),
      ev({ kind: 'section-transfer', level: 'P1' }),
      ev({ kind: 're-enrolled', level: 'P3' }),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    expect(out.counts).toEqual({
      withdrawn: 3,
      lateEnrolled: 2,
      transferred: 1,
      reEnrolled: 1,
    });
    // withdrawals by reason, desc
    expect(out.withdrawalsByReason[0]).toEqual({
      reason: 'Relocation',
      count: 2,
    });
    // late by term
    const t2 = out.lateByTerm.find((t) => t.termNumber === 2);
    expect(t2?.count).toBe(2);
    // late by level
    expect(out.lateByLevel.map((l) => l.level).sort()).toEqual(['P1', 'P2']);
    // withdrawals by level
    const p1 = out.withdrawalsByLevel.find((l) => l.level === 'P1');
    expect(p1?.count).toBe(2);
  });

  it('null/blank reason -> "Unspecified"; empty -> zeroed shape', () => {
    const out = rollupMovements([
      ev({ kind: 'withdrawn', reasonLabel: null, level: 'P1' }),
    ] as Parameters<typeof rollupMovements>[0]);
    expect(out.withdrawalsByReason[0]).toEqual({
      reason: 'Unspecified',
      count: 1,
    });
    const empty = rollupMovements([]);
    expect(empty.counts).toEqual({
      withdrawn: 0,
      lateEnrolled: 0,
      transferred: 0,
      reEnrolled: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// netMovementByMonth

describe('netMovementByMonth', () => {
  it('late-enrolled counts as +1, withdrawn as -1 in the correct month', () => {
    const events = [
      mkEvent('late-enrolled', '2026-03-10'), // Mar → +1
      mkEvent('late-enrolled', '2026-03-15'), // Mar → +1
      mkEvent('withdrawn', '2026-03-20'), // Mar → -1
      mkEvent('re-enrolled', '2026-05-01'), // May → +1
      mkEvent('section-transfer', '2026-03-05'), // ignored
    ];
    const points = netMovementByMonth(events, 'AY2026', '2026-12-31');
    const mar = points.find((p) => p.periodLabel === 'Mar')!;
    const may = points.find((p) => p.periodLabel === 'May')!;
    const jan = points.find((p) => p.periodLabel === 'Jan')!;
    expect(mar.value).toBe(1); // 2 late - 1 withdrawn
    expect(may.value).toBe(1); // 1 re-enrolled
    expect(jan.value).toBe(0); // no events
  });

  it('future months return null (gap in chart)', () => {
    const events = [mkEvent('late-enrolled', '2026-03-01')];
    // today is April 30 → May–Dec should be null
    const points = netMovementByMonth(events, 'AY2026', '2026-04-30');
    const may = points.find((p) => p.periodLabel === 'May')!;
    const dec = points.find((p) => p.periodLabel === 'Dec')!;
    expect(may.value).toBeNull();
    expect(dec.value).toBeNull();
    // Jan–Apr are in the past → numeric (even if 0)
    const jan = points.find((p) => p.periodLabel === 'Jan')!;
    expect(jan.value).toBe(0);
  });

  it('returns 12 points, all labelled with the correct ayCode', () => {
    const points = netMovementByMonth([], 'AY2025', '2025-12-31');
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.ayCode === 'AY2025')).toBe(true);
    expect(points.map((p) => p.periodLabel)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
  });
});
