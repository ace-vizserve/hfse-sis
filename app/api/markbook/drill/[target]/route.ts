import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  buildMarkbookDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  rowKindForTarget,
  type ChangeRequestRow,
  type DrillColumnKey,
  type DrillScope,
  type GradeEntryRow,
  type MarkbookDrillRow,
  type MarkbookDrillTarget,
  type SheetRow,
} from '@/lib/markbook/drill';
import { createServiceClient } from '@/lib/supabase/service';

const VALID_TARGETS: MarkbookDrillTarget[] = [
  'grade-entries',
  'sheets-locked',
  'change-requests',
  'publication-coverage',
  'grade-bucket-entries',
  'term-sheet-status',
  'term-publication-status',
  'sheet-readiness-section',
  'teacher-entry-velocity',
];

const VALID_SCOPES: DrillScope[] = ['range', 'ay', 'all'];

const ALLOWED_ROLES = [
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
] as const;

const REGISTRAR_PLUS = new Set(['registrar', 'school_admin', 'superadmin']);

const TEACHER_VELOCITY_FORBIDDEN_FOR = new Set(['teacher']);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as MarkbookDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as MarkbookDrillTarget;

  // Teacher velocity is registrar+ only.
  if (target === 'teacher-entry-velocity' && TEACHER_VELOCITY_FORBIDDEN_FOR.has(guard.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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

  // Teacher scoping — narrow rows to sections they're assigned to.
  let allowedSectionIds: string[] | null = null;
  if (!REGISTRAR_PLUS.has(guard.role)) {
    const service = createServiceClient();
    const { data: assignments } = await service
      .from('teacher_assignments')
      .select('section_id')
      .eq('teacher_user_id', guard.user.id);
    allowedSectionIds = ((assignments ?? []) as { section_id: string }[]).map((a) => a.section_id);
  }

  const rows = await buildMarkbookDrillRows({
    ayCode,
    scope,
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
  return NextResponse.json({
    rows,
    total: rows.length,
    target,
    segment,
    scope,
    ayCode,
    eyebrow: header.eyebrow,
    title: header.title,
    rowKind: rowKindForTarget(target),
  });
}

function pickColumns(
  target: MarkbookDrillTarget,
  columnsParam: string | null,
): DrillColumnKey[] {
  if (!columnsParam) return defaultColumnsForTarget(target);
  const requested = columnsParam
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is DrillColumnKey => c.length > 0) as DrillColumnKey[];
  return requested.length > 0 ? requested : defaultColumnsForTarget(target);
}

function csvResponse(
  rows: MarkbookDrillRow[],
  target: MarkbookDrillTarget,
  segment: string | null,
  ayCode: string,
  columnsParam: string | null,
): Response {
  const columns = pickColumns(target, columnsParam);
  const headers = columns.map((c) => DRILL_COLUMN_LABELS[c] ?? c);
  const kind = rowKindForTarget(target);
  const body = rows.map((r) => columns.map((c) => csvCell(r, c, kind)));
  const csv = buildCsv(headers, body);
  const segmentSlug = segment ? `-${slug(segment)}` : '';
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-markbook-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(row: MarkbookDrillRow, key: DrillColumnKey, kind: 'entry' | 'sheet' | 'change-request'): string | number {
  if (kind === 'entry') {
    const r = row as GradeEntryRow;
    switch (key) {
      case 'studentName': return r.studentName;
      case 'studentNumber': return r.studentNumber;
      case 'level': return r.level ?? '';
      case 'sectionName': return r.sectionName;
      case 'subjectCode': return r.subjectCode;
      case 'termNumber': return `T${r.termNumber}`;
      case 'rawScore': return r.rawScore ?? '';
      case 'computedGrade': return r.computedGrade ?? '';
      case 'gradeBucket': return r.gradeBucket ?? '';
      case 'isLocked': return r.isLocked ? 'Yes' : 'No';
      case 'enteredAt': return r.enteredAt.slice(0, 10);
      case 'enteredBy': return r.enteredBy ?? '';
      default: return '';
    }
  }
  if (kind === 'sheet') {
    const r = row as SheetRow;
    switch (key) {
      case 'sectionName': return r.sectionName;
      case 'level': return r.level ?? '';
      case 'subjectCode': return r.subjectCode;
      case 'termNumber': return `T${r.termNumber}`;
      case 'sheetSubjectTerm': return `${r.subjectCode} · T${r.termNumber}`;
      case 'isLocked': return r.isLocked ? 'Locked' : 'Open';
      case 'lockedAt': return r.lockedAt?.slice(0, 10) ?? '';
      case 'publishedAt': return r.publishedAt?.slice(0, 10) ?? '';
      case 'completeness': return `${r.entriesPresent}/${r.entriesExpected} (${r.completenessPct}%)`;
      case 'teacherName': return r.teacherName ?? '';
      default: return '';
    }
  }
  // change-request
  const r = row as ChangeRequestRow;
  switch (key) {
    case 'sectionName': return r.sectionName;
    case 'subjectCode': return r.subjectCode;
    case 'termNumber': return `T${r.termNumber}`;
    case 'status': return r.status;
    case 'fieldChanged': return r.fieldChanged;
    case 'reasonCategory': return r.reasonCategory;
    case 'requestedBy': return r.requestedBy;
    case 'requestedAt': return r.requestedAt.slice(0, 10);
    case 'resolvedAt': return r.resolvedAt?.slice(0, 10) ?? '';
    default: return '';
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
