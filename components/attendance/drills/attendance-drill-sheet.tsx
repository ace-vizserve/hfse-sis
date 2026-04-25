'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { Badge } from '@/components/ui/badge';
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
  type DrillScope,
  type SectionAttendanceRow,
  type TopAbsentDrillRow,
} from '@/lib/attendance/drill';

export type AttendanceDrillSheetProps = {
  target: AttendanceDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialScope?: DrillScope;
  initialFrom?: string;
  initialTo?: string;
  initialEntries?: AttendanceEntryRow[];
  initialTopAbsent?: TopAbsentDrillRow[];
  initialSectionAttendance?: SectionAttendanceRow[];
  initialCalendar?: CalendarDayRow[];
  initialCompassionate?: CompassionateUsageRow[];
};

const CANONICAL_LEVEL_ORDER = [
  'P1','P2','P3','P4','P5','P6','S1','S2','S3','S4',
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
  return d.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
}

const BADGE_BASE = 'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function StatusBadge({ status }: { status: AttendanceEntryRow['status'] }) {
  const variant: 'success' | 'muted' | 'blocked' =
    status === 'P' ? 'success' :
    status === 'A' ? 'blocked' :
    'muted';
  return <Badge variant={variant} className={BADGE_BASE}>{status}</Badge>;
}

function PctCell({ pct }: { pct: number }) {
  const tone =
    pct >= 95 ? 'text-foreground' :
    pct >= 85 ? 'text-foreground' :
    'text-destructive';
  return <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{pct}%</span>;
}

function buildEntryColumns(visible: DrillColumnKey[]): ColumnDef<AttendanceEntryRow, unknown>[] {
  const cols: ColumnDef<AttendanceEntryRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'attendanceDate':
        cols.push({ id: 'attendanceDate', accessorKey: 'attendanceDate', header: DRILL_COLUMN_LABELS.attendanceDate,
          cell: ({ row }) => <span className="text-sm tabular-nums">{formatDate(row.original.attendanceDate)}</span> });
        break;
      case 'studentName':
        cols.push({ id: 'studentName', accessorKey: 'studentName', header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">{row.original.studentName}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{row.original.studentNumber}</div>
            </div>
          ) });
        break;
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName', header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level', header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span>,
          sortingFn: (a, b) => compareLevels(a.original.level, b.original.level) });
        break;
      case 'status':
        cols.push({ id: 'status', accessorKey: 'status', header: DRILL_COLUMN_LABELS.status,
          cell: ({ row }) => <StatusBadge status={row.original.status} /> });
        break;
      case 'exReason':
        cols.push({ id: 'exReason', accessorKey: 'exReason', header: DRILL_COLUMN_LABELS.exReason,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.exReason ?? '—'}</span> });
        break;
    }
  }
  return cols;
}

function buildTopAbsentColumns(visible: DrillColumnKey[]): ColumnDef<TopAbsentDrillRow, unknown>[] {
  const cols: ColumnDef<TopAbsentDrillRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({ id: 'studentName', accessorKey: 'studentName', header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">{row.original.studentName}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{row.original.studentNumber}</div>
            </div>
          ) });
        break;
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName', header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level', header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span>,
          sortingFn: (a, b) => compareLevels(a.original.level, b.original.level) });
        break;
      case 'absences':
        cols.push({ id: 'absences', accessorKey: 'absences', header: DRILL_COLUMN_LABELS.absences,
          cell: ({ row }) => <span className="font-mono tabular-nums text-destructive">{row.original.absences}</span> });
        break;
      case 'lates':
        cols.push({ id: 'lates', accessorKey: 'lates', header: DRILL_COLUMN_LABELS.lates,
          cell: ({ row }) => <span className="font-mono tabular-nums text-muted-foreground">{row.original.lates}</span> });
        break;
      case 'excused':
        cols.push({ id: 'excused', accessorKey: 'excused', header: DRILL_COLUMN_LABELS.excused,
          cell: ({ row }) => <span className="font-mono tabular-nums text-muted-foreground">{row.original.excused}</span> });
        break;
      case 'attendancePct':
        cols.push({ id: 'attendancePct', accessorKey: 'attendancePct', header: DRILL_COLUMN_LABELS.attendancePct,
          cell: ({ row }) => <PctCell pct={row.original.attendancePct} /> });
        break;
      case 'encodedDays':
        cols.push({ id: 'encodedDays', accessorKey: 'encodedDays', header: DRILL_COLUMN_LABELS.encodedDays,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.encodedDays}</span> });
        break;
    }
  }
  return cols;
}

