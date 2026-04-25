'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

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
  type DrillColumnKey,
  type DrillScope,
  type EvaluationDrillRow,
  type EvaluationDrillRowKind,
  type EvaluationDrillTarget,
  type SectionWriteupRow,
  type TimeToSubmitBucket,
  type WriteupRow,
} from '@/lib/evaluation/drill';

export type EvaluationDrillSheetProps = {
  target: EvaluationDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialScope?: DrillScope;
  initialFrom?: string;
  initialTo?: string;
  initialWriteups?: WriteupRow[];
  initialBySection?: SectionWriteupRow[];
  initialBuckets?: TimeToSubmitBucket[];
};

const CANONICAL_LEVEL_ORDER = ['P1','P2','P3','P4','P5','P6','S1','S2','S3','S4'];
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

function StatusBadge({ status }: { status: WriteupRow['status'] }) {
  const variant: 'success' | 'muted' | 'blocked' =
    status === 'submitted' ? 'success' :
    status === 'draft' ? 'muted' :
    'blocked';
  return <Badge variant={variant} className={BADGE_BASE}>{status}</Badge>;
}

function PctCell({ pct }: { pct: number }) {
  const tone =
    pct >= 80 ? 'text-foreground' :
    pct >= 50 ? 'text-foreground' :
    'text-destructive';
  return <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{pct}%</span>;
}

function buildWriteupColumns(visible: DrillColumnKey[]): ColumnDef<WriteupRow, unknown>[] {
  const cols: ColumnDef<WriteupRow, unknown>[] = [];
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
      case 'termNumber':
        cols.push({ id: 'termNumber', accessorKey: 'termNumber', header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => <span className="font-mono text-xs">T{row.original.termNumber}</span> });
        break;
      case 'status':
        cols.push({ id: 'status', accessorKey: 'status', header: DRILL_COLUMN_LABELS.status,
          cell: ({ row }) => <StatusBadge status={row.original.status} /> });
        break;
      case 'draftCharCount':
        cols.push({ id: 'draftCharCount', accessorKey: 'draftCharCount', header: DRILL_COLUMN_LABELS.draftCharCount,
          cell: ({ row }) => <span className="font-mono text-xs tabular-nums">{row.original.draftCharCount}</span> });
        break;
      case 'submittedAt':
        cols.push({ id: 'submittedAt', accessorKey: 'submittedAt', header: DRILL_COLUMN_LABELS.submittedAt,
          cell: ({ row }) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.original.submittedAt)}</span> });
        break;
      case 'daysToSubmit':
        cols.push({ id: 'daysToSubmit', accessorKey: 'daysToSubmit', header: DRILL_COLUMN_LABELS.daysToSubmit,
          cell: ({ row }) => row.original.daysToSubmit != null
            ? <span className="font-mono text-sm tabular-nums">{row.original.daysToSubmit}d</span>
            : <span className="text-muted-foreground">—</span> });
        break;
      case 'adviserEmail':
        cols.push({ id: 'adviserEmail', accessorKey: 'adviserEmail', header: DRILL_COLUMN_LABELS.adviserEmail,
          cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.adviserEmail ?? '—'}</span> });
        break;
    }
  }
  return cols;
}

function buildSectionColumns(visible: DrillColumnKey[]): ColumnDef<SectionWriteupRow, unknown>[] {
  const cols: ColumnDef<SectionWriteupRow, unknown>[] = [];
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
      case 'termNumber':
        cols.push({ id: 'termNumber', accessorKey: 'termNumber', header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => <span className="font-mono text-xs">T{row.original.termNumber}</span> });
        break;
      case 'submissionPct':
        cols.push({ id: 'submissionPct', accessorKey: 'submissionPct', header: DRILL_COLUMN_LABELS.submissionPct,
          cell: ({ row }) => <PctCell pct={row.original.submissionPct} /> });
        break;
      case 'submitted':
        cols.push({ id: 'submitted', accessorKey: 'submitted', header: DRILL_COLUMN_LABELS.submitted,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.submitted}</span> });
        break;
      case 'draft':
        cols.push({ id: 'draft', accessorKey: 'draft', header: DRILL_COLUMN_LABELS.draft,
          cell: ({ row }) => <span className="font-mono tabular-nums text-muted-foreground">{row.original.draft}</span> });
        break;
      case 'missing':
        cols.push({ id: 'missing', accessorKey: 'missing', header: DRILL_COLUMN_LABELS.missing,
          cell: ({ row }) => <span className="font-mono tabular-nums text-destructive">{row.original.missing}</span> });
        break;
      case 'total':
        cols.push({ id: 'total', accessorKey: 'total', header: DRILL_COLUMN_LABELS.total,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.total}</span> });
        break;
    }
  }
  return cols;
}

