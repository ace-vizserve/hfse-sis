import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  buildEvaluationDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  rowKindForTarget,
  type AdviserBehindRow,
  type DrillColumnKey,
  type EvaluationDrillRow,
  type EvaluationDrillRowKind,
  type EvaluationDrillTarget,
  type OutstandingWriteupRow,
  type SectionWriteupRow,
  type WriteupRow,
} from '@/lib/evaluation/drill';
import { createServiceClient } from '@/lib/supabase/service';

const VALID_TARGETS: EvaluationDrillTarget[] = [
  'submission-status',
  'submitted',
  'submission-velocity-day',
  'writeups-by-section',
  'outstanding-writeups',
  'advisers-behind',
];

const REGISTRAR_ONLY_TARGETS = new Set<EvaluationDrillTarget>([
  'outstanding-writeups',
  'advisers-behind',
]);

const ALLOWED_ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;
const REGISTRAR_PLUS = new Set([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> }
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as EvaluationDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as EvaluationDrillTarget;

  // Chase drills are registrar/oversight-only (KD #57) — never exposed to a
  // form-adviser teacher.
  if (REGISTRAR_ONLY_TARGETS.has(target) && !REGISTRAR_PLUS.has(guard.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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

  // Teacher → narrow to form_adviser sections.
  let allowedSectionIds: string[] | null = null;
  if (!REGISTRAR_PLUS.has(guard.role)) {
    const service = createServiceClient();
    const { data: assignments } = await service
      .from('teacher_assignments')
      .select('section_id')
      .eq('teacher_user_id', guard.user.id)
      .eq('role', 'form_adviser');
    allowedSectionIds = ((assignments ?? []) as { section_id: string }[]).map(
      (a) => a.section_id
    );
  }

  const rows = await buildEvaluationDrillRows({
    ayCode,
    from,
    to,
    target,
    segment,
    allowedSectionIds,
  });

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
    rowKind: rowKindForTarget(target),
  });
  res.headers.set(
    'Cache-Control',
    'private, max-age=60, stale-while-revalidate=300'
  );
  return res;
}

function pickColumns(
  target: EvaluationDrillTarget,
  columnsParam: string | null
): DrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForTarget(target);
  const requested = columnsParam
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean) as DrillColumnKey[];
  return requested.length > 0 ? requested : defaultColumnsForTarget(target);
}

function csvResponse(
  rows: EvaluationDrillRow[],
  target: EvaluationDrillTarget,
  segment: string | null,
  ayCode: string,
  columnsParam: string | null
): Response {
  const columns = pickColumns(target, columnsParam);
  const headers = columns.map((c) => DRILL_COLUMN_LABELS[c] ?? c);
  const kind = rowKindForTarget(target);
  const body = rows.map((r) => columns.map((c) => csvCell(r, c, kind)));
  const csv = buildCsv(headers, body);
  const segmentSlug = segment ? `-${slug(segment)}` : '';
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-evaluation-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(
  row: EvaluationDrillRow,
  key: DrillColumnKey,
  kind: EvaluationDrillRowKind
): string | number {
  if (kind === 'writeup') {
    const r = row as WriteupRow;
    switch (key) {
      case 'studentName':
        return r.studentName;
      case 'studentNumber':
        return r.studentNumber;
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'termNumber':
        return `T${r.termNumber}`;
      case 'status':
        return r.status;
      case 'draftCharCount':
        return r.draftCharCount;
      case 'submittedAt':
        return r.submittedAt?.slice(0, 10) ?? '';
      case 'daysToSubmit':
        return r.daysToSubmit ?? '';
      case 'adviserEmail':
        return r.adviserEmail ?? '';
      default:
        return '';
    }
  }
  if (kind === 'section-rollup') {
    const r = row as SectionWriteupRow;
    switch (key) {
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'termNumber':
        return `T${r.termNumber}`;
      case 'submissionPct':
        return `${r.submissionPct}%`;
      case 'submitted':
        return r.submitted;
      case 'draft':
        return r.draft;
      case 'missing':
        return r.missing;
      case 'total':
        return r.total;
      default:
        return '';
    }
  }
  if (kind === 'outstanding') {
    const r = row as OutstandingWriteupRow;
    switch (key) {
      case 'studentName':
        return r.studentName;
      case 'studentNumber':
        return r.studentNumber;
      case 'sectionName':
        return r.sectionName;
      case 'adviserName':
        return r.adviserName ?? 'Unassigned section';
      default:
        return '';
    }
  }
  // adviser-behind
  const r = row as AdviserBehindRow;
  switch (key) {
    case 'adviserName':
      return r.adviserName ?? 'Unassigned section';
    case 'outstandingCount':
      return r.outstanding;
    case 'sections':
      return r.sections;
    default:
      return '';
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
