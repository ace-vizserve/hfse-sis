import { NextResponse } from 'next/server';

import {
  buildAttendanceDrillRows,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  rowKindForTarget,
  type AttendanceDrillRow,
  type AttendanceDrillRowKind,
  type AttendanceDrillTarget,
  type AttendanceEntryRow,
  type CalendarDayRow,
  type CompassionateUsageRow,
  type DrillColumnKey,
  type SectionAttendanceRow,
  type TopAbsentDrillRow,
  type VacationLeaveUsageRow,
} from '@/lib/attendance/drill';
import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import { getSchoolConfig } from '@/lib/sis/school-config';

const VALID_TARGETS: AttendanceDrillTarget[] = [
  'attendance-summary',
  'lates',
  'excused',
  'absent',
  'daily-attendance-day',
  'ex-reason',
  'day-type',
  'top-absent',
  'top-active',
  'attendance-by-section',
  'compassionate-quota',
  'vacation-leave-quota',
];

const ALLOWED_ROLES = [
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> }
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as AttendanceDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as AttendanceDrillTarget;

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
  // termId is required for the 'vacation-leave-quota' target (per KD #94)
  // because VL quota is per-term, no carry-forward. Other targets ignore it.
  const termId = url.searchParams.get('termId');

  // Fetch school default for the VL target so drill.ts stays free of
  // server-only imports (the rollup runs against this value when the
  // student's column is NULL).
  const schoolConfig =
    target === 'vacation-leave-quota' ? await getSchoolConfig() : null;

  const rows = await buildAttendanceDrillRows({
    ayCode,
    from,
    to,
    target,
    segment,
    termId,
    defaultVlAllowance: schoolConfig?.defaultVlAllowancePerTerm,
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
  target: AttendanceDrillTarget,
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
  rows: AttendanceDrillRow[],
  target: AttendanceDrillTarget,
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
  const filename = `drill-attendance-${target}${segmentSlug}-${ayCode}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(
  row: AttendanceDrillRow,
  key: DrillColumnKey,
  kind: AttendanceDrillRowKind
): string | number {
  if (kind === 'entry') {
    const r = row as AttendanceEntryRow;
    switch (key) {
      case 'attendanceDate':
        return r.attendanceDate.slice(0, 10);
      case 'studentName':
        return r.studentName;
      case 'studentNumber':
        return r.studentNumber;
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'status':
        return r.status;
      case 'exReason':
        return r.exReason ?? '';
      default:
        return '';
    }
  }
  if (kind === 'top-absent') {
    const r = row as TopAbsentDrillRow;
    switch (key) {
      case 'studentName':
        return r.studentName;
      case 'studentNumber':
        return r.studentNumber;
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'absences':
        return r.absences;
      case 'lates':
        return r.lates;
      case 'excused':
        return r.excused;
      case 'encodedDays':
        return r.encodedDays;
      case 'attendancePct':
        return `${r.attendancePct}%`;
      default:
        return '';
    }
  }
  if (kind === 'section-rollup') {
    const r = row as SectionAttendanceRow;
    switch (key) {
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'attendancePct':
        return `${r.attendancePct}%`;
      case 'absences':
        return r.absentCount;
      case 'lates':
        return r.lateCount;
      case 'excused':
        return r.excusedCount;
      case 'encodedDays':
        return r.encodedDays;
      default:
        return '';
    }
  }
  if (kind === 'compassionate') {
    const r = row as CompassionateUsageRow;
    switch (key) {
      case 'studentName':
        return r.studentName;
      case 'studentNumber':
        return r.studentNumber;
      case 'sectionName':
        return r.sectionName;
      case 'level':
        return r.level ?? '';
      case 'allowance':
        return r.allowance;
      case 'used':
        return r.used;
      case 'remaining':
        return r.remaining;
      case 'isOverQuota':
        return r.isOverQuota ? 'Yes' : 'No';
      default:
        return '';
    }
  }
  if (kind === 'vacation-leave') {
    const r = row as VacationLeaveUsageRow;
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
      case 'allowance':
        return r.allowance;
      case 'usedThisTerm':
        return r.usedThisTerm;
      case 'remainingThisTerm':
        return r.remainingThisTerm;
      case 'isOverTermQuota':
        return r.isOverTermQuota ? 'Yes' : 'No';
      default:
        return '';
    }
  }
  // calendar-day
  const r = row as CalendarDayRow;
  switch (key) {
    case 'date':
      return r.date.slice(0, 10);
    case 'dayType':
      return r.dayType;
    case 'label':
      return r.label ?? '';
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