function buildBucketColumns(visible: DrillColumnKey[]): ColumnDef<TimeToSubmitBucket, unknown>[] {
  const cols: ColumnDef<TimeToSubmitBucket, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'bucketLabel':
        cols.push({ id: 'bucketLabel', accessorKey: 'label', header: DRILL_COLUMN_LABELS.bucketLabel,
          cell: ({ row }) => <span className="font-mono text-sm">{row.original.label}</span> });
        break;
      case 'bucketCount':
        cols.push({ id: 'bucketCount', accessorKey: 'count', header: DRILL_COLUMN_LABELS.bucketCount,
          cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.count}</span> });
        break;
    }
  }
  return cols;
}

export function EvaluationDrillSheet(props: EvaluationDrillSheetProps) {
  const {
    target, segment, ayCode,
    initialScope = 'range', initialFrom, initialTo,
    initialWriteups, initialBySection, initialBuckets,
  } = props;

  const kind = rowKindForTarget(target);
  const seedRows: EvaluationDrillRow[] = React.useMemo(() => {
    if (kind === 'writeup') return initialWriteups ?? [];
    if (kind === 'section-rollup') return initialBySection ?? [];
    return initialBuckets ?? [];
  }, [kind, initialWriteups, initialBySection, initialBuckets]);

  const [scope, setScope] = React.useState<DrillScope>(initialScope);
  const [rows, setRows] = React.useState<EvaluationDrillRow[]>(seedRows);
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
    const params = new URLSearchParams({ ay: ayCode, scope });
    if (initialFrom) params.set('from', initialFrom);
    if (initialTo) params.set('to', initialTo);
    if (segment) params.set('segment', segment);
    fetch(`/api/evaluation/drill/${target}?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error('drill_fetch_failed'); return r.json(); })
      .then((data: { rows: EvaluationDrillRow[] }) => { if (!cancelled) setRows(data.rows ?? []); })
      .catch(() => { if (!cancelled) toast.error('Failed to load drill data'); });
    return () => { cancelled = true; };
  }, [target, segment, ayCode, scope, initialFrom, initialTo]);

  const statusOptions = React.useMemo(() => {
    if (kind !== 'writeup') return undefined;
    const s = new Set<string>();
    for (const r of rows as WriteupRow[]) s.add(r.status);
    return Array.from(s).sort();
  }, [rows, kind]);

  const levelOptions = React.useMemo(() => {
    if (kind === 'bucket') return undefined;
    const s = new Set<string>();
    for (const r of rows) s.add(((r as { level?: string | null }).level ?? null) ?? 'Unknown');
    const arr = Array.from(s);
    arr.sort(compareLevels);
    return arr;
  }, [rows, kind]);

  const preFiltered = React.useMemo(() => {
    let out = rows;
    if (selectedStatuses.length > 0 && kind === 'writeup') {
      const set = new Set(selectedStatuses);
      out = (out as WriteupRow[]).filter((r) => set.has(r.status));
    }
    if (selectedLevels.length > 0 && kind !== 'bucket') {
      const set = new Set(selectedLevels);
      out = out.filter((r) => set.has(((r as { level?: string | null }).level ?? null) ?? 'Unknown'));
    }
    return out;
  }, [rows, selectedStatuses, selectedLevels, kind]);

  const columns = React.useMemo(() => {
    if (kind === 'writeup') return buildWriteupColumns(visibleColumnKeys) as ColumnDef<EvaluationDrillRow, unknown>[];
    if (kind === 'section-rollup') return buildSectionColumns(visibleColumnKeys) as ColumnDef<EvaluationDrillRow, unknown>[];
    return buildBucketColumns(visibleColumnKeys) as ColumnDef<EvaluationDrillRow, unknown>[];
  }, [kind, visibleColumnKeys]);

  const columnOptions = React.useMemo(
    () => allColumnsForKind(kind as EvaluationDrillRowKind).map((k) => ({
      key: k, label: DRILL_COLUMN_LABELS[k] ?? k,
    })),
    [kind],
  );

  const groupAccessor = React.useCallback(
    (row: EvaluationDrillRow): string | null => {
      if (groupBy === 'none') return null;
      if (kind === 'writeup') {
        const r = row as WriteupRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'status') return r.status;
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      if (kind === 'section-rollup') {
        const r = row as SectionWriteupRow;
        if (groupBy === 'level') return r.level ?? 'Unknown';
        if (groupBy === 'stage') return `T${r.termNumber}`;
      }
      return null;
    },
    [groupBy, kind],
  );

  const header = drillHeaderForTarget(target, segment ?? null);

  const csvParams = new URLSearchParams({ ay: ayCode, scope, format: 'csv' });
  if (initialFrom) csvParams.set('from', initialFrom);
  if (initialTo) csvParams.set('to', initialTo);
  if (segment) csvParams.set('segment', segment);
  if (visibleColumnKeys.length) csvParams.set('columns', visibleColumnKeys.join(','));
  const csvHref = `/api/evaluation/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<EvaluationDrillRow>
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
