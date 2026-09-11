import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ChangeRequestSummary,
  GradeBucket,
  MarkbookRangeKpis,
  TermPubCoverage,
} from '@/lib/markbook/dashboard';
import type { SheetRow, TeacherVelocityRow } from '@/lib/markbook/drill';
import type { RangeResult } from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import {
  buildMarkbookDashboardExport,
  type BuildMarkbookDashboardExportInput,
} from '@/lib/markbook/dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

function sheetRow(overrides: Partial<SheetRow>): SheetRow {
  return {
    sheetId: 'sheet-1',
    sectionId: 'sec-1',
    sectionName: 'P1-A',
    level: 'P1',
    subjectCode: 'MATH',
    subjectName: 'Mathematics',
    termNumber: 1,
    termLabel: 'Term 1',
    termId: 'term-1',
    isLocked: false,
    lockedAt: null,
    isPublished: false,
    publishedAt: null,
    entriesPresent: 0,
    entriesExpected: 0,
    completenessPct: 0,
    teacherName: null,
    ...overrides,
  };
}

const kpis: RangeResult<MarkbookRangeKpis> = {
  current: {
    gradesEntered: 210,
    sheetsLocked: 12,
    sheetsTotal: 40,
    lockedPct: 30,
    changeRequestsPending: 3,
    avgDecisionHours: 4.2,
  },
  comparison: {
    gradesEntered: 180,
    sheetsLocked: 10,
    sheetsTotal: 40,
    lockedPct: 25,
    changeRequestsPending: 2,
    avgDecisionHours: 5.1,
  },
  // Deliberately NOT current−previous (210 − 180 = 30, 30/180 = 16.67%) —
  // pins that Change carries the chip's own delta.pct, not a re-derived one.
  delta: { abs: 30, pct: 12.3456, direction: 'up' },
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

const gradeDist: GradeBucket[] = [
  { key: 'dnm', label: '< 75 (DNM)', count: 4 },
  { key: 'fs', label: '75–79 (FS)', count: 10 },
];

const pubCoverage: TermPubCoverage[] = [
  { termNumber: 1, termLabel: 'Term 1', sections: 21, published: 21 },
  { termNumber: 2, termLabel: 'Term 2', sections: 21, published: 15 },
];

const changeRequests: ChangeRequestSummary = {
  byStatus: {
    pending: 3,
    approved: 1,
    rejected: 2,
    applied: 5,
    cancelled: 1,
  },
  total: 12,
  avgDecisionHours: 6.7,
  windowDays: 30,
};

// 1 locked of 3 total → 33.33...% — rounds to 33, never 33.3. Pins that the
// sheet-readiness ratio uses the card's own Math.round (0 decimals), the
// same computation baked into rollupSheetReadiness/lib/markbook/drill.ts.
const sheets: SheetRow[] = [
  sheetRow({
    sectionId: 's-a',
    sectionName: 'P1-A',
    level: 'P1',
    isLocked: false,
  }),
  sheetRow({
    sectionId: 's-a',
    sectionName: 'P1-A',
    level: 'P1',
    isLocked: false,
  }),
  sheetRow({
    sectionId: 's-a',
    sectionName: 'P1-A',
    level: 'P1',
    isLocked: true,
  }),
  sheetRow({
    sectionId: 's-b',
    sectionName: 'P2-A',
    level: 'P2',
    isLocked: true,
  }),
];

const teacherVelocity: TeacherVelocityRow[] = [
  {
    teacherUserId: 'user-1',
    teacherEmail: 'j.tan@hfse.edu.sg',
    entryCount: 40,
    lastEntryAt: '2026-08-20T00:00:00Z',
  },
  {
    teacherUserId: 'user-2-no-email',
    teacherEmail: null,
    entryCount: 10,
    lastEntryAt: '2026-08-18T00:00:00Z',
  },
];

const baseInput: BuildMarkbookDashboardExportInput = {
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
  gradeDist,
  pubCoverage,
  changeRequests,
  sheets,
  teacherVelocity,
};

describe('buildMarkbookDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    expect(result.filename).toBe(
      'markbook-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines including the comparison range', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'Markbook dashboard']);
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
    const result = buildMarkbookDashboardExport({
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

  it('produces one section per widget the admin branch renders, in render order', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Grade entry velocity',
      'Grade distribution',
      'Publication coverage',
      'Change request summary',
      'Sheet readiness',
      'Teacher entry velocity',
    ]);
  });

  it('carries the same Change number the delta chip shows, not current−previous', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const keyFigures = result.sections[0];
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Grades entered', 210, 180, roundTo(kpis.delta!.pct, 1)],
      ['Sheets locked (range)', 12, null, null],
      ['Change requests pending', 3, null, null],
    ]);
    // Pin: NOT (210-180)/180*100 = 16.7. Must be the chip's own 12.3.
    expect(keyFigures.rows[0][3]).toBe(12.3);
  });

  it('renders grade-entry velocity aligned by position, like the chart', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const trend = result.sections[1];
    expect(trend.headers).toEqual(['Date', 'Entries', 'Comparison entries']);
    expect(trend.rows).toEqual([
      ['2026-08-01', 5, 3],
      ['2026-08-02', 8, 6],
    ]);
  });

  it('omits the grade-entry velocity section when there are 0 or 1 points', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      velocity: {
        ...velocity,
        current: [{ x: '2026-08-01', y: 5 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Grade entry velocity'
    );
  });

  it('omits the grade-entry velocity section when velocity is null', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      velocity: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Grade entry velocity'
    );
  });

  it('renders grade distribution straight from the loader', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const dist = result.sections.find((s) => s.title === 'Grade distribution')!;
    expect(dist.headers).toEqual(['Grade band', 'Students']);
    expect(dist.rows).toEqual([
      ['< 75 (DNM)', 4],
      ['75–79 (FS)', 10],
    ]);
  });

  it('omits grade distribution when null', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      gradeDist: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Grade distribution'
    );
  });

  it('computes publication coverage the same way the stacked bar plots it', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const pub = result.sections.find(
      (s) => s.title === 'Publication coverage'
    )!;
    expect(pub.headers).toEqual([
      'Term',
      'Total sections',
      'Published',
      'Not published',
    ]);
    expect(pub.rows).toEqual([
      ['Term 1', 21, 21, 0],
      ['Term 2', 21, 15, 6],
    ]);
  });

  it('omits publication coverage when null', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      pubCoverage: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Publication coverage'
    );
  });

  it('summarizes change requests by status + avg decision hours', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const cr = result.sections.find(
      (s) => s.title === 'Change request summary'
    )!;
    expect(cr.headers).toEqual(['Metric', 'Value']);
    expect(cr.rows).toEqual([
      ['Filed (last 30 days)', 12],
      ['Avg decision (hours)', 6.7],
      ['Pending', 3],
      ['Approved · awaiting apply', 1],
      ['Applied', 5],
      ['Rejected', 2],
      ['Cancelled', 1],
    ]);
  });

  it('omits change request summary when null', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      changeRequests: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Change request summary'
    );
  });

  it('rolls up sheet readiness with the same 0-decimal rounding as the card', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const readiness = result.sections.find(
      (s) => s.title === 'Sheet readiness'
    )!;
    expect(readiness.headers).toEqual([
      'Section',
      'Level',
      'Locked (%)',
      'Open',
      'Total sheets',
    ]);
    // P1-A: 1 locked of 3 = 33.33...% -> 33 (never 33.3). P2-A is fully
    // locked (0 open) so it's excluded — same as the card's cutoff.
    expect(readiness.rows).toEqual([['P1-A', 'P1', 33, 2, 3]]);
  });

  it('omits sheet readiness when sheets is null', () => {
    const result = buildMarkbookDashboardExport({ ...baseInput, sheets: null });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Sheet readiness'
    );
  });

  it('lists teacher entry velocity with the email fallback the chart uses', () => {
    const result = buildMarkbookDashboardExport(baseInput);
    const tv = result.sections.find(
      (s) => s.title === 'Teacher entry velocity'
    )!;
    expect(tv.headers).toEqual(['Teacher', 'Entries']);
    expect(tv.rows).toEqual([
      ['j.tan@hfse.edu.sg', 40],
      ['user-2-n', 10],
    ]);
  });

  it('still emits a Teacher entry velocity section with zero rows when the list is empty', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      teacherVelocity: [],
    });
    const tv = result.sections.find(
      (s) => s.title === 'Teacher entry velocity'
    )!;
    expect(tv).toBeDefined();
    expect(tv.rows).toEqual([]);
  });

  it('omits teacher entry velocity when null', () => {
    const result = buildMarkbookDashboardExport({
      ...baseInput,
      teacherVelocity: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Teacher entry velocity'
    );
  });
});

describe('markbook dashboard page wiring', () => {
  it('renders ExportCsvButton exactly once — admin branch only, no button for teachers', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(markbook)/markbook/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
