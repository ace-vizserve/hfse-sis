import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  buildRecordsDrillRows,
  buildUnsyncedReadinessDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  type DrillColumnKey,
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

const DOC_TARGETS: ReadonlySet<RecordsDrillTarget> =
  new Set<RecordsDrillTarget>([
    'expiring-docs',
    'active-enrolled',
    'backlog-by-document',
  ]);

const ALLOWED_ROLES = ['registrar', 'school_admin', 'superadmin'] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> }
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

  // Drill always reflects the page-level from/to window. When both are
  // present the dataset is range-clamped; otherwise it falls back to the
  // full AY-wide row set. (The in-drill scope toggle was removed in favour
  // of the page-level date picker as the single source of truth.)
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const segment = url.searchParams.get('segment');
  const format = url.searchParams.get('format') ?? 'json';
  const columnsParam = url.searchParams.get('columns');

  const all = await buildRecordsDrillRows(
    { ayCode, from, to },
    { withDocs: DOC_TARGETS.has(target) }
  );
  const rangeForFilter = from && to ? { from, to } : undefined;
  let rows = applyTargetFilter(all, target, segment, rangeForFilter);

  // H3: class-assignment-readiness drill must include enrolled students with
  // no classSection (the KD #90 unsynced cohort). These rows are absent from
  // section_students so buildRecordsDrillRows never includes them; fetched
  // separately and appended here. All unsynced rows have sectionId=null which
  // passes the applyTargetFilter sectionId===null check by construction.
  if (target === 'class-assignment-readiness') {
    const unsyncedRows = await buildUnsyncedReadinessDrillRows(ayCode);
    rows = [...rows, ...unsyncedRows];
  }

  if (format === 'csv') {
    return csvResponse(rows, target, segment, ayCode, columnsParam);
  }

  const header = drillHeaderForTarget(target, segment);
  const res = NextResponse.json({
    rows,
    total: rows.length,
    target,
    segment,
    ayCode,
    eyebrow: header.eyebrow,
    title: header.title,
  });
  res.headers.set(
    'Cache-Control',
    'private, max-age=60, stale-while-revalidate=300'
  );
  return res;
}

function pickColumns(
  target: RecordsDrillTarget,
  columnsParam: string | null
): DrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForTarget(target);
  const requested = columnsParam
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is DrillColumnKey =>
      (ALL_DRILL_COLUMNS as string[]).includes(c)
    );
  return requested.length > 0 ? requested : defaultColumnsForTarget(target);
}

function csvResponse(
  rows: RecordsDrillRow[],
  target: RecordsDrillTarget,
  segment: string | null,
  ayCode: string,
  columnsParam: string | null
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
    case 'fullName':
      return row.fullName;
    case 'studentNumber':
      return row.studentNumber ?? '';
    case 'enroleeNumber':
      return row.enroleeNumber;
    case 'enrollmentStatus':
      return row.enrollmentStatus;
    case 'applicationStatus':
      return row.applicationStatus;
    case 'level':
      return row.level ?? '';
    case 'sectionName':
      return row.sectionName ?? '';
    case 'pipelineStage':
      return row.pipelineStage;
    case 'applicationDate':
      return row.applicationDate?.slice(0, 10) ?? '';
    case 'enrollmentDate':
      return row.enrollmentDate?.slice(0, 10) ?? '';
    case 'withdrawalDate':
      return row.withdrawalDate?.slice(0, 10) ?? '';
    case 'daysSinceUpdate':
      return row.daysSinceUpdate ?? '';
    case 'documentsComplete':
      return `${row.documentsComplete}/${row.documentsTotal}`;
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
