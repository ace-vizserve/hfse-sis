import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  buildDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  type DrillColumnKey,
  type DrillRow,
  type DrillScope,
  type DrillTarget,
} from '@/lib/admissions/drill';
import { buildCsv } from '@/lib/csv';

const VALID_TARGETS: DrillTarget[] = [
  'applications',
  'enrolled',
  'conversion',
  'avg-time',
  'funnel-stage',
  'pipeline-stage',
  'referral',
  'assessment',
  'time-to-enroll-bucket',
  'applications-by-level',
  'doc-completion',
  'outdated',
];

const VALID_SCOPES: DrillScope[] = ['range', 'ay', 'all'];

const ALLOWED_ROLES = [
  'admissions',
  'registrar',
  'school_admin',
  'superadmin',
] as const;

// Targets that surface document-completeness fields. Other targets skip the
// docs query entirely — saves ~15% of the row payload on non-doc drills.
const DOC_TARGETS: ReadonlySet<DrillTarget> = new Set<DrillTarget>([
  'applications',
  'enrolled',
  'outdated',
  'doc-completion',
  'applications-by-level',
]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as DrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as DrillTarget;

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

  // Build the universal row set (scope-clamped), then apply target filter.
  // Only enrich with doc data when the target actually surfaces it.
  const all = await buildDrillRows(
    { ayCode, scope, from, to },
    { withDocs: DOC_TARGETS.has(target) },
  );
  const rows = applyTargetFilter(all, target, segment);

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

function pickColumns(
  target: DrillTarget,
  columnsParam: string | null,
): DrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForTarget(target);
  const requested = columnsParam
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is DrillColumnKey => (ALL_DRILL_COLUMNS as string[]).includes(c));
  return requested.length > 0 ? requested : defaultColumnsForTarget(target);
}

function csvResponse(
  rows: DrillRow[],
  target: DrillTarget,
  segment: string | null,
  ayCode: string,
  columnsParam: string | null,
): Response {
  const columns = pickColumns(target, columnsParam);
  const headers = columns.map((c) => DRILL_COLUMN_LABELS[c]);
  const body = rows.map((r) =>
    columns.map((c) => {
      switch (c) {
        case 'enroleeNumber':
          return r.enroleeNumber;
        case 'studentNumber':
          return r.studentNumber ?? '';
        case 'fullName':
          return r.fullName;
        case 'status':
          return r.status;
        case 'level':
          return r.level ?? '';
        case 'stage':
          return r.stage ?? '';
        case 'referralSource':
          return r.referralSource ?? 'Not specified';
        case 'assessmentOutcome':
          return r.assessmentOutcome;
        case 'applicationDate':
          return r.applicationDate ?? '';
        case 'enrollmentDate':
          return r.enrollmentDate ?? '';
        case 'daysToEnroll':
          return r.daysToEnroll ?? '';
        case 'daysSinceUpdate':
          return r.daysSinceUpdate ?? '';
        case 'daysInPipeline':
          return r.daysInPipeline;
        case 'documentsComplete':
          return `${r.documentsComplete}/${r.documentsTotal}`;
        default:
          return '';
      }
    }),
  );
  const csv = buildCsv(headers, body);
  const segmentSlug = segment ? `-${slug(segment)}` : '';
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-admissions-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
