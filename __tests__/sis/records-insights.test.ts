import { describe, it, expect } from 'vitest';
import {
  netMovementByMonth,
  rollupMovements,
} from '@/lib/sis/records-insights';

const ev = (over: Record<string, unknown>) => ({
  kind: 'withdrawn',
  studentNumber: 'S1',
  level: 'P1',
  termNumber: 1,
  termLabel: 'Term 1',
  reasonLabel: null,
  ...over,
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
