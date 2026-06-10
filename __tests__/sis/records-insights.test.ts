import { describe, it, expect } from 'vitest';
import { rollupMovements } from '@/lib/sis/records-insights';

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
