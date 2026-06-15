'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpRight, AlertTriangle, RotateCcw } from 'lucide-react';

import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  allColumnsForKind,
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

export type AttendanceDrillSheetProps = {
  target: AttendanceDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialFrom?: string;
  initialTo?: string;
  // KD #94 — required for 'vacation-leave-quota' target since VL quota
  // is per-term. Other targets ignore it.
  termId?: string;
  initialEntries?: AttendanceEntryRow[];
  initialTopAbsent?: TopAbsentDrillRow[];
  initialSectionAttendance?: SectionAttendanceRow[];
  initialCalendar?: CalendarDayRow[];
  initialCompassionate?: CompassionateUsageRow[];
  initialVacationLeave?: VacationLeaveUsageRow[];
};

const CANONICAL_LEVEL_ORDER = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'S1',
  'S2',
  'S3',
  'S4',
];
function compareLevels(a: string | null, b: string | null): number {
  const av = a ?? 'Unknown';
  const bv = b ?? 'Unknown';
  if (av === bv) return 0;
  if (av === 'Unknown') return 1;
  if (bv === 'Unknown') return -1;
  const ai = CANONICAL_LEVEL_ORDER.indexOf(av);
  const bi = CANONICAL_LEVEL_ORDER.indexOf(bv);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return av.localeCompare(bv);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function StatusBadge({ status }: { status: AttendanceEntryRow['status'] }) {
  const variant: 'success' | 'muted' | 'blocked' =
    status === 'P' ? 'success' : status === 'A' ? 'blocked' : 'muted';
  return (
    <Badge variant={variant} className={BADGE_BASE}>
      {status}
    </Badge>
  );
}

function PctCell({ pct }: { pct: number }) {
  const tone =
    pct >= 95
      ? 'text-foreground'
      : pct >= 85
        ? 'text-foreground'
        : 'text-destructive';
  return (
    <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>
      {pct}%
    </span>
  );
}

function buildEntryColumns(
  visible: DrillColumnKey[]
): ColumnDef<AttendanceEntryRow, unknown>[] {
  const cols: ColumnDef<AttendanceEntryRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'attendanceDate':
        cols.push({
          id: 'attendanceDate',
          accessorKey: 'attendanceDate',
          header: DRILL_COLUMN_LABELS.attendanceDate,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums">
              {formatDate(row.original.attendanceDate)}
            </span>
          ),
        });
        break;
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.sectionName}</span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
          sortingFn: (a, b) =>
            compareLevels(a.original.level, b.original.level),
        });
        break;
      case 'status':
        cols.push({
          id: 'status',
          accessorKey: 'status',
          header: DRILL_COLUMN_LABELS.status,
          cell: ({ row }) => <StatusBadge status={row.original.status} />,
        });
        break;
      case 'exReason':
        cols.push({
          id: 'exReason',
          accessorKey: 'exReason',
          header: DRILL_COLUMN_LABELS.exReason,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground">
              {row.original.exReason ?? '—'}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

function buildTopAbsentColumns(
  visible: DrillColumnKey[]
): ColumnDef<TopAbsentDrillRow, unknown>[] {
  const cols: ColumnDef<TopAbsentDrillRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.sectionName}</span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
          sortingFn: (a, b) =>
            compareLevels(a.original.level, b.original.level),
        });
        break;
      case 'absences':
        cols.push({
          id: 'absences',
          accessorKey: 'absences',
          header: DRILL_COLUMN_LABELS.absences,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums text-destructive">
              {row.original.absences}
            </span>
          ),
        });
        break;
      case 'lates':
        cols.push({
          id: 'lates',
          accessorKey: 'lates',
          header: DRILL_COLUMN_LABELS.lates,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums text-muted-foreground">
              {row.original.lates}
            </span>
          ),
        });
        break;
      case 'excused':
        cols.push({
          id: 'excused',
          accessorKey: 'excused',
          header: DRILL_COLUMN_LABELS.excused,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums text-muted-foreground">
              {row.original.excused}
            </span>
          ),
        });
        break;
      case 'attendancePct':
        cols.push({
          id: 'attendancePct',
          accessorKey: 'attendancePct',
          header: DRILL_COLUMN_LABELS.attendancePct,
          cell: ({ row }) => <PctCell pct={row.original.attendancePct} />,
        });
        break;
      case 'encodedDays':
        cols.push({
          id: 'encodedDays',
          accessorKey: 'encodedDays',
          header: DRILL_COLUMN_LABELS.encodedDays,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.encodedDays}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

function buildSectionColumns(
  visible: DrillColumnKey[]
): ColumnDef<SectionAttendanceRow, unknown>[] {
  const cols: ColumnDef<SectionAttendanceRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <Link
              href={`/attendance/${encodeURIComponent(row.original.sectionId)}`}
              className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
            >
              {row.original.sectionName}
            </Link>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
          sortingFn: (a, b) =>
            compareLevels(a.original.level, b.original.level),
        });
        break;
      case 'attendancePct':
        cols.push({
          id: 'attendancePct',
          accessorKey: 'attendancePct',
          header: DRILL_COLUMN_LABELS.attendancePct,
          cell: ({ row }) => <PctCell pct={row.original.attendancePct} />,
        });
        break;
      case 'absences':
        cols.push({
          id: 'absences',
          accessorKey: 'absentCount',
          header: DRILL_COLUMN_LABELS.absences,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums text-destructive">
              {row.original.absentCount}
            </span>
          ),
        });
        break;
      case 'lates':
        cols.push({
          id: 'lates',
          accessorKey: 'lateCount',
          header: DRILL_COLUMN_LABELS.lates,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums text-muted-foreground">
              {row.original.lateCount}
            </span>
          ),
        });
        break;
      case 'encodedDays':
        cols.push({
          id: 'encodedDays',
          accessorKey: 'encodedDays',
          header: DRILL_COLUMN_LABELS.encodedDays,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.encodedDays}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

function buildCompassionateColumns(
  visible: DrillColumnKey[]
): ColumnDef<CompassionateUsageRow, unknown>[] {
  const cols: ColumnDef<CompassionateUsageRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.sectionName}</span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
        });
        break;
      case 'allowance':
        cols.push({
          id: 'allowance',
          accessorKey: 'allowance',
          header: DRILL_COLUMN_LABELS.allowance,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.allowance}
            </span>
          ),
        });
        break;
      case 'used':
        cols.push({
          id: 'used',
          accessorKey: 'used',
          header: DRILL_COLUMN_LABELS.used,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">{row.original.used}</span>
          ),
        });
        break;
      case 'remaining':
        cols.push({
          id: 'remaining',
          accessorKey: 'remaining',
          header: DRILL_COLUMN_LABELS.remaining,
          cell: ({ row }) => {
            const v = row.original.remaining;
            const tone =
              v < 0
                ? 'text-destructive'
                : v <= 1
                  ? 'text-foreground'
                  : 'text-muted-foreground';
            return (
              <span className={`font-mono tabular-nums ${tone}`}>{v}</span>
            );
          },
        });
        break;
      case 'isOverQuota':
        cols.push({
          id: 'isOverQuota',
          accessorKey: 'isOverQuota',
          header: DRILL_COLUMN_LABELS.isOverQuota,
          cell: ({ row }) =>
            row.original.isOverQuota ? (
              <Badge variant="blocked" className={BADGE_BASE}>
                Over
              </Badge>
            ) : (
              <Badge variant="muted" className={BADGE_BASE}>
                OK
              </Badge>
            ),
        });
        break;
    }
  }
  // Always-on action column — deep-link to the per-student attendance
  // detail page (canonical edit surface for the quota allowance + daily
  // ledger). Not driven by `visible` because it's an affordance, not data.
  cols.push({
    id: 'action',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        View
        <ArrowUpRight className="size-3" />
      </Link>
    ),
    enableSorting: false,
  });
  return cols;
}

