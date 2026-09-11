import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ClassAssignmentReadinessRow,
  DocumentBacklogRow,
  ExpiringDocRow,
  LevelCount,
  RecordsRangeKpis,
} from '@/lib/sis/dashboard';
import type { DocumentChaseQueueCounts } from '@/lib/sis/document-chase-queue';
import type { RangeInput, RangeResult } from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import {
  buildRecordsDashboardExport,
  type BuildRecordsDashboardExportInput,
} from '@/lib/sis/records-dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

const kpis: RangeResult<RecordsRangeKpis> = {
  current: {
    enrollmentsInRange: 24,
    lateEnroleesInRange: 3,
    withdrawalsInRange: 5,
    activeEnrolled: 480,
    expiringSoon: 7,
  },
  comparison: {
    enrollmentsInRange: 18,
    lateEnroleesInRange: 1,
    withdrawalsInRange: 8,
    activeEnrolled: 460,
    expiringSoon: 4,
  },
  // Deliberately NOT current−previous ((24-18)/18*100 = 33.33) — pins that
  // Change carries the chip's own delta.pct, not a re-derived one.
  delta: { abs: 6, pct: 37.876, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const enrolVelocity: RangeResult<VelocityPoint[]> = {
  current: [
    { x: '2026-08-01', y: 2 },
    { x: '2026-08-02', y: 4 },
  ],
  comparison: [
    { x: '2026-07-01', y: 1 },
    { x: '2026-07-02', y: 3 },
  ],
  delta: { abs: 2, pct: 50, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const withdrawVelocity: RangeResult<VelocityPoint[]> = {
  current: [
    { x: '2026-08-01', y: 1 },
    { x: '2026-08-02', y: 0 },
  ],
  comparison: [
    { x: '2026-07-01', y: 2 },
    { x: '2026-07-02', y: 1 },
  ],
  delta: { abs: -2, pct: -66.6, direction: 'down' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const docBacklog: DocumentBacklogRow[] = [
  {
    slotKey: 'passport',
    label: 'Passport',
    group: 'student',
    valid: 40,
    pending: 3,
    rejected: 1,
    missing: 2,
  },
  {
    slotKey: 'studentPass',
    label: 'Student Pass',
    group: 'student',
    valid: 35,
    pending: 5,
    rejected: 0,
    missing: 6,
  },
];

const levels: LevelCount[] = [
  { level: 'P1', count: 20 },
  { level: 'P2', count: 18 },
];

const expiring: ExpiringDocRow[] = [
  {
    enroleeNumber: 'E-001',
    studentName: 'Amara Tan',
    slotKey: 'passport',
    slotLabel: 'Passport',
    expiryDate: '2026-09-20',
    daysUntilExpiry: 8,
  },
  {
    enroleeNumber: 'E-002',
    studentName: 'Benny Lim',
    slotKey: 'studentPass',
    slotLabel: 'Student Pass',
    expiryDate: '2026-08-30',
    daysUntilExpiry: -3,
  },
];

function readinessRow(
  overrides: Partial<ClassAssignmentReadinessRow>
): ClassAssignmentReadinessRow {
  return {
    enroleeNumber: 'E-100',
    fullName: 'Test Student',
    level: 'P1',
    enrollmentDate: '2026-08-01',
    daysSinceEnrollment: 10,
    ...overrides,
  };
}

// 9 rows — one more than the card's top-8 cutoff — to pin the export mirrors
// <ClassAssignmentReadinessCard>'s `data.slice(0, 8)`, not the full list.
const classAssignment: ClassAssignmentReadinessRow[] = Array.from(
  { length: 9 },
  (_, i) =>
    readinessRow({
      enroleeNumber: `E-${100 + i}`,
      fullName: `Student ${i}`,
      daysSinceEnrollment: 20 - i,
    })
);

const chaseQueueCounts: DocumentChaseQueueCounts = {
  promised: 0, // admissions-only bucket — must not surface for p-files
  validation: 0, // admissions-only bucket — must not surface for p-files
  revalidation: 2,
  expiringSoon: 5,
};

const baseInput: BuildRecordsDashboardExportInput = {
  ayCode: 'AY2026',
  rangeInput: {
    ayCode: 'AY2026',
    from: '2026-08-01',
    to: '2026-08-31',
    cmpFrom: '2026-07-01',
    cmpTo: '2026-07-31',
  },
  isOperational: true,
  kpis,
  enrolVelocity,
  withdrawVelocity,
  docBacklog,
  levels,
  expiring,
  classAssignment,
  chaseQueueCounts,
};

describe('buildRecordsDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildRecordsDashboardExport(baseInput);
    expect(result.filename).toBe(
      'records-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines including the comparison range', () => {
    const result = buildRecordsDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'Records dashboard']);
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
    const result = buildRecordsDashboardExport({
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

  it('produces one section per widget the operational branch renders, in render order', () => {
    const result = buildRecordsDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Documents to chase',
      'Key figures',
      'New students per day',
      'Withdrawals per day',
      'Validation backlog by document type',
      'Students by level',
      'Renewals in the next 60 days',
      'Enrolled but unassigned',
    ]);
  });

  it('omits the operational-only sections for an oversight (non-operational) viewer', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      isOperational: false,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'New students per day',
      'Withdrawals per day',
      'Validation backlog by document type',
      'Students by level',
      'Renewals in the next 60 days',
    ]);
  });

  it('carries the same Change number the delta chip shows, not current−previous', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['New enrollments', 24, 18, roundTo(kpis.delta!.pct, 1)],
      ['Withdrawals', 5, 8, null],
      ['Active enrolled', 480, null, null],
      ['Docs expiring ≤60d', 7, null, null],
    ]);
    // Pin: NOT (24-18)/18*100 = 33.33. Must be the chip's own 37.9 (1dp).
    expect(keyFigures.rows[0][3]).toBe(37.9);
  });

  it('renders enrollment velocity aligned by position, like the chart', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const trend = result.sections.find(
      (s) => s.title === 'New students per day'
    )!;
    expect(trend.headers).toEqual([
      'Date',
      'Enrollments',
      'Comparison enrollments',
    ]);
    expect(trend.rows).toEqual([
      ['2026-08-01', 2, 1],
      ['2026-08-02', 4, 3],
    ]);
  });

  it('omits enrollment velocity when there are 0 or 1 points', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      enrolVelocity: {
        ...enrolVelocity,
        current: [{ x: '2026-08-01', y: 2 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'New students per day'
    );
  });

  it('renders withdrawal velocity aligned by position, like the chart', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const trend = result.sections.find(
      (s) => s.title === 'Withdrawals per day'
    )!;
    expect(trend.headers).toEqual([
      'Date',
      'Withdrawals',
      'Comparison withdrawals',
    ]);
    expect(trend.rows).toEqual([
      ['2026-08-01', 1, 2],
      ['2026-08-02', 0, 1],
    ]);
  });

  it('omits withdrawal velocity when there are 0 or 1 points', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      withdrawVelocity: {
        ...withdrawVelocity,
        current: [{ x: '2026-08-01', y: 1 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Withdrawals per day'
    );
  });

  it('lists document backlog by type straight from the loader', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const backlog = result.sections.find(
      (s) => s.title === 'Validation backlog by document type'
    )!;
    expect(backlog.headers).toEqual([
      'Document type',
      'Valid',
      'Pending review',
      'Rejected',
      'Missing / expired',
    ]);
    expect(backlog.rows).toEqual([
      ['Passport', 40, 3, 1, 2],
      ['Student Pass', 35, 5, 0, 6],
    ]);
  });

  it('still emits document backlog with zero rows when there is no data', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      docBacklog: [],
    });
    const backlog = result.sections.find(
      (s) => s.title === 'Validation backlog by document type'
    )!;
    expect(backlog).toBeDefined();
    expect(backlog.rows).toEqual([]);
  });

  it('lists students by level straight from the loader', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const byLevel = result.sections.find(
      (s) => s.title === 'Students by level'
    )!;
    expect(byLevel.headers).toEqual(['Level', 'Students']);
    expect(byLevel.rows).toEqual([
      ['P1', 20],
      ['P2', 18],
    ]);
  });

  it('still emits students by level with zero rows when there is no data', () => {
    const result = buildRecordsDashboardExport({ ...baseInput, levels: [] });
    const byLevel = result.sections.find(
      (s) => s.title === 'Students by level'
    )!;
    expect(byLevel).toBeDefined();
    expect(byLevel.rows).toEqual([]);
  });

  it('lists the expiring documents rows as shown on the card', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const exp = result.sections.find(
      (s) => s.title === 'Renewals in the next 60 days'
    )!;
    expect(exp.headers).toEqual([
      'Student',
      'Document',
      'Expiry date',
      'Days until expiry',
    ]);
    expect(exp.rows).toEqual([
      ['Amara Tan', 'Passport', '2026-09-20', 8],
      ['Benny Lim', 'Student Pass', '2026-08-30', -3],
    ]);
  });

  it('still emits Renewals in the next 60 days with zero rows when there is nothing expiring', () => {
    const result = buildRecordsDashboardExport({ ...baseInput, expiring: [] });
    const exp = result.sections.find(
      (s) => s.title === 'Renewals in the next 60 days'
    )!;
    expect(exp).toBeDefined();
    expect(exp.rows).toEqual([]);
  });

  it("caps class-assignment readiness at the card's top-8 cutoff", () => {
    const result = buildRecordsDashboardExport(baseInput);
    const readiness = result.sections.find(
      (s) => s.title === 'Enrolled but unassigned'
    )!;
    expect(readiness.headers).toEqual([
      'Student',
      'Level',
      'Days since enrolment',
    ]);
    expect(readiness.rows).toHaveLength(8);
    expect(readiness.rows[0]).toEqual(['Student 0', 'P1', 20]);
    expect(readiness.rows.map((r) => r[0])).not.toContain('Student 8');
  });

  it('still emits Enrolled but unassigned with zero rows when every enrolled student is placed', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      classAssignment: [],
    });
    const readiness = result.sections.find(
      (s) => s.title === 'Enrolled but unassigned'
    )!;
    expect(readiness).toBeDefined();
    expect(readiness.rows).toEqual([]);
  });

  it('omits Enrolled but unassigned for an oversight (non-operational) viewer', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      isOperational: false,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Enrolled but unassigned'
    );
  });

  it('emits Documents to chase only for the p-files tiles that would actually show', () => {
    const result = buildRecordsDashboardExport(baseInput);
    const chase = result.sections.find(
      (s) => s.title === 'Documents to chase'
    )!;
    expect(chase.headers).toEqual(['Category', 'Students']);
    expect(chase.rows).toEqual([
      ['Awaiting revalidation', 2],
      ['Expiring soon', 5],
    ]);
  });

  it('omits Documents to chase for an oversight (non-operational) viewer', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      isOperational: false,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('omits Documents to chase when every visible-for-p-files count is zero', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      chaseQueueCounts: {
        promised: 0,
        validation: 0,
        revalidation: 0,
        expiringSoon: 0,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('omits Documents to chase when chaseQueueCounts is null', () => {
    const result = buildRecordsDashboardExport({
      ...baseInput,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });
});

describe('records dashboard page wiring', () => {
  it('renders ExportCsvButton exactly once', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(records)/records/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
