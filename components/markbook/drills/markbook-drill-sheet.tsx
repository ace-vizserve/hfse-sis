'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';

import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import {
  allColumnsForKind,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  DRILL_COLUMN_LABELS,
  rowKindForTarget,
  type ChangeRequestRow,
  type DrillColumnKey,
  type DrillScope,
  type GradeEntryRow,
  type MarkbookDrillRow,
  type MarkbookDrillRowKind,
  type MarkbookDrillTarget,
  type SheetRow,
} from '@/lib/markbook/drill';

export type MarkbookDrillSheetProps = {
  target: MarkbookDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialScope?: DrillScope;
  initialFrom?: string;
  initialTo?: string;
  /** Pre-fetched rows keyed by kind. The component uses the kind matching the target. */
  initialEntries?: GradeEntryRow[];
  initialSheets?: SheetRow[];
  initialChangeRequests?: ChangeRequestRow[];
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
}

const BADGE_BASE = 'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function GradeBucketBadge({ bucket }: { bucket: string | null }) {
  if (!bucket) return <span className="text-muted-foreground">—</span>;
  const variant: 'success' | 'muted' | 'blocked' =
    bucket === 'o' || bucket === 'vs' ? 'success' :
    bucket === 'dnm' ? 'blocked' :
    'muted';
  return <Badge variant={variant} className={BADGE_BASE}>{bucket.toUpperCase()}</Badge>;
}

function LockBadge({ locked }: { locked: boolean }) {
  return locked ? (
    <Badge variant="blocked" className={BADGE_BASE}>
      <Lock className="h-3 w-3" /> Locked
    </Badge>
  ) : (
    <Badge variant="muted" className={BADGE_BASE}>
      <Unlock className="h-3 w-3" /> Open
    </Badge>
  );
}

function PublishBadge({ published }: { published: boolean }) {
  return published ? (
    <Badge variant="success" className={BADGE_BASE}>
      <CheckCircle2 className="h-3 w-3" /> Published
    </Badge>
  ) : (
    <Badge variant="muted" className={BADGE_BASE}>—</Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const variant: 'success' | 'muted' | 'blocked' =
    lower === 'approved' || lower === 'closed' ? 'success' :
    lower === 'rejected' ? 'blocked' :
    'muted';
  return <Badge variant={variant} className={BADGE_BASE}>{status}</Badge>;
}

function CompletenessCell({ row }: { row: SheetRow }) {
  const tone =
    row.completenessPct >= 100 ? 'text-foreground' :
    row.completenessPct >= 50 ? 'text-foreground' :
    'text-destructive';
  return (
    <span className={`font-mono text-[11px] tabular-nums ${tone}`}>
      {row.entriesPresent}/{row.entriesExpected} · {row.completenessPct}%
    </span>
  );
}

function buildEntryColumns(visible: DrillColumnKey[]): ColumnDef<GradeEntryRow, unknown>[] {
  const cols: ColumnDef<GradeEntryRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">{row.original.studentName}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'studentNumber':
        cols.push({ id: 'studentNumber', accessorKey: 'studentNumber',
          header: DRILL_COLUMN_LABELS.studentNumber,
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.studentNumber}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span>,
          sortingFn: (a, b) => compareLevels(a.original.level, b.original.level) });
        break;
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'subjectCode':
        cols.push({ id: 'subjectCode', accessorKey: 'subjectCode',
          header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.subjectCode}</span> });
        break;
      case 'termNumber':
        cols.push({ id: 'termNumber', accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => <span className="font-mono text-xs">T{row.original.termNumber}</span> });
        break;
      case 'rawScore':
        cols.push({ id: 'rawScore', accessorKey: 'rawScore',
          header: DRILL_COLUMN_LABELS.rawScore,
          cell: ({ row }) => <span className="tabular-nums">{row.original.rawScore ?? '—'}/{row.original.maxScore}</span> });
        break;
      case 'computedGrade':
        cols.push({ id: 'computedGrade', accessorKey: 'computedGrade',
          header: DRILL_COLUMN_LABELS.computedGrade,
          cell: ({ row }) => <span className="font-mono text-sm font-semibold tabular-nums">{row.original.computedGrade ?? '—'}</span> });
        break;
      case 'gradeBucket':
        cols.push({ id: 'gradeBucket', accessorKey: 'gradeBucket',
          header: DRILL_COLUMN_LABELS.gradeBucket,
          cell: ({ row }) => <GradeBucketBadge bucket={row.original.gradeBucket} /> });
        break;
      case 'isLocked':
        cols.push({ id: 'isLocked', accessorKey: 'isLocked',
          header: DRILL_COLUMN_LABELS.isLocked,
          cell: ({ row }) => <LockBadge locked={row.original.isLocked} /> });
        break;
      case 'enteredAt':
        cols.push({ id: 'enteredAt', accessorKey: 'enteredAt',
          header: DRILL_COLUMN_LABELS.enteredAt,
          cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.original.enteredAt)}</span> });
        break;
      case 'enteredBy':
        cols.push({ id: 'enteredBy', accessorKey: 'enteredBy',
          header: DRILL_COLUMN_LABELS.enteredBy,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.enteredBy ?? '—'}</span> });
        break;
    }
  }
  return cols;
}

