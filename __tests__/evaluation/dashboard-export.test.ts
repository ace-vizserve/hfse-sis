import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  EvaluationChaseKpis,
  EvaluationKpis,
} from '@/lib/evaluation/dashboard';
import type { SectionWriteupRow } from '@/lib/evaluation/drill';
import type { RangeResult } from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import {
  buildEvaluationDashboardExport,
  type BuildEvaluationDashboardExportInput,
} from '@/lib/evaluation/dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

// 143/169 -> 84.615...% — fractional fixture so a rounding leak (chart's
// 0-decimal Math.round vs the KPI card's own 1-decimal toFixed) would fail
// the test that pins the Key figures cell.
const kpis: RangeResult<EvaluationKpis> = {
  current: { submissionPct: 84.6153846, submitted: 143, expected: 169 },
  comparison: { submissionPct: 79.2899, submitted: 134, expected: 169 },
  // Deliberately NOT current−previous (84.615 − 79.29 = 5.33 pts, which as a
  // *relative* % move would read differently again) — pins that Change
  // carries the chip's own delta.pct, not a re-derived figure.
  delta: { abs: 9, pct: 6.7891, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const velocity: RangeResult<VelocityPoint[]> = {
  current: [
    { x: '2026-08-01', y: 5 },
    { x: '2026-08-02', y: 8 },
  ],
  comparison: [
    { x: '2026-07-01', y: 3 },
    { x: '2026-07-02', y: 6 },
  ],
  delta: { abs: 4, pct: 44.4, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const chaseKpis: EvaluationChaseKpis = {
  available: true,
  outstandingWriteups: 26,
  advisersBehind: 4,
  hasUnassignedSection: false,
};

const bySection: SectionWriteupRow[] = [
  {
    sectionId: 'sec-b',
    sectionName: 'P2-A',
    level: 'P2',
    termNumber: 1,
    total: 30,
    submitted: 10,
    draft: 5,
    missing: 15,
    submissionPct: 33,
  },
  {
    sectionId: 'sec-a',
    sectionName: 'P1-A',
    level: 'P1',
    termNumber: 1,
    total: 30,
    submitted: 27,
    draft: 1,
    missing: 2,
    submissionPct: 90,
  },
];

const baseInput: BuildEvaluationDashboardExportInput = {
  ayCode: 'AY2026',
  rangeInput: {
    ayCode: 'AY2026',
    from: '2026-08-01',
    to: '2026-08-31',
    cmpFrom: '2026-07-01',
    cmpTo: '2026-07-31',
  },
  kpis,
  velocity,
  chaseKpis,
  bySection,
};

describe('buildEvaluationDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    expect(result.filename).toBe(
      'evaluation-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines including the comparison range', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'Evaluation dashboard']);
    expect(result.scope).toContainEqual(['Academic year', 'AY2026']);
    expect(result.scope).toContainEqual([
      'Date range',
      '2026-08-01 to 2026-08-31',
    ]);
    expect(result.scope).toContainEqual([
      'Compared with',
      '2026-07-01 to 2026-07-31',
    ]);
  });

  it('omits Compared with when there is no comparison range', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      rangeInput: {
        ayCode: 'AY2026',
        from: '2026-08-01',
        to: '2026-08-31',
        cmpFrom: null,
        cmpTo: null,
      },
    });
    expect(result.scope.some(([label]) => label === 'Compared with')).toBe(
      false
    );
  });

  it('produces one section per widget the oversight branch renders, in render order', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Submissions per day',
      'Write-ups by section',
    ]);
  });

  it('rounds Submission % to the KPI card own 1-decimal precision, and carries the delta chip number for Change', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    const keyFigures = result.sections[0];
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Submission %', 84.6, 79.3, roundTo(kpis.delta!.pct, 1)],
      ['Submitted', 143, null, null],
      ['Outstanding write-ups', 26, null, null],
      ['Advisers behind', 4, null, null],
    ]);
    // Pin: the chip's own delta.pct (6.8), never (143-134)/134*100 = 6.7.
    expect(keyFigures.rows[0][3]).toBe(6.8);
  });

  it('blanks the two chase figures instead of the on-screen em dash when there is no writeup term', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      chaseKpis: {
        available: false,
        outstandingWriteups: 0,
        advisersBehind: 0,
        hasUnassignedSection: false,
      },
    });
    const keyFigures = result.sections[0];
    expect(keyFigures.rows).toEqual([
      ['Submission %', 84.6, 79.3, roundTo(kpis.delta!.pct, 1)],
      ['Submitted', 143, null, null],
      ['Outstanding write-ups', null, null, null],
      ['Advisers behind', null, null, null],
    ]);
  });

  it('blanks the two chase figures when chaseKpis is null', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      chaseKpis: null,
    });
    const keyFigures = result.sections[0];
    expect(keyFigures.rows[2]).toEqual([
      'Outstanding write-ups',
      null,
      null,
      null,
    ]);
    expect(keyFigures.rows[3]).toEqual(['Advisers behind', null, null, null]);
  });

  it('renders submissions-per-day aligned by position, like the chart', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    const trend = result.sections.find(
      (s) => s.title === 'Submissions per day'
    )!;
    expect(trend.headers).toEqual([
      'Date',
      'Submissions',
      'Comparison submissions',
    ]);
    expect(trend.rows).toEqual([
      ['2026-08-01', 5, 3],
      ['2026-08-02', 8, 6],
    ]);
  });

  it('omits submissions-per-day when there are 0 or 1 points', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      velocity: {
        ...velocity,
        current: [{ x: '2026-08-01', y: 5 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Submissions per day'
    );
  });

  it('renders write-ups by section straight from the shared rollup, no re-sort', () => {
    const result = buildEvaluationDashboardExport(baseInput);
    const bySectionSection = result.sections.find(
      (s) => s.title === 'Write-ups by section'
    )!;
    expect(bySectionSection.headers).toEqual(['Section', 'Submission %']);
    // Same order as the input array (rollupBySection's own ascending sort),
    // never re-sorted here.
    expect(bySectionSection.rows).toEqual([
      ['P2-A', 33],
      ['P1-A', 90],
    ]);
  });

  it('omits write-ups by section when the list is empty', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      bySection: [],
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Write-ups by section'
    );
  });

  it('omits write-ups by section when null', () => {
    const result = buildEvaluationDashboardExport({
      ...baseInput,
      bySection: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Write-ups by section'
    );
  });
});

describe('evaluation dashboard page wiring', () => {
  it('renders ExportCsvButton exactly once — oversight branch only, no button for teachers', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(evaluation)/evaluation/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
