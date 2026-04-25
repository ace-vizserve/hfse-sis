import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  buildRecordsDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  type DrillColumnKey,
  type DrillScope,
  type RecordsDrillRow,
  type RecordsDrillTarget,
} from '@/lib/sis/drill';

const VALID_TARGETS: RecordsDrillTarget[] = [
  'enrollments-range',
  'withdrawals-range',
  'active-enrolled',
  'expiring-docs',
  'students-by-pipeline-stage',
  'students-by-level',
  'backlog-by-document',
  'class-assignment-readiness',
];

const VALID_SCOPES: DrillScope[] = ['range', 'ay', 'all'];

const DOC_TARGETS: ReadonlySet<RecordsDrillTarget> = new Set<RecordsDrillTarget>([
  'expiring-docs',
  'active-enrolled',
  'backlog-by-document',
]);

const ALLOWED_ROLES = [
  'registrar',
  'school_admin',
  'admin',
  'superadmin',
] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as RecordsDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as RecordsDrillTarget;

  const url = new URL(req.url);
  const ayCode = url.searchParams.get('ay');
  if (!ayCode || !/^AY\d{4}$/.test(ayCode)) {
    return NextResponse.json({ error: 'invalid_ay' }, { status: 400 });
  }

  const scopeParam = (url.searchParams.get('scope') ?? 'range') as DrillScope;
  const scope = VALID_SCOPES.includes(scopeParam) ? scopeParam : 'range';
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const segment = url.searchParams.get('segment');
  const format = url.searchParams.get('format') ?? 'json';
  const columnsParam = url.searchParams.get('columns');

  const all = await buildRecordsDrillRows(
    { ayCode, scope, from, to },
    { withDocs: DOC_TARGETS.has(target) },
  );
  const rangeForFilter = scope === 'range' && from && to ? { from, to } : undefined;
  const rows = applyTargetFilter(all, target, segment, rangeForFilter);

  if (format === 'csv') {
    return csvResponse(rows, target, segment, ayCode, columnsParam);
  }

  const header = drillHeaderForTarget(target, segment);
  return NextResponse.json({
    rows,
    total: rows.length,
    target,
    segment,
    scope,
    ayCode,
    eyebrow: header.eyebrow,
    title: header.title,
  });
}

function pickColumns(target: RecordsDrillTarget, columnsParam: string | null): DrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForTarget(target);
  const requested = columnsParam.split(',').map((c) => c.trim()).filter((c): c is DrillColumnKey => (ALL_DRILL_COLUMNS as string[]).includes(c));
  return requested.length > 0 ? requested : defaultColumnsForTarget(target);
}

function csvResponse(
  rows: RecordsDrillRow[],
  target: RecordsDrillTarget,
  segment: string | null,
  ayCode: string,
  columnsParam: string | null,
): Response {
  const columns = pickColumns(target, columnsParam);
  const headers = columns.map((c) => DRILL_COLUMN_LABELS[c] ?? c);
  const body = rows.map((r) => columns.map((c) => csvCell(r, c)));
  const csv = buildCsv(headers, body);
  const segmentSlug = segment ? `-${slug(segment)}` : '';
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-records-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(row: RecordsDrillRow, key: DrillColumnKey): string | number {
  switch (key) {
    case 'fullName': return row.fullName;
    case 'studentNumber': return row.studentNumber ?? '';
    case 'enroleeNumber': return row.enroleeNumber;
    case 'enrollmentStatus': return row.enrollmentStatus;
    case 'applicationStatus': return row.applicationStatus;
    case 'level': return row.level ?? '';
    case 'sectionName': return row.sectionName ?? '';
    case 'pipelineStage': return row.pipelineStage;
    case 'enrollmentDate': return row.enrollmentDate?.slice(0, 10) ?? '';
    case 'withdrawalDate': return row.withdrawalDate?.slice(0, 10) ?? '';
    case 'daysSinceUpdate': return row.daysSinceUpdate ?? '';
    case 'documentsComplete': return `${row.documentsComplete}/${row.documentsTotal}`;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
