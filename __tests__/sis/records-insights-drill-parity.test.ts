import { describe, expect, it } from 'vitest';

import { computeNationalityByLevel } from '@/lib/admissions/insights-funnel';
import { applyTargetFilter, type RecordsDrillRow } from '@/lib/sis/drill';
import {
  encodeInsightsSegment,
  INSIGHTS_MOVEMENT_MONTHS,
  levelShortCode,
} from '@/lib/sis/insights-shared';
import {
  movementDrillRowsFrom,
  onRollDrillRowsFrom,
  retentionDrillRowsFrom,
  type OnRollDrillSourceRow,
} from '@/lib/sis/insights-drill-rows';
import type { MovementEvent } from '@/lib/sis/movements';
import {
  computeEnrolledCategoryMix,
  computeEnrolledNationalityMix,
  enrolledStudentDataFrom,
  headcountFromRows,
  isTerminalLevel,
  monthlyMovementSeries,
  nationalityByLevelInputs,
  retentionByLevelFromCohort,
  retentionCohortFrom,
  retentionFromCohort,
  rollupMovements,
} from '@/lib/sis/records-insights';

const LEVELS = [
  { label: 'Primary One', code: 'P1' },
  { label: 'Primary Two', code: 'P2' },
  { label: 'Youngstarters', code: 'YS' },
  { label: 'Secondary Four', code: 'S4' },
];

function src(
  i: number,
  over: Partial<{
    sn: string | null;
    en: string | null;
    level: number;
    status: string;
  }> = {}
): OnRollDrillSourceRow {
  const lvl = LEVELS[over.level ?? i % 3];
  return {
    id: `ss${i}`,
    enrolee_number: over.en === undefined ? `E${i}` : over.en,
    enrollment_status: over.status ?? 'active',
    enrollment_date: null,
    student: {
      student_number: over.sn === undefined ? `S${i}` : over.sn,
      first_name: `First${i}`,
      middle_name: null,
      last_name: `Last${i}`,
    },
    section: {
      id: `sec-${lvl.code}`,
      name: `${lvl.code} Obedience`,
      academic_year_id: 'ay',
      levels: lvl,
    },
  };
}

// 15 on-roll rows: 11 distinct nationalities once 'Viet Nam' folds into
// 'Vietnam' (so the top-8 pie AND the top-6 by-level bars both fold an
// 'Other'), a row with no enrolee number and one with no nationality
// ('Unspecified'), one student on two live rows, a graduated S4 row, and a
// Youngstarters class (a level the short-code map does not know).
const onRoll: OnRollDrillSourceRow[] = [
  ...Array.from({ length: 12 }, (_, i) => src(i)),
  src(12, { en: null }),
  src(13, { sn: 'S0', en: 'E0', level: 1, status: 'late_enrollee' }),
  src(14, { level: 3, status: 'graduated' }),
];
const nationalityMap = new Map([
  ['E0', 'Philippines'],
  ['E1', 'Philippines'],
  ['E2', 'Singapore'],
  ['E3', 'India'],
  ['E4', 'China'],
  ['E5', 'Japan'],
  ['E6', 'Viet Nam'],
  ['E7', 'Vietnam'],
  ['E8', 'Indonesia'],
  ['E9', 'Malaysia'],
  ['E10', 'Thailand'],
  ['E11', 'Australia'],
  ['E14', 'France'],
]);
const categoryMap = new Map([
  ['E0', 'New'],
  ['E1', 'Current'],
  ['E2', 'VizSchool New'],
  ['E3', 'Bogus'],
  ['E4', 'New'],
]);

const drillRows = onRollDrillRowsFrom(onRoll, categoryMap, nationalityMap);
const count = (
  target: Parameters<typeof applyTargetFilter>[1],
  seg: string | null
) => applyTargetFilter(drillRows, target, seg).length;