function buildVacationLeaveColumns(
  visible: DrillColumnKey[]
): ColumnDef<VacationLeaveUsageRow, unknown>[] {
  const cols: ColumnDef<VacationLeaveUsageRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.sectionName}</span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
        });
        break;
      case 'termNumber':
        cols.push({
          id: 'termNumber',
          accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => (
            <Badge variant="muted" className={BADGE_BASE}>
              T{row.original.termNumber}
            </Badge>
          ),
        });
        break;
      case 'allowance':
        cols.push({
          id: 'allowance',
          accessorKey: 'allowance',
          header: DRILL_COLUMN_LABELS.allowance,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.allowance}
            </span>
          ),
        });
        break;
      case 'usedThisTerm':
        cols.push({
          id: 'usedThisTerm',
          accessorKey: 'usedThisTerm',
          header: DRILL_COLUMN_LABELS.usedThisTerm,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.usedThisTerm}
            </span>
          ),
        });
        break;
      case 'remainingThisTerm':
        cols.push({
          id: 'remainingThisTerm',
          accessorKey: 'remainingThisTerm',
          header: DRILL_COLUMN_LABELS.remainingThisTerm,
          cell: ({ row }) => {
            const v = row.original.remainingThisTerm;
            const tone = v <= 0 ? 'text-foreground' : 'text-muted-foreground';
            return (
              <span className={`font-mono tabular-nums ${tone}`}>{v}</span>
            );
          },
        });
        break;
      case 'isOverTermQuota':
        cols.push({
          id: 'isOverTermQuota',
          accessorKey: 'isOverTermQuota',
          header: DRILL_COLUMN_LABELS.isOverTermQuota,
          cell: ({ row }) =>
            row.original.isOverTermQuota ? (
              <Badge variant="blocked" className={BADGE_BASE}>
                Over
              </Badge>
            ) : (
              <Badge variant="muted" className={BADGE_BASE}>
                OK
              </Badge>
            ),
        });
        break;
    }
  }
  cols.push({
    id: 'action',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        View
        <ArrowUpRight className="size-3" />
      </Link>
    ),
    enableSorting: false,
  });
  return cols;
}

