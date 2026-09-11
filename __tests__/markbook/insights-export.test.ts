/**
 * Unit tests for lib/markbook/insights-export.ts::buildMarkbookInsightsExport
 *
 * Pure — every value comes from fixtures typed off the real loader/derived
 * shapes the page passes in. No DB, no clock. Mirrors the page: one section
 * per rendered widget, in the page's render order, matching each widget's
 * own display precision (Hard Rule / PRECISION ruling).
 */
import { describe, expect, it } from 'vitest';

import type { ChangeRequestSummary } from '@/lib/markbook/dashboard';
import {
  buildMarkbookInsightsExport,
  type BuildMarkbookInsightsExportInput,
} from '@/lib/markbook/insights-export';
import type { SubjectLevelDelta } from '@/lib/markbook/insights-level';
import type { TrendPoint } from '@/lib/markbook/insights-compare';

function baseChangeRequests(
  overrides: Partial<ChangeRequestSummary> = {}
): ChangeRequestSummary {
  return {
    byStatus: {
      pending: 0,
      approved: 0,
      applied: 0,
      rejected: 0,
      cancelled: 0,
    },
    total: 0,
    avgDecisionHours: null,
    windowDays: 30,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<BuildMarkbookInsightsExportInput> = {}
): BuildMarkbookInsightsExportInput {
  return {
    ayCode: 'AY2026',
    compareAy: null,
    haveTrend: false,
    trendBarSeries: [],
    trendBarData: [],
    watchRows: [],
    levelLineData: [],
    schoolAvgAcrossLevels: 0,
    regressionMovers: [],
    changeRequests: baseChangeRequests(),
    lockBarData: [],
    ...overrides,
  };
}

describe('buildMarkbookInsightsExport', () => {
  it('sets filename via insightsFilename and scope lines', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({ ayCode: 'AY2026', compareAy: 'AY2025' })
    );
    expect(result.filename).toBe('markbook-insights-AY2026-vs-AY2025.csv');
    expect(result.scope).toEqual([
      ['Page', 'Markbook insights'],
      ['Academic year', 'AY2026'],
      ['Compared with', 'AY2025'],
    ]);
  });

  it('omits the Compared with scope line when there is no comparison AY', () => {
    const result = buildMarkbookInsightsExport(baseInput({ compareAy: null }));
    expect(result.scope).toEqual([
      ['Page', 'Markbook insights'],
      ['Academic year', 'AY2026'],
    ]);
  });

  // ── Subject performance trend ──────────────────────────────────────────────

  it('omits the subject performance trend section when the page has none', () => {
    const result = buildMarkbookInsightsExport(baseInput({ haveTrend: false }));
    expect(
      result.sections.find((s) => s.title === 'Subject performance trend')
    ).toBeUndefined();
  });

  it('builds the subject performance trend section from series + data, one column per subject', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        haveTrend: true,
        trendBarSeries: [
          { key: 'Math · AY2026', label: 'Math' },
          { key: 'English · AY2026', label: 'English' },
        ],
        trendBarData: [
          { x: 'T1', 'Math · AY2026': 82.3, 'English · AY2026': null },
          { x: 'T2', 'Math · AY2026': 85, 'English · AY2026': 79.6 },
        ],
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Subject performance trend'
    );
    expect(section).toBeDefined();
    expect(section!.headers).toEqual(['Term', 'Math', 'English']);
    expect(section!.rows).toEqual([
      ['T1', 82.3, null],
      ['T2', 85, 79.6],
    ]);
  });

  // ── Subjects to watch — always present ─────────────────────────────────────

  it('always includes Subjects to watch, even with zero rows (empty-state mirror)', () => {
    const result = buildMarkbookInsightsExport(baseInput({ watchRows: [] }));
    const section = result.sections.find(
      (s) => s.title === 'Subjects to watch'
    );
    expect(section).toEqual({
      title: 'Subjects to watch',
      headers: ['Subject', 'Average grade'],
      rows: [],
    });
  });

  it('lists watch rows with their rounded average grade', () => {
    const watchRows: TrendPoint[] = [
      {
        periodLabel: 'T3',
        ayCode: 'AY2026',
        subjectName: 'Science',
        avgGrade: 71.25,
      },
      {
        periodLabel: 'T3',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 74,
      },
    ];
    const result = buildMarkbookInsightsExport(baseInput({ watchRows }));
    const section = result.sections.find(
      (s) => s.title === 'Subjects to watch'
    );
    // 71.25 rounds to 1dp — matching the ComparisonBarChart's yFormat="number"
    // display, which never truncates the source's already-1dp values.
    expect(section!.rows).toEqual([
      ['Science', 71.3],
      ['Math', 74],
    ]);
  });

  // ── Which levels are struggling — omitted when empty ────────────────────────

  it('omits the level section entirely when there is no level data (not an empty state)', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({ levelLineData: [] })
    );
    expect(
      result.sections.find((s) => s.title === 'Which levels are struggling')
    ).toBeUndefined();
  });

  it('includes a School average row alongside each plotted level', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        levelLineData: [
          { x: 'P1', y: 88.4 },
          { x: 'P2', y: 81 },
        ],
        schoolAvgAcrossLevels: 84.7,
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Which levels are struggling'
    );
    expect(section).toEqual({
      title: 'Which levels are struggling',
      headers: ['Level', 'Average grade'],
      rows: [
        ['P1', 88.4],
        ['P2', 81],
        ['School average', 84.7],
      ],
    });
  });

  // ── Term-over-term movement — omitted when empty ────────────────────────────

  it('omits the term-over-term movement section when there are no movers', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({ regressionMovers: [] })
    );
    expect(
      result.sections.find((s) => s.title === 'Term-over-term movement')
    ).toBeUndefined();
  });

  it('builds term-over-term movement rows from the shared selection output, in the order given', () => {
    const regressionMovers: SubjectLevelDelta[] = [
      {
        subjectName: 'Science',
        levelCode: 'P3',
        firstAvg: 90,
        lastAvg: 82.5,
        delta: -7.5,
        termCount: 2,
        fromPeriod: 'T1',
        toPeriod: 'T3',
      },
      {
        subjectName: 'Math',
        levelCode: 'S1',
        firstAvg: 70,
        lastAvg: 76,
        delta: 6,
        termCount: 2,
        fromPeriod: 'T2',
        toPeriod: 'T4',
      },
    ];
    const result = buildMarkbookInsightsExport(baseInput({ regressionMovers }));
    const section = result.sections.find(
      (s) => s.title === 'Term-over-term movement'
    );
    expect(section).toEqual({
      title: 'Term-over-term movement',
      headers: [
        'Subject · Level',
        'From term',
        'From average',
        'To term',
        'To average',
      ],
      rows: [
        ['Science · P3', 'T1', 90, 'T3', 82.5],
        ['Math · S1', 'T2', 70, 'T4', 76],
      ],
    });
  });

  // ── Key figures (change requests) — always present, never a derived delta ──

  it('builds Key figures from the change-request summary, with blank Previous/Change', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        changeRequests: baseChangeRequests({
          total: 12,
          byStatus: {
            pending: 3,
            approved: 2,
            applied: 6,
            rejected: 1,
            cancelled: 0,
          },
          avgDecisionHours: 5.2,
          windowDays: 30,
        }),
      })
    );
    const section = result.sections.find((s) => s.title === 'Key figures');
    expect(section).toEqual({
      title: 'Key figures',
      headers: ['Figure', 'This period', 'Previous period', 'Change'],
      rows: [
        ['Change requests (last 30 days)', 12, null, null],
        ['Pending decisions', 3, null, null],
        ['Avg decision time (hours)', 5.2, null, null],
      ],
    });
  });

  it('a null avgDecisionHours exports as an empty cell, not a dash', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        changeRequests: baseChangeRequests({ avgDecisionHours: null }),
      })
    );
    const section = result.sections.find((s) => s.title === 'Key figures');
    const row = section!.rows.find((r) => r[0] === 'Avg decision time (hours)');
    expect(row![1]).toBeNull();
  });

  // ── Sheets locked · per term — always present, empty state mirrored ────────

  it('always includes Sheets locked · per term, even with zero rows', () => {
    const result = buildMarkbookInsightsExport(baseInput({ lockBarData: [] }));
    const section = result.sections.find(
      (s) => s.title === 'Sheets locked · per term'
    );
    expect(section).toEqual({
      title: 'Sheets locked · per term',
      headers: ['Term', 'Locked (%)'],
      rows: [],
    });
  });

  it('lists lock rows as whole-number percents, matching the chart’s value labels', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        lockBarData: [
          { x: 'Term 1', locked: 96 },
          { x: 'Term 2', locked: 61 },
        ],
      })
    );
    const section = result.sections.find(
      (s) => s.title === 'Sheets locked · per term'
    );
    expect(section!.rows).toEqual([
      ['Term 1', 96],
      ['Term 2', 61],
    ]);
  });

  // ── Section order mirrors the page's render order ──────────────────────────

  it('orders sections exactly as the page renders them', () => {
    const result = buildMarkbookInsightsExport(
      baseInput({
        haveTrend: true,
        trendBarSeries: [{ key: 'Math · AY2026', label: 'Math' }],
        trendBarData: [{ x: 'T1', 'Math · AY2026': 80 }],
        levelLineData: [{ x: 'P1', y: 80 }],
        regressionMovers: [
          {
            subjectName: 'Math',
            levelCode: 'P1',
            firstAvg: 80,
            lastAvg: 75,
            delta: -5,
            termCount: 2,
            fromPeriod: 'T1',
            toPeriod: 'T2',
          },
        ],
      })
    );
    expect(result.sections.map((s) => s.title)).toEqual([
      'Subject performance trend',
      'Subjects to watch',
      'Which levels are struggling',
      'Term-over-term movement',
      'Key figures',
      'Sheets locked · per term',
    ]);
  });
});