describe('enrolled-headcount = getInsightsHeadcount', () => {
  const headcount = headcountFromRows(onRoll);
  it('total', () => {
    expect(count('enrolled-headcount', null)).toBe(headcount.total);
  });
  it('every level, clicked by the code the chart plots', () => {
    expect(headcount.byLevel.map((l) => l.level)).toContain('Youngstarters');
    for (const l of headcount.byLevel) {
      const seg = encodeInsightsSegment({ level: levelShortCode(l.level) });
      expect(count('enrolled-headcount', seg)).toBe(l.count);
    }
  });
});

describe('category = getEnrolledCategoryMix', () => {
  const mix = computeEnrolledCategoryMix(
    onRoll.map((r) => ({ enroleeNumber: r.enrolee_number })),
    categoryMap
  );
  it('every bar, Unspecified included', () => {
    expect(mix.some((m) => m.category === 'Unspecified')).toBe(true);
    for (const m of mix) {
      expect(
        count('category', encodeInsightsSegment({ category: m.category }))
      ).toBe(m.count);
    }
  });
});

describe('nationality = getEnrolledNationalityMix / ByLevel', () => {
  const mix = computeEnrolledNationalityMix(
    onRoll.map((r) => ({ enroleeNumber: r.enrolee_number })),
    nationalityMap
  );
  const byLevel = computeNationalityByLevel(
    nationalityByLevelInputs(onRoll, nationalityMap)
  );
  it('every slice, the folded Other included', () => {
    expect(mix.some((m) => m.nationality === 'Other')).toBe(true);
    for (const m of mix) {
      expect(
        count(
          'nationality',
          encodeInsightsSegment({ nationality: m.nationality })
        )
      ).toBe(m.count);
    }
  });
  it('every level × nationality segment', () => {
    expect(byLevel.legend).toContain('Other');
    for (const r of byLevel.rows) {
      for (const s of r.segments) {
        const seg = encodeInsightsSegment({
          level: r.level,
          nationality: s.nationality,
        });
        expect(count('nationality', seg)).toBe(s.count);
      }
    }
  });
});

describe('retention = getRecordsRetention / ByLevel (comparison-year rows)', () => {
  // The comparison year (AY2025): S1 twice (transfer), S2, S3, and an S4 leaver.
  const prior: OnRollDrillSourceRow[] = [
    src(1, { level: 0 }),
    src(21, { sn: 'S1', level: 1 }),
    src(2, { level: 0 }),
    src(3, { level: 1 }),
    src(4, { level: 3 }),
  ];
  const current = new Set(['S1', 'S3', 'S4']);
  const rows = retentionDrillRowsFrom(prior, current);
  const data = enrolledStudentDataFrom(prior);
  const kpi = retentionFromCohort('AY2025', retentionCohortFrom(data, current));
  const byLevel = retentionByLevelFromCohort(
    retentionCohortFrom(data, current, { includeTerminal: true })
  ).filter((r) => !isTerminalLevel(r.level));

  it('the KPI denominator and numerator', () => {
    expect(applyTargetFilter(rows, 'retention', null)).toHaveLength(
      kpi.priorTotal
    );
    expect(
      applyTargetFilter(rows, 'retention', null).filter((r) => r.returned)
    ).toHaveLength(kpi.returned);
  });
  it('every bar of the chart, by the code it plots', () => {
    for (const r of byLevel) {
      const code = levelShortCode(r.level);
      expect(
        applyTargetFilter(
          rows,
          'retention',
          encodeInsightsSegment({ level: code, outcome: 'returned' })
        )
      ).toHaveLength(r.returned);
      expect(
        applyTargetFilter(
          rows,
          'retention',
          encodeInsightsSegment({ level: code, outcome: 'didNotReturn' })
        )
      ).toHaveLength(r.didNotReturn);
    }
  });
});