function buildSectionColumns(visible: DrillColumnKey[]): ColumnDef<SectionAttendanceRow, unknown>[] {
  const cols: ColumnDef<SectionAttendanceRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName', header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="font-medium">{row.original.sectionName}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level', header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span>,
          sortingFn: (a, b) => compareLevels(a.original.level, b.original.level) });
        break;
      case 'attendancePct':
        cols.push({ id: 'attendancePct', accessorKey: 'attendancePct', header: DRILL_COLUMN_LABELS.attendancePct,
          cell: ({ row }) => <PctCell pct={row.original.attendancePct} /> });
        break;
      case 'absences':
        cols.push({ id: 'absences', accessorKey: 'absentCount', header: DRILL_COLUMN_LABELS.absences,
          cell: ({ row }) => <span className="font-mono tabular-nums text-destructive">{row.original.absentCount}</span> });
        break;
      case 'lates':
        cols.push({ id: 'lates', accessorKey: 'lateCount', header: DRILL_COLUMN_LABELS.lates,
          cell: ({ row }) => <span className="font-mono tabular-nums text-muted-foreground">{row.original.lateCount}</span> });
        break;
      case 'encodedDays':
        cols.push({ id: 'encodedDays', accessorKey: 'encodedDays', header: DRILL_COLUMN_LABELS.encodedDays,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.encodedDays}</span> });
        break;
    }
  }
  return cols;
}

function buildCompassionateColumns(visible: DrillColumnKey[]): ColumnDef<CompassionateUsageRow, unknown>[] {
  const cols: ColumnDef<CompassionateUsageRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({ id: 'studentName', accessorKey: 'studentName', header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">{row.original.studentName}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{row.original.studentNumber}</div>
            </div>
          ) });
        break;
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName', header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level', header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span> });
        break;
      case 'allowance':
        cols.push({ id: 'allowance', accessorKey: 'allowance', header: DRILL_COLUMN_LABELS.allowance,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.allowance}</span> });
        break;
      case 'used':
        cols.push({ id: 'used', accessorKey: 'used', header: DRILL_COLUMN_LABELS.used,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.used}</span> });
        break;
      case 'remaining':
        cols.push({ id: 'remaining', accessorKey: 'remaining', header: DRILL_COLUMN_LABELS.remaining,
          cell: ({ row }) => {
            const v = row.original.remaining;
            const tone = v < 0 ? 'text-destructive' : v <= 1 ? 'text-foreground' : 'text-muted-foreground';
            return <span className={`font-mono tabular-nums ${tone}`}>{v}</span>;
          } });
        break;
      case 'isOverQuota':
        cols.push({ id: 'isOverQuota', accessorKey: 'isOverQuota', header: DRILL_COLUMN_LABELS.isOverQuota,
          cell: ({ row }) => row.original.isOverQuota
            ? <Badge variant="blocked" className={BADGE_BASE}>Over</Badge>
            : <Badge variant="muted" className={BADGE_BASE}>OK</Badge> });
        break;
    }
  }
  return cols;
}

function buildCalendarColumns(visible: DrillColumnKey[]): ColumnDef<CalendarDayRow, unknown>[] {
  const cols: ColumnDef<CalendarDayRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'date':
        cols.push({ id: 'date', accessorKey: 'date', header: DRILL_COLUMN_LABELS.date,
          cell: ({ row }) => <span className="text-sm tabular-nums">{formatDate(row.original.date)}</span> });
        break;
      case 'dayType':
        cols.push({ id: 'dayType', accessorKey: 'dayType', header: DRILL_COLUMN_LABELS.dayType,
          cell: ({ row }) => <Badge variant="muted" className={BADGE_BASE}>{row.original.dayType}</Badge> });
        break;
      case 'label':
        cols.push({ id: 'label', accessorKey: 'label', header: DRILL_COLUMN_LABELS.label,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.label ?? '—'}</span> });
        break;
    }
  }
  return cols;
}