function buildSheetColumns(visible: DrillColumnKey[]): ColumnDef<SheetRow, unknown>[] {
  const cols: ColumnDef<SheetRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sheetSubjectTerm':
        cols.push({ id: 'sheetSubjectTerm',
          header: DRILL_COLUMN_LABELS.sheetSubjectTerm,
          accessorFn: (r) => `${r.subjectCode} · T${r.termNumber}`,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <div className="font-mono text-xs">{row.original.subjectCode}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Term {row.original.termNumber}
              </div>
            </div>
          ) });
        break;
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'level':
        cols.push({ id: 'level', accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.level ?? '—'}</span>,
          sortingFn: (a, b) => compareLevels(a.original.level, b.original.level) });
        break;
      case 'subjectCode':
        cols.push({ id: 'subjectCode', accessorKey: 'subjectCode',
          header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.subjectCode}</span> });
        break;
      case 'termNumber':
        cols.push({ id: 'termNumber', accessorKey: 'termNumber',
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => <span className="font-mono text-xs">T{row.original.termNumber}</span> });
        break;
      case 'isLocked':
        cols.push({ id: 'isLocked', accessorKey: 'isLocked',
          header: DRILL_COLUMN_LABELS.isLocked,
          cell: ({ row }) => <LockBadge locked={row.original.isLocked} /> });
        break;
      case 'lockedAt':
        cols.push({ id: 'lockedAt', accessorKey: 'lockedAt',
          header: DRILL_COLUMN_LABELS.lockedAt,
          cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.original.lockedAt)}</span> });
        break;
      case 'publishedAt':
        cols.push({ id: 'publishedAt', accessorKey: 'publishedAt',
          header: DRILL_COLUMN_LABELS.publishedAt,
          cell: ({ row }) => row.original.isPublished
            ? <span className="text-sm tabular-nums">{formatDate(row.original.publishedAt)}</span>
            : <PublishBadge published={false} /> });
        break;
      case 'completeness':
        cols.push({ id: 'completeness', accessorKey: 'completenessPct',
          header: DRILL_COLUMN_LABELS.completeness,
          cell: ({ row }) => <CompletenessCell row={row.original} /> });
        break;
      case 'teacherName':
        cols.push({ id: 'teacherName', accessorKey: 'teacherName',
          header: DRILL_COLUMN_LABELS.teacherName,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.teacherName ?? '—'}</span> });
        break;
    }
  }
  return cols;
}

function buildChangeRequestColumns(visible: DrillColumnKey[]): ColumnDef<ChangeRequestRow, unknown>[] {
  const cols: ColumnDef<ChangeRequestRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'sectionName':
        cols.push({ id: 'sectionName', accessorKey: 'sectionName', header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => <span className="text-sm">{row.original.sectionName}</span> });
        break;
      case 'subjectCode':
        cols.push({ id: 'subjectCode', accessorKey: 'subjectCode', header: DRILL_COLUMN_LABELS.subjectCode,
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.subjectCode}</span> });
        break;
      case 'termNumber':
        cols.push({ id: 'termNumber', accessorKey: 'termNumber', header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => <span className="font-mono text-xs">T{row.original.termNumber}</span> });
        break;
      case 'status':
        cols.push({ id: 'status', accessorKey: 'status', header: DRILL_COLUMN_LABELS.status,
          cell: ({ row }) => <StatusBadge status={row.original.status} /> });
        break;
      case 'fieldChanged':
        cols.push({ id: 'fieldChanged', accessorKey: 'fieldChanged', header: DRILL_COLUMN_LABELS.fieldChanged,
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.fieldChanged}</span> });
        break;
      case 'reasonCategory':
        cols.push({ id: 'reasonCategory', accessorKey: 'reasonCategory', header: DRILL_COLUMN_LABELS.reasonCategory,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.reasonCategory}</span> });
        break;
      case 'requestedBy':
        cols.push({ id: 'requestedBy', accessorKey: 'requestedBy', header: DRILL_COLUMN_LABELS.requestedBy,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.requestedBy}</span> });
        break;
      case 'requestedAt':
        cols.push({ id: 'requestedAt', accessorKey: 'requestedAt', header: DRILL_COLUMN_LABELS.requestedAt,
          cell: ({ row }) => <span className="text-sm tabular-nums">{formatDate(row.original.requestedAt)}</span> });
        break;
      case 'resolvedAt':
        cols.push({ id: 'resolvedAt', accessorKey: 'resolvedAt', header: DRILL_COLUMN_LABELS.resolvedAt,
          cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.original.resolvedAt)}</span> });
        break;
    }
  }
  return cols;
}

