'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileX,
  RotateCcw,
} from 'lucide-react';

import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ALL_DRILL_COLUMNS,
  DRILL_COLUMN_LABELS,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  type DrillColumnKey,
  type PFilesDrillRow,
  type PFilesDrillTarget,
} from '@/lib/p-files/drill';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import { compareLevelLabels } from '@/lib/sis/levels';

// Stable empty reference so `rows` keeps a steady identity while loading.
const EMPTY_ROWS: PFilesDrillRow[] = [];

// ─── Props ──────────────────────────────────────────────────────────────────

export type PFilesDrillSheetProps = {
  target: PFilesDrillTarget;
  segment?: string | null;
  ayCode: string;
  initialFrom?: string;
  initialTo?: string;
  initialRows?: PFilesDrillRow[];
};

// ─── Cell badges ────────────────────────────────────────────────────────────

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function StatusBadge({ status }: { status: PFilesDrillRow['status'] }) {
  switch (status) {
    case 'On file':
      return (
        <Badge variant="success" className={BADGE_BASE}>
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          On file
        </Badge>
      );
    case 'Awaiting validation':
      return (
        <Badge variant="muted" className={BADGE_BASE}>
          <Clock className="h-3 w-3" aria-hidden />
          Awaiting validation
        </Badge>
      );
    case 'Promised':
      return (
        <Badge variant="muted" className={BADGE_BASE}>
          <Clock className="h-3 w-3" aria-hidden />
          Promised
        </Badge>
      );
    case 'Rejected':
      return (
        <Badge variant="blocked" className={BADGE_BASE}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Rejected
        </Badge>
      );
    case 'Expired':
      return (
        <Badge variant="blocked" className={BADGE_BASE}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Expired
        </Badge>
      );
    case 'Missing':
      return (
        <Badge variant="blocked" className={BADGE_BASE}>
          <FileX className="h-3 w-3" aria-hidden />
          Missing
        </Badge>
      );
  }
}

function ExpiryCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  const tone =
    days < 0
      ? 'text-destructive'
      : days <= 14
        ? 'text-destructive'
        : days <= 60
          ? 'text-foreground'
          : 'text-muted-foreground';
  return (
    <span className={`font-mono text-sm tabular-nums ${tone}`}>
      {days < 0 ? `Expired ${-days}d` : `${days}d`}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Column factory ─────────────────────────────────────────────────────────

function buildColumns(
  visible: DrillColumnKey[]
): ColumnDef<PFilesDrillRow, unknown>[] {
  const cols: ColumnDef<PFilesDrillRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'fullName':
        cols.push({
          id: 'fullName',
          accessorKey: 'fullName',
          header: DRILL_COLUMN_LABELS.fullName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/p-files/${encodeURIComponent(row.original.enroleeNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.fullName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.enroleeNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'enroleeNumber':
        cols.push({
          id: 'enroleeNumber',
          accessorKey: 'enroleeNumber',
          header: DRILL_COLUMN_LABELS.enroleeNumber,
          cell: ({ row }) => (
            <span className="font-mono text-xs">
              {row.original.enroleeNumber}
            </span>
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
            compareLevelLabels(a.original.level, b.original.level),
        });
        break;
      case 'slotLabel':
        cols.push({
          id: 'slotLabel',
          accessorKey: 'slotLabel',
          header: DRILL_COLUMN_LABELS.slotLabel,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.slotLabel}</span>
          ),
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
      case 'expiryDate':
        cols.push({
          id: 'expiryDate',
          accessorKey: 'expiryDate',
          header: DRILL_COLUMN_LABELS.expiryDate,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.expiryDate)}
            </span>
          ),
        });
        break;
      case 'daysToExpiry':
        cols.push({
          id: 'daysToExpiry',
          accessorKey: 'daysToExpiry',
          header: DRILL_COLUMN_LABELS.daysToExpiry,
          cell: ({ row }) => <ExpiryCell days={row.original.daysToExpiry} />,
          sortingFn: (a, b) => {
            const av = a.original.daysToExpiry;
            const bv = b.original.daysToExpiry;
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return av - bv;
          },
        });
        break;
      case 'revisionCount':
        cols.push({
          id: 'revisionCount',
          accessorKey: 'revisionCount',
          header: DRILL_COLUMN_LABELS.revisionCount,
          cell: ({ row }) => (
            <span className="font-mono text-sm tabular-nums">
              {row.original.revisionCount}
            </span>
          ),
        });
        break;
      case 'lastRevisionAt':
        cols.push({
          id: 'lastRevisionAt',
          accessorKey: 'lastRevisionAt',
          header: DRILL_COLUMN_LABELS.lastRevisionAt,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.lastRevisionAt)}
            </span>
          ),
        });
        break;
    }
  }
  return cols;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function PFilesDrillSheet(props: PFilesDrillSheetProps) {
  const { target, segment, ayCode, initialFrom, initialTo, initialRows } =
    props;

  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>('none');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    DrillColumnKey[]
  >(() => defaultColumnsForTarget(target));

  // Read via TanStack Query. initialRows (when the parent hydrated us) are the
  // initialData, so the drill renders instantly and skips the round-trip within
  // staleTime; otherwise it fetches on open and shows the skeleton. The queryFn
  // forwards the abort signal so a fast close/reopen aborts the stale request.
  const drillQuery = useQuery({
    queryKey: queryKeys.pfilesDrill(target, {
      ay: ayCode,
      from: initialFrom ?? null,
      to: initialTo ?? null,
      segment: segment ?? null,
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ ay: ayCode });
      if (initialFrom) params.set('from', initialFrom);
      if (initialTo) params.set('to', initialTo);
      if (segment) params.set('segment', segment);
      const json = await apiFetch<{ rows?: PFilesDrillRow[] }>(
        `/api/p-files/drill/${target}?${params.toString()}`,
        { signal }
      );
      return Array.isArray(json.rows) ? json.rows : [];
    },
    // The seed is the broad, un-narrowed row set — per-(target,segment)
    // narrowing happens server-side in the drill route (KD #82). So it's a
    // placeholder for instant paint, NOT authoritative: placeholderData paints
    // it immediately while the query STILL fetches the narrowed rows and
    // replaces it. (initialData + a fresh timestamp would skip the fetch and
    // leave the un-narrowed set showing.)
    placeholderData: initialRows,
  });

  const rows = drillQuery.data ?? EMPTY_ROWS;

  // Filter options derived from unfiltered rows
  const statusOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.status);
    return Array.from(s).sort();
  }, [rows]);

  const levelOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.level ?? 'Unknown');
    const arr = Array.from(s);
    arr.sort(compareLevelLabels);
    return arr;
  }, [rows]);

  // Single-pass status + level filter
  const preFiltered = React.useMemo(() => {
    if (selectedStatuses.length === 0 && selectedLevels.length === 0)
      return rows;
    const statusSet = new Set(selectedStatuses);
    const levelSet = new Set(selectedLevels);
    return rows.filter((r) => {
      if (selectedStatuses.length > 0 && !statusSet.has(r.status)) return false;
      if (selectedLevels.length > 0 && !levelSet.has(r.level ?? 'Unknown'))
        return false;
      return true;
    });
  }, [rows, selectedStatuses, selectedLevels]);

  const columns = React.useMemo(
    () => buildColumns(visibleColumnKeys),
    [visibleColumnKeys]
  );

  const columnOptions = React.useMemo(
    () =>
      ALL_DRILL_COLUMNS.map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k] ?? k,
      })),
    []
  );

  const groupAccessor = React.useCallback(
    (row: PFilesDrillRow): string | null => {
      if (groupBy === 'none') return null;
      if (groupBy === 'level') return row.level ?? 'Unknown';
      if (groupBy === 'status') return row.status;
      if (groupBy === 'stage') return row.slotLabel; // re-use 'stage' UI for slot grouping
      return null;
    },
    [groupBy]
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
              : 'Failed to load drill data'}
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
  const csvHref = `/api/p-files/drill/${target}?${csvParams.toString()}`;

  return (
    <DrillDownSheet<PFilesDrillRow>
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