describe('movement targets = rollupMovements / monthlyMovementSeries', () => {
  const base = {
    studentName: 'A Child',
    enroleeNumber: 'E1',
    ayCode: 'AY2026',
    termLabel: null,
    actorEmail: null,
  };
  let n = 0;
  const ev = (over: Record<string, unknown>) =>
    ({
      ...base,
      id: `a${(n += 1)}`,
      studentNumber: `S${n}`,
      termNumber: null,
      ...over,
    }) as MovementEvent;
  const events: MovementEvent[] = [
    ev({
      kind: 'late-enrolled',
      level: 'Primary One',
      termNumber: 2,
      date: '2026-03-10',
    }),
    ev({ kind: 'late-enrolled', level: 'Primary One', date: '2026-04-02' }),
    ev({
      kind: 'late-enrolled',
      level: 'Youngstarters',
      termNumber: 3,
      date: '2026-08-02',
    }),
    ev({ kind: 're-enrolled', level: 'Primary Two', date: '2026-03-15' }),
    ev({
      kind: 'withdrawn',
      level: 'Primary One',
      reason: 'financial',
      reasonLabel: 'Financial / non-payment',
      date: '2026-03-20',
    }),
    ev({
      kind: 'withdrawn',
      level: 'Primary Two',
      reason: 'family_relocation',
      reasonLabel: 'Family relocating',
      date: '2026-06-11',
    }),
    ev({
      kind: 'withdrawn',
      level: 'Primary One',
      reason: null,
      reasonLabel: null,
      date: '2026-06-30',
    }),
    ev({
      kind: 'withdrawn',
      level: '',
      reason: 'financial',
      reasonLabel: 'Financial / non-payment',
      date: '2026-12-01',
    }),
    ev({
      kind: 'section-transfer',
      level: 'Primary One',
      fromSection: 'A',
      toSection: 'B',
      date: '2026-03-01',
    }),
  ];
  const rows = movementDrillRowsFrom(events, [] as RecordsDrillRow[]);
  const rollup = rollupMovements(events);
  const monthly = monthlyMovementSeries(events, INSIGHTS_MOVEMENT_MONTHS);
  const c = (t: Parameters<typeof applyTargetFilter>[1], seg: string | null) =>
    applyTargetFilter(rows, t, seg).length;

  it('late enrollees: total, every level, every term', () => {
    expect(c('late-enrollees', null)).toBe(rollup.counts.lateEnrolled);
    for (const l of rollup.lateByLevel)
      expect(
        c('late-enrollees', encodeInsightsSegment({ level: l.level }))
      ).toBe(l.count);
    for (const t of rollup.lateByTerm)
      expect(
        c(
          'late-enrollees',
          encodeInsightsSegment({ term: String(t.termNumber) })
        )
      ).toBe(t.count);
  });
  it('withdrawals: total, every reason, every level, every matrix cell', () => {
    expect(c('withdrawals', null)).toBe(rollup.counts.withdrawn);
    for (const r of rollup.withdrawalsByReason)
      expect(
        c('withdrawals', encodeInsightsSegment({ reason: r.reason }))
      ).toBe(r.count);
    for (const l of rollup.withdrawalsByLevel)
      expect(c('withdrawals', encodeInsightsSegment({ level: l.level }))).toBe(
        l.count
      );
    for (const row of rollup.withdrawalsByReasonAndLevel)
      for (const [reason, cnt] of Object.entries(row.reasonCounts))
        expect(
          c('withdrawals', encodeInsightsSegment({ level: row.level, reason }))
        ).toBe(cnt);
  });
  it('the preventable share is readable off the rows', () => {
    const all = applyTargetFilter(rows, 'withdrawals', null);
    expect(all.filter((r) => r.controllable === 'controllable')).toHaveLength(
      rollup.controllability.controllableCount
    );
    expect(all.filter((r) => r.controllable === 'unspecified')).toHaveLength(
      rollup.controllability.unspecifiedCount
    );
  });
  it('every month × flow bar, zero months included', () => {
    for (const p of monthly) {
      expect(
        c(
          'movement-month',
          encodeInsightsSegment({ flow: 'enrollments', month: p.month })
        )
      ).toBe(p.enrollments);
      expect(
        c(
          'movement-month',
          encodeInsightsSegment({ flow: 'withdrawals', month: p.month })
        )
      ).toBe(p.withdrawals);
    }
  });
});
