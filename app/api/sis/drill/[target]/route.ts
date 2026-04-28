import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  ALL_LIFECYCLE_DRILL_COLUMNS,
  buildLifecycleDrillRows,
  defaultColumnsForLifecycleTarget,
  isLifecycleDrillTarget,
  LIFECYCLE_DRILL_COLUMN_LABELS,
  lifecycleDrillHeaderForTarget,
  type LifecycleDrillColumnKey,
  type LifecycleDrillRow,
  type LifecycleDrillTarget,
} from '@/lib/sis/drill';

const ALLOWED_ROLES = ['school_admin', 'admin', 'superadmin'] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!isLifecycleDrillTarget(rawTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target: LifecycleDrillTarget = rawTarget;

  const url = new URL(req.url);
  const ayCode = url.searchParams.get('ay');
  if (!ayCode || !/^AY\d{4}$/.test(ayCode)) {
    return NextResponse.json({ error: 'invalid_ay' }, { status: 400 });
  }
  const format = url.searchParams.get('format') ?? 'json';
  const columnsParam = url.searchParams.get('columns');

  const rows = await buildLifecycleDrillRows(ayCode, target);

  if (format === 'csv') {
    return csvResponse(rows, target, ayCode, columnsParam);
  }

  const header = lifecycleDrillHeaderForTarget(target);
  return NextResponse.json({
    rows,
    total: rows.length,
    target,
    ayCode,
    eyebrow: header.eyebrow,
    title: header.title,
  });
}

function pickColumns(
  target: LifecycleDrillTarget,
  columnsParam: string | null,
): LifecycleDrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForLifecycleTarget(target);
  const requested = columnsParam
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is LifecycleDrillColumnKey =>
      (ALL_LIFECYCLE_DRILL_COLUMNS as string[]).includes(c),
    );
  return requested.length > 0 ? requested : defaultColumnsForLifecycleTarget(target);
}

function csvResponse(
  rows: LifecycleDrillRow[],
  target: LifecycleDrillTarget,
  ayCode: string,
  columnsParam: string | null,
): Response {
  const columns = pickColumns(target, columnsParam);
  const headers = columns.map(
    (c) => LIFECYCLE_DRILL_COLUMN_LABELS[c] ?? c,
  );
  const body = rows.map((r) => columns.map((c) => csvCell(r, c)));
  const csv = buildCsv(headers, body);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-sis-lifecycle-${target}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(row: LifecycleDrillRow, key: LifecycleDrillColumnKey): string | number {
  switch (key) {
    case 'enroleeNumber': return row.enroleeNumber;
    case 'studentNumber': return row.studentNumber ?? '';
    case 'enroleeFullName': return row.enroleeFullName ?? '';
    case 'levelApplied': return row.levelApplied ?? '';
    case 'applicationStatus': return row.applicationStatus ?? '';
    case 'applicationUpdatedDate': return row.applicationUpdatedDate?.slice(0, 10) ?? '';
    case 'daysSinceUpdate': return row.daysSinceUpdate ?? '';
    case 'feeStatus': return row.feeStatus ?? '';
    case 'feeInvoice': return row.feeInvoice ?? '';
    case 'feePaymentDate': return row.feePaymentDate?.slice(0, 10) ?? '';
    case 'documentStatus': return row.documentStatus ?? '';
    case 'rejectedSlots': return (row.rejectedSlots ?? []).join('; ');
    case 'expiredSlots': return (row.expiredSlots ?? []).join('; ');
    case 'uploadedSlots': return (row.uploadedSlots ?? []).join('; ');
    case 'promisedSlots': return (row.promisedSlots ?? []).join('; ');
    case 'expiringSlots': return (row.expiringSlots ?? []).join('; ');
    case 'daysLeft': return row.daysLeft ?? '';
    case 'assessmentStatus': return row.assessmentStatus ?? '';
    case 'assessmentSchedule': return row.assessmentSchedule?.slice(0, 10) ?? '';
    case 'contractStatus': return row.contractStatus ?? '';
    case 'classSection': return row.classSection ?? '';
  }
}
