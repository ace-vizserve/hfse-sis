import { describe, it, expect } from 'vitest';
import {
  hasMonthlyResolution,
  netMovementByMonth,
  rollupMovements,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/records-insights';
import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';
import {
  WITHDRAWAL_REASON_VALUES,
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';

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

// ---------------------------------------------------------------------------
// hasMonthlyResolution — backfill guard
//
// Backfilled AY movement events all carry the migration/backfill run-date in
// audit_log.created_at, so a whole year of activity piles into 1-2 months —
// the compare overlay would fabricate seasonality. This pure helper detects
// that signature: true only when the AY's non-zero/non-null months span at
// least 2 distinct months (real monthly resolution).
// ---------------------------------------------------------------------------

const monthPoint = (
  periodLabel: string,
  value: number | null,
  ayCode = 'AY2025'
): AyTrendPoint => ({ periodLabel, ayCode, value });

describe('hasMonthlyResolution — backfill guard', () => {
  it('all activity piled into a single month -> false (backfill signature)', () => {
    const points = [
      monthPoint('Jan', -14),
      monthPoint('Feb', 0),
      monthPoint('Mar', 0),
      monthPoint('Apr', 0),
      monthPoint('May', null),
    ];
    expect(hasMonthlyResolution(points)).toBe(false);
  });

  it('activity spread across two distinct months -> true', () => {
    const points = [
      monthPoint('Jan', -3),
      monthPoint('Feb', 2),
      monthPoint('Mar', 0),
      monthPoint('Apr', null),
    ];
    expect(hasMonthlyResolution(points)).toBe(true);
  });

  it('empty array -> false', () => {
    expect(hasMonthlyResolution([])).toBe(false);
  });

  it('a single non-zero month among many nulls -> false', () => {
    const points = [monthPoint('Jun', 5), monthPoint('Jul', null)];
    expect(hasMonthlyResolution(points)).toBe(false);
  });

  it('all zero/null -> false (no activity at all)', () => {
    const points = [monthPoint('Jan', 0), monthPoint('Feb', 0)];
    expect(hasMonthlyResolution(points)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WITHDRAWAL_CONTROLLABILITY — exhaustive coverage
//
// Every member of WITHDRAWAL_REASON_VALUES must be classified. If the enum
// grows, this test will fail until the new value is added to the mapping.
// ---------------------------------------------------------------------------

describe('WITHDRAWAL_CONTROLLABILITY — exhaustive classification', () => {
  it('classifies every WITHDRAWAL_REASON_VALUES member', () => {
    for (const reason of WITHDRAWAL_REASON_VALUES) {
      expect(WITHDRAWAL_CONTROLLABILITY).toHaveProperty(reason);
      expect(['controllable', 'structural']).toContain(
        WITHDRAWAL_CONTROLLABILITY[reason as WithdrawalReason]
      );
    }
  });

  it('has the exact expected controllable reasons', () => {
    const controllable = WITHDRAWAL_REASON_VALUES.filter(
      (r) =>
        WITHDRAWAL_CONTROLLABILITY[r as WithdrawalReason] === 'controllable'
    );
    expect(controllable.sort()).toEqual(
      ['financial', 'disciplinary', 'academic_fit'].sort()
    );
  });

  it('has the exact expected structural reasons', () => {
    const structural = WITHDRAWAL_REASON_VALUES.filter(
      (r) => WITHDRAWAL_CONTROLLABILITY[r as WithdrawalReason] === 'structural'
    );
    expect(structural.sort()).toEqual(
      [
        'transferred_other_school',
        'family_relocation',
        'health',
        'other',
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// rollupMovements — reason×level matrix (withdrawalsByReasonAndLevel)
// ---------------------------------------------------------------------------

const wEv = (
  level: string,
  reason: string | null,
  reasonLabel: string | null
) => ({
  id: 'x',
  kind: 'withdrawn' as const,
  studentNumber: null,
  studentName: 'Test',
  enroleeNumber: 'E1',
  level,
  ayCode: 'AY2026',
  termNumber: 1,
  termLabel: 'Term 1',
  date: '2026-03-01',
  actorEmail: null,
  reason,
  reasonLabel,
});

describe('rollupMovements — reason×level matrix', () => {
  it('builds withdrawalsByReasonAndLevel rows per level', () => {
    const events = [
      wEv('Primary 3', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Primary 3', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv(
        'Primary 3',
        'family_relocation',
        WITHDRAWAL_REASON_LABELS['family_relocation']
      ),
      wEv('Secondary 1', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Secondary 1', 'health', WITHDRAWAL_REASON_LABELS['health']),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    expect(out.withdrawalsByReasonAndLevel).toHaveLength(2);

    // Primary 3 should be first (3 total withdrawals > 2).
    const p3 = out.withdrawalsByReasonAndLevel.find(
      (r) => r.level === 'Primary 3'
    )!;
    expect(p3).toBeDefined();
    expect(p3.total).toBe(3);
    expect(p3.reasonCounts[WITHDRAWAL_REASON_LABELS['financial']]).toBe(2);
    expect(p3.reasonCounts[WITHDRAWAL_REASON_LABELS['family_relocation']]).toBe(
      1
    );

    const s1 = out.withdrawalsByReasonAndLevel.find(
      (r) => r.level === 'Secondary 1'
    )!;
    expect(s1.total).toBe(2);
    expect(s1.reasonCounts[WITHDRAWAL_REASON_LABELS['financial']]).toBe(1);
    expect(s1.reasonCounts[WITHDRAWAL_REASON_LABELS['health']]).toBe(1);
  });

  it('withdrawalReasonKeys contains all reasons that appeared', () => {
    const events = [
      wEv('Primary 1', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Primary 2', 'health', WITHDRAWAL_REASON_LABELS['health']),
    ] as Parameters<typeof rollupMovements>[0];
    const out = rollupMovements(events);
    expect(out.withdrawalReasonKeys).toContain(
      WITHDRAWAL_REASON_LABELS['financial']
    );
    expect(out.withdrawalReasonKeys).toContain(
      WITHDRAWAL_REASON_LABELS['health']
    );
    expect(out.withdrawalReasonKeys).toHaveLength(2);
  });

  it('reason×level matrix has 0 for absent reason keys (not undefined)', () => {
    const events = [
      wEv('Primary 1', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Primary 2', 'health', WITHDRAWAL_REASON_LABELS['health']),
    ] as Parameters<typeof rollupMovements>[0];
    const out = rollupMovements(events);
    const p1 = out.withdrawalsByReasonAndLevel.find(
      (r) => r.level === 'Primary 1'
    )!;
    // P1 has no 'health' withdrawal — should be 0, not undefined.
    expect(p1.reasonCounts[WITHDRAWAL_REASON_LABELS['health']]).toBe(0);
    const p2 = out.withdrawalsByReasonAndLevel.find(
      (r) => r.level === 'Primary 2'
    )!;
    expect(p2.reasonCounts[WITHDRAWAL_REASON_LABELS['financial']]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rollupMovements — controllability breakdown
// ---------------------------------------------------------------------------

describe('rollupMovements — controllability breakdown', () => {
  it('correctly tallies controllable vs structural counts', () => {
    const events = [
      wEv('P1', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('P1', 'disciplinary', WITHDRAWAL_REASON_LABELS['disciplinary']),
      wEv('P1', 'academic_fit', WITHDRAWAL_REASON_LABELS['academic_fit']),
      wEv(
        'P2',
        'family_relocation',
        WITHDRAWAL_REASON_LABELS['family_relocation']
      ),
      wEv('P2', 'health', WITHDRAWAL_REASON_LABELS['health']),
      wEv(
        'P3',
        'transferred_other_school',
        WITHDRAWAL_REASON_LABELS['transferred_other_school']
      ),
      wEv('P3', 'other', WITHDRAWAL_REASON_LABELS['other']),
    ] as Parameters<typeof rollupMovements>[0];

    const { controllability } = rollupMovements(events);
    expect(controllability.controllableCount).toBe(3);
    expect(controllability.structuralCount).toBe(4);
    expect(controllability.unspecifiedCount).toBe(0);
    expect(controllability.total).toBe(7);
    // 3/7 ≈ 42.9%
    expect(controllability.controllablePct).toBeCloseTo(42.9, 0);
  });

  it('null/empty reason goes to unspecifiedCount, not controllable', () => {
    const events = [wEv('P1', null, null), wEv('P1', '', null)] as Parameters<
      typeof rollupMovements
    >[0];
    const { controllability } = rollupMovements(events);
    expect(controllability.unspecifiedCount).toBe(2);
    expect(controllability.controllableCount).toBe(0);
  });

  it('100% controllable pct when all are controllable', () => {
    const events = [
      wEv('P1', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('P2', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
    ] as Parameters<typeof rollupMovements>[0];
    const { controllability } = rollupMovements(events);
    expect(controllability.controllablePct).toBe(100);
    expect(controllability.topControllableTakeaway).toMatch(/Financial/);
  });

  it('generates a takeaway naming the top controllable reason and its top level', () => {
    const events = [
      wEv('Primary 3', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Primary 3', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv('Primary 4', 'financial', WITHDRAWAL_REASON_LABELS['financial']),
      wEv(
        'Secondary 1',
        'disciplinary',
        WITHDRAWAL_REASON_LABELS['disciplinary']
      ),
    ] as Parameters<typeof rollupMovements>[0];
    const { controllability } = rollupMovements(events);
    expect(controllability.topControllableTakeaway).toMatch(/Financial/);
    expect(controllability.topControllableTakeaway).toMatch(/Primary 3/);
  });

  it('null takeaway when no controllable withdrawals', () => {
    const events = [
      wEv(
        'P1',
        'family_relocation',
        WITHDRAWAL_REASON_LABELS['family_relocation']
      ),
    ] as Parameters<typeof rollupMovements>[0];
    const { controllability } = rollupMovements(events);
    expect(controllability.topControllableTakeaway).toBeNull();
    expect(controllability.controllablePct).toBe(0);
  });

  it('zero total → controllablePct is null', () => {
    const { controllability } = rollupMovements([]);
    expect(controllability.total).toBe(0);
    expect(controllability.controllablePct).toBeNull();
  });
});
