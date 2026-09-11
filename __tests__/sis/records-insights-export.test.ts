/**
 * Unit tests for lib/sis/records-insights-export.ts::buildRecordsInsightsExport
 *
 * Pure — every value comes from fixtures typed off the real loader/derived
 * shapes app/(records)/records/insights/page.tsx passes in. No DB, no clock.
 * Mirrors the page: one section per rendered widget, in the page's render
 * order, matching each widget's own display precision (PRECISION ruling).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ComparisonCardState } from '@/lib/dashboard/comparison';
import type { Delta } from '@/lib/dashboard/range';
import type {
  Retention,
  LevelCountRow,
  MonthlyMovementPoint,
} from '@/lib/sis/records-insights';
import type { RetentionStackRow } from '@/components/dashboard/charts/retention-stacked-bar-chart';
import type { AttritionStackedBarPoint } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import type { ComposedBarLinePoint } from '@/components/dashboard/charts/composed-bar-line-chart';
import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
import type { DonutSlice } from '@/components/dashboard/charts/donut-chart';
import type {
  NationalityByLevel,
  NationalityMixRow,
} from '@/lib/admissions/insights-funnel';
import {
  buildRecordsInsightsExport,
  type BuildRecordsInsightsExportInput,
} from '@/lib/sis/records-insights-export';

const retentionOk: Retention = {
  priorAy: 'AY2025',
  returned: 300,
  didNotReturn: 60,
  priorTotal: 360,
  pct: 83.3, // fractional fixture — pins 1dp precision (MetricCard toFixed(1))
};

function baseInput(
  overrides: Partial<BuildRecordsInsightsExportInput> = {}
): BuildRecordsInsightsExportInput {
  return {
    ayCode: 'AY2026',
    compareAy: null,
    headcountTotal: 406,
    priorTotal: null,
    enrolledDelta: undefined,
    retentionState: 'building',
    retentionPct: null,
    lateEnrolledCount: 12,
    populationComposedData: [],
    haveCategoryMixData: false,
    categoryMixData: [],
    nationalityMix: [],
    nationalityByLevel: { legend: [], rows: [] },
    haveMovementActivity: false,
    movementBarData: [],
    retention: {
      priorAy: null,
      returned: 0,
      didNotReturn: 0,
      priorTotal: 0,
      pct: null,
    },
    haveRetentionByLevel: false,
    retentionStackData: [],
    haveLate: false,
    lateLevelDonutData: [],
    lateTermBarData: [],
    haveWithdrawals: false,
    hasSpecifiedWithdrawalReasons: false,
    reasonDonutData: [],
    withdrawalsByLevel: [],
    withdrawnTotal: 0,
    haveAttritionMatrix: false,
    attritionStackedData: [],
    withdrawalReasonKeys: [],
    ...overrides,
  };
}

describe('buildRecordsInsightsExport', () => {
  // ── filename + scope ───────────────────────────────────────────────────

  it('names the file via insightsFilename and carries scope lines', () => {
    const result = buildRecordsInsightsExport(
      baseInput({ ayCode: 'AY2026', compareAy: 'AY2025' })
    );
    expect(result.filename).toBe('records-insights-AY2026-vs-AY2025.csv');
    expect(result.scope).toEqual([
      ['Page', 'Records insights'],
      ['Academic year', 'AY2026'],
      ['Compared with', 'AY2025'],
    ]);
  });

  it('omits the Compared with scope line when there is no comparison AY', () => {
    const result = buildRecordsInsightsExport(baseInput({ compareAy: null }));
    expect(result.scope).toEqual([
      ['Page', 'Records insights'],
      ['Academic year', 'AY2026'],
    ]);
  });

  // ── Key figures ────────────────────────────────────────────────────────

  it('builds Key figures with the Enrolled delta chip value, never current−previous', () => {
    // Deliberately NOT (450-400)/400*100 = 12.5 — pins that Change carries
    // the chip's own delta.pct, not a re-derived one.
    const enrolledDelta: Delta = { abs: 50, pct: 12.345, direction: 'up' };
    const result = buildRecordsInsightsExport(
      baseInput({
        headcountTotal: 450,
        priorTotal: 400,
        enrolledDelta,
        retentionState: 'ok',
        retentionPct: retentionOk.pct,
        lateEnrolledCount: 12,
      })
    );
    const section = result.sections.find((s) => s.title === 'Key figures')!;
    expect(section.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(section.rows).toEqual([
      ['Enrolled', 450, 400, 12.3],
      ['Retention rate', 83.3, null, null],
      ['Late enrollees', 12, null, null],
    ]);
  });

  it('exports a blank Retention rate cell when the card shows "—" (not ok)', () => {
    const result = buildRecordsInsightsExport(
      baseInput({ retentionState: 'building', retentionPct: null })
    );
    const section = result.sections.find((s) => s.title === 'Key figures')!;
    const row = section.rows.find((r) => r[0] === 'Retention rate')!;
    expect(row[1]).toBeNull();
  });

  it('leaves Enrolled Previous/Change blank when there is no comparison', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        headcountTotal: 200,
        priorTotal: null,
        enrolledDelta: undefined,
      })
    );
    const section = result.sections.find((s) => s.title === 'Key figures')!;
    expect(section.rows[0]).toEqual(['Enrolled', 200, null, null]);
  });

  // ── Population by level — comparison-only ─────────────────────────────

  it('omits Population by level with no comparison AY', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        compareAy: null,
        populationComposedData: [{ category: 'P1', bar: 10, line: 8 }],
      })
    );
    expect(
      result.sections.find((s) => s.title === 'Population by level')
    ).toBeUndefined();
  });

  it('builds Population by level rows from the plotted bar+line points', () => {
    const populationComposedData: ComposedBarLinePoint[] = [
      { category: 'P1', bar: 40, line: 35 },
      { category: 'P2', bar: 38, line: 40 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({ compareAy: 'AY2025', populationComposedData })
    );
    const section = result.sections.find(
      (s) => s.title === 'Population by level'
    )!;
    expect(section.headers).toEqual(['Level', 'AY2026', 'AY2025']);
    expect(section.rows).toEqual([
      ['P1', 40, 35],
      ['P2', 38, 40],
    ]);
  });

  // ── Category mix — comparison-only ────────────────────────────────────

  it('omits Category mix with no comparison AY', () => {
    const result = buildRecordsInsightsExport(baseInput({ compareAy: null }));
    expect(
      result.sections.find((s) => s.title === 'Category mix')
    ).toBeUndefined();
  });

  it('emits Category mix with zero rows when the card shows its empty state', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        compareAy: 'AY2025',
        haveCategoryMixData: false,
        categoryMixData: [{ x: 'New', current: 0, compare: 0 }],
      })
    );
    const section = result.sections.find((s) => s.title === 'Category mix')!;
    expect(section.rows).toEqual([]);
  });

  it('builds Category mix rows when the card has data', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        compareAy: 'AY2025',
        haveCategoryMixData: true,
        categoryMixData: [
          { x: 'New', current: 30, compare: 22 },
          { x: 'Current', current: 350, compare: 300 },
        ],
      })
    );
    const section = result.sections.find((s) => s.title === 'Category mix')!;
    expect(section.headers).toEqual(['Category', 'AY2026', 'AY2025']);
    expect(section.rows).toEqual([
      ['New', 30, 22],
      ['Current', 350, 300],
    ]);
  });

  // ── Nationality mix — always present ──────────────────────────────────

  it('always includes Nationality mix, even with zero rows', () => {
    const result = buildRecordsInsightsExport(
      baseInput({ nationalityMix: [] })
    );
    const section = result.sections.find((s) => s.title === 'Nationality mix');
    expect(section).toEqual({
      title: 'Nationality mix',
      headers: ['Nationality', 'Students'],
      rows: [],
    });
  });

  it('lists nationality mix counts, current AY only (the pie plots no comparison series)', () => {
    const nationalityMix: NationalityMixRow[] = [
      { nationality: 'Singaporean', count: 200 },
      { nationality: 'Other', count: 50, foldedCount: 5 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({ compareAy: 'AY2025', nationalityMix })
    );
    const section = result.sections.find((s) => s.title === 'Nationality mix')!;
    expect(section.rows).toEqual([
      ['Singaporean', 200],
      ['Other', 50],
    ]);
  });

  // ── Nationality by level — always present ─────────────────────────────

  it('always includes Nationality by level, even with zero rows', () => {
    const result = buildRecordsInsightsExport(
      baseInput({ nationalityByLevel: { legend: [], rows: [] } })
    );
    const section = result.sections.find(
      (s) => s.title === 'Nationality by level'
    );
    expect(section).toEqual({
      title: 'Nationality by level',
      headers: ['Level', 'Total'],
      rows: [],
    });
  });

  it('builds a level × nationality matrix, zero-filling nationalities absent from a level', () => {
    const nationalityByLevel: NationalityByLevel = {
      legend: ['Singaporean', 'Chinese', 'Other'],
      rows: [
        {
          level: 'P1',
          total: 12,
          segments: [
            { nationality: 'Singaporean', count: 10 },
            { nationality: 'Other', count: 2 },
          ],
        },
      ],
    };
    const result = buildRecordsInsightsExport(
      baseInput({ nationalityByLevel })
    );
    const section = result.sections.find(
      (s) => s.title === 'Nationality by level'
    )!;
    expect(section.headers).toEqual([
      'Level',
      'Singaporean',
      'Chinese',
      'Other',
      'Total',
    ]);
    expect(section.rows).toEqual([['P1', 10, 0, 2, 12]]);
  });

  // ── Monthly moves in/out — always present ─────────────────────────────

  it('emits Monthly moves in/out with zero rows when there is no movement activity', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        haveMovementActivity: false,
        movementBarData: [{ month: 'Jan', enrollments: 0, withdrawals: 0 }],
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Monthly moves in/out'
    )!;
    expect(section.rows).toEqual([]);
  });

  it('lists monthly moves rows when there is activity', () => {
    const movementBarData: MonthlyMovementPoint[] = [
      { month: 'Jan', enrollments: 3, withdrawals: 1 },
      { month: 'Feb', enrollments: 0, withdrawals: 2 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({ haveMovementActivity: true, movementBarData })
    );
    const section = result.sections.find(
      (s) => s.title === 'Monthly moves in/out'
    )!;
    expect(section.headers).toEqual(['Month', 'Enrollments', 'Withdrawals']);
    expect(section.rows).toEqual([
      ['Jan', 3, 1],
      ['Feb', 0, 2],
    ]);
  });

  // ── Retention section (or absent — Building history has no figures) ────

  it('omits the Retention section when the card shows Building history / no-data', () => {
    for (const retentionState of [
      'building',
      'no-data',
    ] as ComparisonCardState[]) {
      const result = buildRecordsInsightsExport(baseInput({ retentionState }));
      expect(
        result.sections.find((s) => s.title === 'Retention')
      ).toBeUndefined();
    }
  });

  it('builds the Retention section with an All-levels row plus per-level rows', () => {
    const retentionStackData: RetentionStackRow[] = [
      { level: 'P1', returned: 20, didNotReturn: 5, priorTotal: 25, pct: 80 },
      { level: 'P2', returned: 18, didNotReturn: 12, priorTotal: 30, pct: 60 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({
        retentionState: 'ok',
        retention: retentionOk,
        haveRetentionByLevel: true,
        retentionStackData,
      })
    );
    const section = result.sections.find((s) => s.title === 'Retention')!;
    expect(section.headers).toEqual([
      'Level',
      'Returned',
      'Did not return',
      'Prior cohort',
      'Retention %',
    ]);
    expect(section.rows).toEqual([
      ['All levels', 300, 60, 360, 83.3],
      ['P1', 20, 5, 25, 80],
      ['P2', 18, 12, 30, 60],
    ]);
  });

  it('emits only the All-levels row when the per-level breakdown is not available yet', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        retentionState: 'ok',
        retention: retentionOk,
        haveRetentionByLevel: false,
        retentionStackData: [],
      })
    );
    const section = result.sections.find((s) => s.title === 'Retention')!;
    expect(section.rows).toEqual([['All levels', 300, 60, 360, 83.3]]);
  });

  // ── Late joins — both sections share one gate ─────────────────────────

  it('omits both Late joins sections when the page shows the single empty-state card', () => {
    const result = buildRecordsInsightsExport(baseInput({ haveLate: false }));
    expect(
      result.sections.find((s) => s.title === 'Late joins by level')
    ).toBeUndefined();
    expect(
      result.sections.find((s) => s.title === 'Late joins by term')
    ).toBeUndefined();
  });

  it('builds both Late joins sections when there are late enrollees', () => {
    const lateLevelDonutData: DonutSlice[] = [
      { name: 'P1', value: 5 },
      { name: 'P2', value: 3 },
    ];
    const lateTermBarData: ComparisonBarPoint[] = [
      { category: 'Term 1', current: 4 },
      { category: 'Term 2', current: 4 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({ haveLate: true, lateLevelDonutData, lateTermBarData })
    );
    const byLevel = result.sections.find(
      (s) => s.title === 'Late joins by level'
    )!;
    expect(byLevel.headers).toEqual(['Level', 'Late enrollees']);
    expect(byLevel.rows).toEqual([
      ['P1', 5],
      ['P2', 3],
    ]);
    const byTerm = result.sections.find(
      (s) => s.title === 'Late joins by term'
    )!;
    expect(byTerm.headers).toEqual(['Term', 'Late enrollees']);
    expect(byTerm.rows).toEqual([
      ['Term 1', 4],
      ['Term 2', 4],
    ]);
  });

  // ── Withdrawals — three sections share one top-level gate ─────────────

  it('omits all three withdrawal sections when the page shows the single empty-state card', () => {
    const result = buildRecordsInsightsExport(
      baseInput({ haveWithdrawals: false })
    );
    expect(
      result.sections.find((s) => s.title === 'Withdrawal reasons')
    ).toBeUndefined();
    expect(
      result.sections.find((s) => s.title === 'Withdrawals by level')
    ).toBeUndefined();
    expect(
      result.sections.find((s) => s.title === 'Attrition')
    ).toBeUndefined();
  });

  it('emits Withdrawal reasons with zero rows when every reason is Unspecified', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: false,
        reasonDonutData: [{ name: 'Unspecified', value: 10 }],
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Withdrawal reasons'
    )!;
    expect(section.rows).toEqual([]);
  });

  it('lists Withdrawal reasons rows when reasons are recorded', () => {
    const reasonDonutData: DonutSlice[] = [
      { name: 'Financial', value: 6 },
      { name: 'Family relocation', value: 4 },
    ];
    const result = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: true,
        reasonDonutData,
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Withdrawal reasons'
    )!;
    expect(section.headers).toEqual(['Reason', 'Withdrawals']);
    expect(section.rows).toEqual([
      ['Financial', 6],
      ['Family relocation', 4],
    ]);
  });

  it('computes Withdrawals by level share the same way as the on-screen LevelStatRow (Math.round)', () => {
    const withdrawalsByLevel: LevelCountRow[] = [
      { level: 'P1', count: 1 }, // 1 of 3 = 33.33% → rounds to 33
      { level: 'P2', count: 2 }, // 2 of 3 = 66.67% → rounds to 67
    ];
    const result = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        withdrawalsByLevel,
        withdrawnTotal: 3,
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Withdrawals by level'
    )!;
    expect(section.headers).toEqual(['Level', 'Students', 'Share (%)']);
    expect(section.rows).toEqual([
      ['P1', 1, 33],
      ['P2', 2, 67],
    ]);
  });

  it('omits Attrition (reason concentration by level) unless both reasons are specified and a matrix exists', () => {
    const attritionStackedData: AttritionStackedBarPoint[] = [
      { level: 'P1', Financial: 2, 'Family relocation': 1 },
    ];
    const withdrawalReasonKeys = ['Financial', 'Family relocation'];

    const noReasons = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: false,
        haveAttritionMatrix: true,
        attritionStackedData,
        withdrawalReasonKeys,
      })
    );
    expect(
      noReasons.sections.find((s) => s.title === 'Attrition')
    ).toBeUndefined();

    const noMatrix = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: true,
        haveAttritionMatrix: false,
      })
    );
    expect(
      noMatrix.sections.find((s) => s.title === 'Attrition')
    ).toBeUndefined();
  });

  it('builds Attrition (reason concentration by level) rows as a level × reason matrix', () => {
    const attritionStackedData: AttritionStackedBarPoint[] = [
      { level: 'P1', Financial: 2, 'Family relocation': 1 },
      { level: 'P2', Financial: 0, 'Family relocation': 3 },
    ];
    const withdrawalReasonKeys = ['Financial', 'Family relocation'];
    const result = buildRecordsInsightsExport(
      baseInput({
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: true,
        haveAttritionMatrix: true,
        attritionStackedData,
        withdrawalReasonKeys,
      })
    );
    const section = result.sections.find((s) => s.title === 'Attrition')!;
    expect(section.headers).toEqual([
      'Level',
      'Financial',
      'Family relocation',
    ]);
    expect(section.rows).toEqual([
      ['P1', 2, 1],
      ['P2', 0, 3],
    ]);
  });

  // ── Section order mirrors the page's render order ──────────────────────

  it('orders sections exactly as the page renders them, everything present', () => {
    const result = buildRecordsInsightsExport(
      baseInput({
        compareAy: 'AY2025',
        headcountTotal: 450,
        priorTotal: 400,
        enrolledDelta: { abs: 50, pct: 12.5, direction: 'up' },
        retentionState: 'ok',
        retention: retentionOk,
        retentionPct: retentionOk.pct,
        haveRetentionByLevel: true,
        retentionStackData: [
          {
            level: 'P1',
            returned: 20,
            didNotReturn: 5,
            priorTotal: 25,
            pct: 80,
          },
        ],
        populationComposedData: [{ category: 'P1', bar: 40, line: 35 }],
        haveCategoryMixData: true,
        categoryMixData: [{ x: 'New', current: 30, compare: 22 }],
        nationalityMix: [{ nationality: 'Singaporean', count: 200 }],
        nationalityByLevel: {
          legend: ['Singaporean'],
          rows: [
            {
              level: 'P1',
              total: 10,
              segments: [{ nationality: 'Singaporean', count: 10 }],
            },
          ],
        },
        haveMovementActivity: true,
        movementBarData: [{ month: 'Jan', enrollments: 3, withdrawals: 1 }],
        haveLate: true,
        lateLevelDonutData: [{ name: 'P1', value: 5 }],
        lateTermBarData: [{ category: 'Term 1', current: 5 }],
        haveWithdrawals: true,
        hasSpecifiedWithdrawalReasons: true,
        reasonDonutData: [{ name: 'Financial', value: 6 }],
        withdrawalsByLevel: [{ level: 'P1', count: 6 }],
        withdrawnTotal: 6,
        haveAttritionMatrix: true,
        attritionStackedData: [{ level: 'P1', Financial: 6 }],
        withdrawalReasonKeys: ['Financial'],
      })
    );
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Population by level',
      'Category mix',
      'Nationality mix',
      'Nationality by level',
      'Monthly moves in/out',
      'Retention',
      'Late joins by level',
      'Late joins by term',
      'Withdrawal reasons',
      'Withdrawals by level',
      'Attrition',
    ]);
  });
});

describe('records insights page wiring', () => {
  it('renders ExportCsvButton exactly once', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(records)/records/insights/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
