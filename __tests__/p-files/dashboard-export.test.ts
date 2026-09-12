import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  LevelCompletionRow,
  PFilesRangeKpis,
  RevisionWeek,
  SlotStatusMix,
} from '@/lib/p-files/dashboard';
import type { DashboardSummary } from '@/lib/p-files/queries';
import type { ExpiringDocRow } from '@/lib/sis/dashboard';
import type { DocumentChaseQueueCounts } from '@/lib/sis/document-chase-queue';
import type { RangeInput, RangeResult } from '@/lib/dashboard/range';
import {
  buildPFilesDashboardExport,
  type BuildPFilesDashboardExportInput,
} from '@/lib/p-files/dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

const kpis: RangeResult<PFilesRangeKpis> = {
  current: {
    revisionsInRange: 12,
    expiringSoon: 9,
    expiringSoon30: 4,
    totalDocuments: 640,
  },
  comparison: {
    revisionsInRange: 8,
    // Deliberately DIFFERENT from current even though these three are
    // "live, not range" counters in the real loader — pins that the builder
    // never surfaces Previous/Change for them regardless of what the
    // comparison object happens to carry.
    expiringSoon: 9,
    expiringSoon30: 4,
    totalDocuments: 640,
  },
  // Deliberately NOT current−previous ((12-8)/8*100 = 50) — pins that Change
  // carries the chip's own delta.pct, not a re-derived one.
  delta: { abs: 4, pct: 41.234, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const summary: DashboardSummary = {
  totalStudents: 512,
  fullyComplete: 388,
  // Present on the type but not rendered by <SummaryCards> (dropped in the
  // dashboard declutter) — the builder must ignore it, same as the card.
  expiringSoon90: 47,
};

const revisions: RevisionWeek[] = [
  { weekStart: '2026-08-03', weekLabel: 'Aug 3', count: 2 },
  { weekStart: '2026-08-10', weekLabel: 'Aug 10', count: 5 },
];

const byLevel: LevelCompletionRow[] = [
  { level: 'Primary 1', valid: 30, pending: 2, rejected: 1, missing: 3 },
  { level: 'Primary 2', valid: 28, pending: 0, rejected: 0, missing: 5 },
];

// Includes a fractional value even though the loader itself only ever emits
// integers here — the PRECISION rule says never assume a fractional field
// can't appear, and a leaked-decimal bug would slip past an all-integer
// fixture. slotMix values are raw counts (not a formatted widget value), so
// they pass through unrounded, exactly as data.
const slotMix: SlotStatusMix = {
  valid: 200.5,
  pending: 10,
  rejected: 3,
  missing: 12,
};

const expiring: ExpiringDocRow[] = [
  {
    enroleeNumber: 'E-201',
    studentName: 'Chloe Yeo',
    slotKey: 'passport',
    slotLabel: 'Passport',
    expiryDate: '2026-09-25',
    daysUntilExpiry: 13,
  },
  {
    enroleeNumber: 'E-202',
    studentName: 'Dylan Ong',
    slotKey: 'studentPass',
    slotLabel: 'Student Pass',
    expiryDate: '2026-08-28',
    daysUntilExpiry: -5,
  },
];

const chaseQueueCounts: DocumentChaseQueueCounts = {
  promised: 0, // admissions-only bucket — must not surface for p-files
  validation: 0, // admissions-only bucket — must not surface for p-files
  revalidation: 6,
  expiringSoon: 4,
};

const baseInput: BuildPFilesDashboardExportInput = {
  ayCode: 'AY2026',
  rangeInput: {
    ayCode: 'AY2026',
    from: '2026-08-01',
    to: '2026-08-31',
    cmpFrom: '2026-07-01',
    cmpTo: '2026-07-31',
  },
  isOfficer: true,
  kpis,
  summary,
  revisions,
  byLevel,
  slotMix,
  expiring,
  chaseQueueCounts,
};

describe('buildPFilesDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildPFilesDashboardExport(baseInput);
    expect(result.filename).toBe(
      'p-files-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines noting the date range only affects Revisions', () => {
    const result = buildPFilesDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'P-Files dashboard']);
    expect(result.scope).toContainEqual(['Academic year', 'AY2026']);
    expect(result.scope).toContainEqual([
      'Date range (revisions only)',
      '2026-08-01 to 2026-08-31',
    ]);
    expect(result.scope).toContainEqual([
      'Compared with',
      '2026-07-01 to 2026-07-31',
    ]);
  });

  it('omits Compared with when there is no comparison range', () => {
    const result = buildPFilesDashboardExport({
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

  it('produces one section per widget for an officer, in render order', () => {
    const result = buildPFilesDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Documents to chase',
      'Key figures',
      'Summary',
      'Document replacements over time',
      'Completion by grade level',
      'Where documents stand',
      'Renewals in the next 60 days',
    ]);
  });

  it('omits Documents to chase for a non-officer (oversight) viewer', () => {
    const result = buildPFilesDashboardExport({
      ...baseInput,
      isOfficer: false,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Summary',
      'Document replacements over time',
      'Completion by grade level',
      'Where documents stand',
      'Renewals in the next 60 days',
    ]);
  });

  it('omits Documents to chase when chaseQueueCounts is null even for an officer', () => {
    const result = buildPFilesDashboardExport({
      ...baseInput,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('omits Documents to chase when every visible-for-p-files count is zero', () => {
    const result = buildPFilesDashboardExport({
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

  it('emits Documents to chase only for the p-files tiles that would actually show', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const chase = result.sections.find(
      (s) => s.title === 'Documents to chase'
    )!;
    expect(chase.headers).toEqual(['Category', 'Students']);
    expect(chase.rows).toEqual([
      ['Awaiting revalidation', 6],
      ['Expiring soon', 4],
    ]);
  });

  it('carries the same Change number the delta chip shows, not current−previous, and leaves the live-total KPIs blank', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Revisions (range)', 12, 8, roundTo(kpis.delta!.pct, 1)],
      ['Expiring ≤30d', 4, null, null],
      ['Expiring ≤60d', 9, null, null],
      ['Total docs tracked', 640, null, null],
    ]);
    // Pin: NOT (12-8)/8*100 = 50. Must be the chip's own 41.2 (1dp).
    expect(keyFigures.rows[0][3]).toBe(41.2);
  });

  it('lists the two summary-card figures', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const s = result.sections.find((s) => s.title === 'Summary')!;
    expect(s.headers).toEqual(['Metric', 'Value']);
    expect(s.rows).toEqual([
      ['Total Students', 512],
      ['Fully Complete', 388],
    ]);
  });

  it('lists revisions over time straight from the loader', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const s = result.sections.find(
      (s) => s.title === 'Document replacements over time'
    )!;
    expect(s.headers).toEqual(['Week', 'Replacements']);
    expect(s.rows).toEqual([
      ['Aug 3', 2],
      ['Aug 10', 5],
    ]);
  });

  it('lists completion by level straight from the loader', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const s = result.sections.find(
      (s) => s.title === 'Completion by grade level'
    )!;
    expect(s.headers).toEqual([
      'Level',
      'Valid',
      'Pending review',
      'Rejected',
      'Missing / expired',
    ]);
    expect(s.rows).toEqual([
      ['Primary 1', 30, 2, 1, 3],
      ['Primary 2', 28, 0, 0, 5],
    ]);
  });

  it('still emits completion by level with zero rows when there is no data', () => {
    const result = buildPFilesDashboardExport({ ...baseInput, byLevel: [] });
    const s = result.sections.find(
      (s) => s.title === 'Completion by grade level'
    )!;
    expect(s).toBeDefined();
    expect(s.rows).toEqual([]);
  });

  it('lists the slot status mix as shown in the on-screen breakdown, unrounded', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const s = result.sections.find((s) => s.title === 'Where documents stand')!;
    expect(s.headers).toEqual(['Status', 'Documents']);
    expect(s.rows).toEqual([
      ['On file', 200.5],
      ['Expired / missing', 12],
      ['Awaiting validation', 10],
      ['Rejected', 3],
    ]);
  });

  it('lists the expiring documents rows as shown on the card', () => {
    const result = buildPFilesDashboardExport(baseInput);
    const s = result.sections.find(
      (s) => s.title === 'Renewals in the next 60 days'
    )!;
    expect(s.headers).toEqual([
      'Student',
      'Document',
      'Expiry date',
      'Days until expiry',
    ]);
    expect(s.rows).toEqual([
      ['Chloe Yeo', 'Passport', '2026-09-25', 13],
      ['Dylan Ong', 'Student Pass', '2026-08-28', -5],
    ]);
  });

  it('still emits Renewals in the next 60 days with zero rows when nothing is expiring', () => {
    const result = buildPFilesDashboardExport({ ...baseInput, expiring: [] });
    const s = result.sections.find(
      (s) => s.title === 'Renewals in the next 60 days'
    )!;
    expect(s).toBeDefined();
    expect(s.rows).toEqual([]);
  });
});

describe('p-files dashboard page wiring', () => {
  it('renders ExportCsvButton exactly once', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(p-files)/p-files/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does not fetch the chase queue counts a second time', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(p-files)/p-files/page.tsx'),
      'utf8'
    );
    const matches = source.match(/getDocumentChaseQueueCounts\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