export function MarkbookDrillSheet(props: MarkbookDrillSheetProps) {
  const {
    target,
    segment,
    ayCode,
    initialScope = 'range',
    initialFrom,
    initialTo,
    initialEntries,
    initialSheets,
    initialChangeRequests,
  } = props;

  const kind = rowKindForTarget(target);
  const seedRows: MarkbookDrillRow[] = React.useMemo(() => {
    if (kind === 'entry') return initialEntries ?? [];
    if (kind === 'sheet') return initialSheets ?? [];
    return initialChangeRequests ?? [];
  }, [kind, initialEntries, initialSheets, initialChangeRequests]);

  const [scope, setScope] = React.useState<DrillScope>(initialScope);
  const [rows, setRows] = React.useState<MarkbookDrillRow[]>(seedRows);
  const [loading, setLoading] = React.useState(seedRows.length === 0);
  const [globalFilter, _setGlobalFilter] = React.useState('');
  void _setGlobalFilter;
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
    fetch(`/api/markbook/drill/${target}?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error('drill_fetch_failed');
        return r.json();
      })
      .then((data: { rows: MarkbookDrillRow[] }) => {
        if (!cancelled) setRows(data.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load drill data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, segment, ayCode, scope, initialFrom, initialTo]);

  // Status + level options derived from the unfiltered rows.
  const statusOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (kind === 'entry') s.add((r as GradeEntryRow).isLocked ? 'Locked' : 'Open');
      else if (kind === 'sheet') s.add((r as SheetRow).isLocked ? 'Locked' : 'Open');
      else s.add((r as ChangeRequestRow).status);
    }
    return Array.from(s).sort();
  }, [rows, kind]);

  const levelOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (kind === 'entry') s.add((r as GradeEntryRow).level ?? 'Unknown');
      else if (kind === 'sheet') s.add((r as SheetRow).level ?? 'Unknown');
      // change-request rows have no level
    }
    const arr = Array.from(s);
    arr.sort(compareLevels);
    return arr;
  }, [rows, kind]);

  // Apply status + level filters before passing to DrillDownSheet.
  const preFiltered = React.useMemo(() => {
    let out = rows;
    if (selectedStatuses.length > 0) {
      const set = new Set(selectedStatuses);
      out = out.filter((r) => {
        if (kind === 'entry') return set.has((r as GradeEntryRow).isLocked ? 'Locked' : 'Open');
        if (kind === 'sheet') return set.has((r as SheetRow).isLocked ? 'Locked' : 'Open');
        return set.has((r as ChangeRequestRow).status);
      });
    }
    if (selectedLevels.length > 0 && kind !== 'change-request') {
      const set = new Set(selectedLevels);
      out = out.filter((r) => {
        const lvl = (kind === 'entry' ? (r as GradeEntryRow).level : (r as SheetRow).level) ?? 'Unknown';
        return set.has(lvl);
      });
    }
    return out;
  }, [rows, selectedStatuses, selectedLevels, kind]);

  // Build columns based on row kind.
  const columns = React.useMemo(() => {
    if (kind === 'entry') return buildEntryColumns(visibleColumnKeys) as ColumnDef<MarkbookDrillRow, unknown>[];
    if (kind === 'sheet') return buildSheetColumns(visibleColumnKeys) as ColumnDef<MarkbookDrillRow, unknown>[];
    return buildChangeRequestColumns(visibleColumnKeys) as ColumnDef<MarkbookDrillRow, unknown>[];
  }, [kind, visibleColumnKeys]);

  const columnOptions = React.useMemo(
    () =>
      allColumnsForKind(kind as MarkbookDrillRowKind).map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k] ?? k,
      })),
    [kind],
  );

  const groupAccessor = React.useCallback(
    (row: MarkbookDrillRow): string | null => {
      if (groupBy === 'none') return null;
      if (kind === 'entry') {
        const r = row as GradeEntryRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.isLocked ? 'Locked' : 'Open';
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      if (kind === 'sheet') {
        const r = row as SheetRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.isLocked ? 'Locked' : 'Open';
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      const r = row as ChangeRequestRow;
      if (groupBy === 'status') return r.status;
      if (groupBy === 'stage') return `T${r.termNumber}`;
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
  const csvHref = `/api/markbook/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<MarkbookDrillRow>
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
      levelOptions={kind === 'change-request' ? undefined : levelOptions}
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
