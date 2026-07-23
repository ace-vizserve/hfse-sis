import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  buildPFilesDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  type DrillColumnKey,
  type PFilesDrillRow,
  type PFilesDrillTarget,
} from '@/lib/p-files/drill';

const VALID_TARGETS: PFilesDrillTarget[] = [
  'all-docs',
  'complete-docs',
  'expired-docs',
  'expiring-soon',
  'missing-docs',
  'slot-by-status',
  'missing-by-slot',
  'level-applicants',
  'revisions-on-day',
];

const ALLOWED_ROLES = ['p_file_officer', 'school_admin', 'superadmin'] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> }
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as PFilesDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as PFilesDrillTarget;

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

  const all = await buildPFilesDrillRows({ ayCode, from, to });
  const rangeForFilter = from && to ? { from, to } : undefined;
  const rows = applyTargetFilter(all, target, segment, rangeForFilter);

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
  target: PFilesDrillTarget,
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
  rows: PFilesDrillRow[],
  target: PFilesDrillTarget,
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
  const filename = `drill-p-files-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(row: PFilesDrillRow, key: DrillColumnKey): string | number {
  switch (key) {
    case 'fullName':
      return row.fullName;
    case 'enroleeNumber':
      return row.enroleeNumber;
    case 'level':
      return row.level ?? '';
    case 'slotLabel':
      return row.slotLabel;
    case 'status':
      return row.status;
    case 'expiryDate':
      return row.expiryDate?.slice(0, 10) ?? '';
    case 'daysToExpiry':
      return row.daysToExpiry ?? '';
    case 'revisionCount':
      return row.revisionCount;
    case 'lastRevisionAt':
      return row.lastRevisionAt?.slice(0, 10) ?? '';
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