export function AttendanceDrillSheet(props: AttendanceDrillSheetProps) {
  const {
    target,
    segment,
    ayCode,
    initialScope = 'range',
    initialFrom,
    initialTo,
    initialEntries,
    initialTopAbsent,
    initialSectionAttendance,
    initialCalendar,
    initialCompassionate,
  } = props;

  const kind = rowKindForTarget(target);

  const seedRows: AttendanceDrillRow[] = React.useMemo(() => {
    if (kind === 'entry') return initialEntries ?? [];
    if (kind === 'top-absent') return initialTopAbsent ?? [];
    if (kind === 'section-rollup') return initialSectionAttendance ?? [];
    if (kind === 'compassionate') return initialCompassionate ?? [];
    return initialCalendar ?? [];
  }, [kind, initialEntries, initialTopAbsent, initialSectionAttendance, initialCompassionate, initialCalendar]);

  const [scope, setScope] = React.useState<DrillScope>(initialScope);
  const [rows, setRows] = React.useState<AttendanceDrillRow[]>(seedRows);
  const [loading, setLoading] = React.useState(seedRows.length === 0);
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>('none');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<DrillColumnKey[]>(
    () => defaultColumnsForTarget(target),
  );

  const skipNextFetchRef = React.useRef(seedRows.length > 0);

  React.useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ ay: ayCode, scope });
    if (initialFrom) params.set('from', initialFrom);
    if (initialTo) params.set('to', initialTo);
    if (segment) params.set('segment', segment);
    fetch(`/api/attendance/drill/${target}?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error('drill_fetch_failed');
        return r.json();
      })
      .then((data: { rows: AttendanceDrillRow[] }) => {
        if (!cancelled) setRows(data.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load drill data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [target, segment, ayCode, scope, initialFrom, initialTo]);

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
      out = out.filter((r) => set.has(((r as { level?: string | null }).level ?? null) ?? 'Unknown'));
    }
    return out;
  }, [rows, selectedStatuses, selectedLevels, kind]);

  const columns = React.useMemo(() => {
    if (kind === 'entry') return buildEntryColumns(visibleColumnKeys) as ColumnDef<AttendanceDrillRow, unknown>[];
    if (kind === 'top-absent') return buildTopAbsentColumns(visibleColumnKeys) as ColumnDef<AttendanceDrillRow, unknown>[];
    if (kind === 'section-rollup') return buildSectionColumns(visibleColumnKeys) as ColumnDef<AttendanceDrillRow, unknown>[];
    if (kind === 'compassionate') return buildCompassionateColumns(visibleColumnKeys) as ColumnDef<AttendanceDrillRow, unknown>[];
    return buildCalendarColumns(visibleColumnKeys) as ColumnDef<AttendanceDrillRow, unknown>[];
  }, [kind, visibleColumnKeys]);

  const columnOptions = React.useMemo(
    () => allColumnsForKind(kind as AttendanceDrillRowKind).map((k) => ({
      key: k,
      label: DRILL_COLUMN_LABELS[k] ?? k,
    })),
    [kind],
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
      if (kind === 'top-absent' || kind === 'section-rollup' || kind === 'compassionate') {
        const lvl = (row as { level?: string | null }).level ?? null;
        if (groupBy === 'level') return lvl ?? 'Unknown';
      }
      if (kind === 'calendar-day') {
        if (groupBy === 'status') return (row as CalendarDayRow).dayType;
      }
      return null;
    },
    [groupBy, kind],
  );

  const header = drillHeaderForTarget(target, segment ?? null);

  if (loading && rows.length === 0) {
    return <DrillSheetSkeleton title={header.title} />;
  }

  const csvParams = new URLSearchParams({ ay: ayCode, scope, format: 'csv' });
  if (initialFrom) csvParams.set('from', initialFrom);
  if (initialTo) csvParams.set('to', initialTo);
  if (segment) csvParams.set('segment', segment);
  if (visibleColumnKeys.length) csvParams.set('columns', visibleColumnKeys.join(','));
  const csvHref = `/api/attendance/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<AttendanceDrillRow>
      title={header.title}
      eyebrow={header.eyebrow}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={preFiltered}
      scope={scope}
      onScopeChange={setScope}
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