function buildCalendarColumns(
  visible: DrillColumnKey[]
): ColumnDef<CalendarDayRow, unknown>[] {
  const cols: ColumnDef<CalendarDayRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'date':
        cols.push({
          id: 'date',
          accessorKey: 'date',
          header: DRILL_COLUMN_LABELS.date,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums">
              {formatDate(row.original.date)}
            </span>
          ),
        });
        break;
      case 'dayType':
        cols.push({
          id: 'dayType',
          accessorKey: 'dayType',
          header: DRILL_COLUMN_LABELS.dayType,
          cell: ({ row }) => (
            <Badge variant="muted" className={BADGE_BASE}>
              {row.original.dayType}
            </Badge>
          ),
        });
        break;
      case 'label':
        cols.push({
          id: 'label',
          accessorKey: 'label',
          header: DRILL_COLUMN_LABELS.label,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.label ?? '—'}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

// Stable empty reference so `rows` keeps a steady identity while loading
// (downstream memos depend on its identity).
const EMPTY_ROWS: AttendanceDrillRow[] = [];

export function AttendanceDrillSheet(props: AttendanceDrillSheetProps) {
  const {
    target,
    segment,
    ayCode,
    initialFrom,
    initialTo,
    termId,
    initialEntries,
    initialTopAbsent,
    initialSectionAttendance,
    initialCalendar,
    initialCompassionate,
    initialVacationLeave,
  } = props;

  const kind = rowKindForTarget(target);

  const seedRows: AttendanceDrillRow[] = React.useMemo(() => {
    if (kind === 'entry') return initialEntries ?? [];
    if (kind === 'top-absent') return initialTopAbsent ?? [];
    if (kind === 'section-rollup') return initialSectionAttendance ?? [];
    if (kind === 'compassionate') return initialCompassionate ?? [];
    if (kind === 'vacation-leave') return initialVacationLeave ?? [];
    return initialCalendar ?? [];
  }, [
    kind,
    initialEntries,
    initialTopAbsent,
    initialSectionAttendance,
    initialCompassionate,
    initialVacationLeave,
    initialCalendar,
  ]);

  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>('none');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    DrillColumnKey[]
  >(() => defaultColumnsForTarget(target));

  // Was a server seed actually hydrated for this kind? (An empty seed array —
  // e.g. the parent passed `initialEntries={[]}` — is still a seed.) When no
  // seed prop is defined we always fetch on open, mirroring the prior
  // skipNextFetchRef(seedRows.length > 0) behaviour but distinguishing
  // "seeded with []" from "not seeded".
  const hasSeed =
    kind === 'entry'
      ? initialEntries !== undefined
      : kind === 'top-absent'
        ? initialTopAbsent !== undefined
        : kind === 'section-rollup'
          ? initialSectionAttendance !== undefined
          : kind === 'compassionate'
            ? initialCompassionate !== undefined
            : kind === 'vacation-leave'
              ? initialVacationLeave !== undefined
              : initialCalendar !== undefined;

  // Read via TanStack Query. seedRows (when the parent hydrated us) are the
  // initialData, so the drill renders instantly and skips the round-trip
  // within staleTime; otherwise it fetches on open and shows the skeleton. The
  // queryFn forwards the abort signal so a fast close/reopen aborts the stale
  // request. The route's specific errors land on isError → the retry block.
  const drillQuery = useQuery({
    queryKey: queryKeys.attendanceDrill(target, {
      ay: ayCode,
      from: initialFrom ?? null,
      to: initialTo ?? null,
      segment: segment ?? null,
      termId: termId ?? null,
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ ay: ayCode });
      if (initialFrom) params.set('from', initialFrom);
      if (initialTo) params.set('to', initialTo);
      if (segment) params.set('segment', segment);
      if (termId) params.set('termId', termId);
      const data = await apiFetch<{ rows?: AttendanceDrillRow[] }>(
        `/api/attendance/drill/${target}?${params.toString()}`,
        { signal }
      );
      return data.rows ?? [];
    },
    // The seed is the broad (kind-level) row set — per-(target,segment/termId)
    // narrowing happens server-side in the drill route (KD #82). So it's a
    // placeholder for instant paint, not authoritative: placeholderData paints
    // it immediately while the query STILL fetches the narrowed rows and
    // replaces it. (initialData + a fresh timestamp would skip the fetch and
    // leave the un-narrowed set showing.)
    placeholderData: hasSeed ? seedRows : undefined,
  });

  const rows = drillQuery.data ?? EMPTY_ROWS;

  const statusOptions = React.useMemo(() => {
    if (kind !== 'entry') return undefined;
    const s = new Set<string>();
    for (const r of rows as AttendanceEntryRow[]) s.add(r.status);
    return Array.from(s).sort();
  }, [rows, kind]);

  const levelOptions = React.useMemo(() => {
    if (kind === 'calendar-day') return undefined;
    const s = new Set<string>();
    for (const r of rows) {
      const lvl = (r as { level?: string | null }).level ?? null;
      s.add(lvl ?? 'Unknown');
    }
    const arr = Array.from(s);
    arr.sort(compareLevels);
    return arr;
  }, [rows, kind]);

  const preFiltered = React.useMemo(() => {
    let out = rows;
    if (selectedStatuses.length > 0 && kind === 'entry') {
      const set = new Set(selectedStatuses);
      out = (out as AttendanceEntryRow[]).filter((r) => set.has(r.status));
    }
    if (selectedLevels.length > 0 && kind !== 'calendar-day') {
      const set = new Set(selectedLevels);
      out = out.filter((r) =>
        set.has((r as { level?: string | null }).level ?? 'Unknown')
      );
    }
    return out;
  }, [rows, selectedStatuses, selectedLevels, kind]);

  const columns = React.useMemo(() => {
    if (kind === 'entry')
      return buildEntryColumns(visibleColumnKeys) as ColumnDef<
        AttendanceDrillRow,
        unknown
      >[];
    if (kind === 'top-absent')
      return buildTopAbsentColumns(visibleColumnKeys) as ColumnDef<
        AttendanceDrillRow,
        unknown
      >[];
    if (kind === 'section-rollup')
      return buildSectionColumns(visibleColumnKeys) as ColumnDef<
        AttendanceDrillRow,
        unknown
      >[];
    if (kind === 'compassionate')
      return buildCompassionateColumns(visibleColumnKeys) as ColumnDef<
        AttendanceDrillRow,
        unknown
      >[];
    if (kind === 'vacation-leave')
      return buildVacationLeaveColumns(visibleColumnKeys) as ColumnDef<
        AttendanceDrillRow,
        unknown
      >[];
    return buildCalendarColumns(visibleColumnKeys) as ColumnDef<
      AttendanceDrillRow,
      unknown
    >[];
  }, [kind, visibleColumnKeys]);

  const columnOptions = React.useMemo(
    () =>
      allColumnsForKind(kind as AttendanceDrillRowKind).map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k] ?? k,
      })),
    [kind]
  );

  const groupAccessor = React.useCallback(
    (row: AttendanceDrillRow): string | null => {
      if (groupBy === 'none') return null;
      if (kind === 'entry') {
        const r = row as AttendanceEntryRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.status;
        if (groupBy === 'stage') return r.sectionName;
      }
      if (
        kind === 'top-absent' ||
        kind === 'section-rollup' ||
        kind === 'compassionate' ||
        kind === 'vacation-leave'
      ) {
        const lvl = (row as { level?: string | null }).level ?? null;
        if (groupBy === 'level') return lvl ?? 'Unknown';
      }
      if (kind === 'calendar-day') {
        if (groupBy === 'status') return (row as CalendarDayRow).dayType;
      }
      return null;
    },
    [groupBy, kind]
  );

  const header = drillHeaderForTarget(target, segment ?? null);

  if (drillQuery.isLoading && rows.length === 0) {
    return <DrillSheetSkeleton title={header.title} />;
  }

  if (
    drillQuery.isError &&
    (rows.length === 0 || drillQuery.isPlaceholderData)
  ) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-lg font-semibold text-foreground">
            Couldn’t load {header.title.toLowerCase()}
          </p>
          <p className="text-sm text-muted-foreground">
            {drillQuery.error instanceof Error
              ? drillQuery.error.message
              : 'Something went wrong while loading this list.'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void drillQuery.refetch()}
          disabled={drillQuery.isFetching}
        >
          <RotateCcw
            className={cn('size-4', drillQuery.isFetching && 'animate-spin')}
          />
          Try again
        </Button>
      </div>
    );
  }

  const csvParams = new URLSearchParams({ ay: ayCode, format: 'csv' });
  if (initialFrom) csvParams.set('from', initialFrom);
  if (initialTo) csvParams.set('to', initialTo);
  if (segment) csvParams.set('segment', segment);
  if (visibleColumnKeys.length)
    csvParams.set('columns', visibleColumnKeys.join(','));
  const csvHref = `/api/attendance/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<AttendanceDrillRow>
      title={header.title}
      eyebrow={header.eyebrow}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={preFiltered}
      statusOptions={statusOptions}
      selectedStatuses={selectedStatuses}
      onStatusesChange={setSelectedStatuses}
      levelOptions={levelOptions}
      selectedLevels={selectedLevels}
      onLevelsChange={setSelectedLevels}
      groupBy={groupBy}
      onGroupByChange={setGroupBy}
      groupAccessor={groupAccessor}
      density={density}
      onDensityChange={setDensity}
      columnOptions={columnOptions}
      visibleColumnKeys={visibleColumnKeys}
      onColumnsChange={(next) => setVisibleColumnKeys(next as DrillColumnKey[])}
    />
  );
}
