'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';

import {
  DrillDownSheet,
  type DrillDownDensity,
  type DrillDownGroupBy,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ALL_DRILL_COLUMNS,
  DRILL_COLUMN_LABELS,
  defaultColumnsForTarget,
  drillHeaderForTarget,
  type DrillColumnKey,
  type RecordsDrillRow,
  type RecordsDrillTarget,
} from '@/lib/sis/drill';
import { compareLevelLabels } from '@/lib/sis/levels';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// Stable empty reference so `rows` keeps a steady identity while loading.
const EMPTY_ROWS: RecordsDrillRow[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Props

export type RecordsDrillSheetProps = {
  target: RecordsDrillTarget;
  segment?: string | null;
  ayCode: string;
  /** When set, these clamp the dataset to the page-level date range. */
  initialFrom?: string;
  initialTo?: string;
  /** Pre-fetched rows — when provided, the drill renders immediately without
   *  a network call. Used by the page (Server Component) to avoid loading
   *  spinners on first open. */
  initialRows?: RecordsDrillRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Cell badges

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

type StaleTier = 'unknown' | 'green' | 'amber' | 'red';

function tierFor(days: number | null): StaleTier {
  if (days === null) return 'unknown';
  if (days >= 14) return 'red';
  if (days >= 7) return 'amber';
  return 'green';
}

function StalenessBadge({ days }: { days: number | null }) {
  const tier = tierFor(days);
  if (tier === 'unknown') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3`}
      >
        <HelpCircle className="h-3 w-3" aria-hidden />
        Never updated
      </Badge>
    );
  }
  if (tier === 'red') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {days}d overdue
      </Badge>
    );
  }
  if (tier === 'amber') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-chart-4/50 bg-gradient-to-b from-chart-4/20 to-chart-4/5 text-ink`}
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        {days}d ago
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`${BADGE_BASE} border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink`}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Up to date · {days}d
    </Badge>
  );
}

function EnrollmentBadge({ enrollmentStatus }: { enrollmentStatus: string }) {
  const v = enrollmentStatus.toLowerCase();
  if (v === 'active' || v === 'conditional') {
    return <Badge variant="success">{enrollmentStatus}</Badge>;
  }
  if (v === 'withdrawn') {
    return <Badge variant="blocked">Withdrawn</Badge>;
  }
  return <Badge variant="muted">{enrollmentStatus || '—'}</Badge>;
}

function StageBadge({ stage }: { stage: string }) {
  return <Badge variant="muted">{stage || '—'}</Badge>;
}

function DocsCell({ complete, total }: { complete: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((complete / total) * 100);
  let badge: React.ReactNode;
  if (total > 0 && complete === total) {
    badge = (
      <Badge variant="success">
        {complete}/{total}
      </Badge>
    );
  } else if (complete === 0) {
    badge = <Badge variant="blocked">0/{total}</Badge>;
  } else {
    badge = (
      <Badge variant="muted">
        {complete}/{total}
      </Badge>
    );
  }
  const fillClass =
    complete === total && total > 0
      ? 'bg-brand-mint'
      : complete === 0
        ? 'bg-destructive/60'
        : 'bg-chart-4';
  return (
    <div className="flex flex-col gap-1">
      {badge}
      <div className="h-px w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${fillClass}`}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

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

// compareLevelLabels from lib/sis/levels.ts is the canonical ordering
// (P1-P6 → S1-S4). Using it here instead of a locally-hardcoded list
// prevents ordering drift when levels change.
function compareLevels(a: string, b: string): number {
  return compareLevelLabels(
    a === 'Unknown' ? null : a,
    b === 'Unknown' ? null : b
  );
}

function buildDrillUrl(
  target: RecordsDrillTarget,
  ayCode: string,
  from: string | undefined,
  to: string | undefined,
  segment: string | null | undefined,
  format: 'json' | 'csv',
  visibleColumnKeys?: string[]
): string {
  const params = new URLSearchParams();
  params.set('ay', ayCode);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (segment) params.set('segment', segment);
  if (format === 'csv') {
    params.set('format', 'csv');
    if (visibleColumnKeys && visibleColumnKeys.length > 0) {
      params.set('columns', visibleColumnKeys.join(','));
    }
  }
  return `/api/records/drill/${target}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column factory

function buildColumnDef(
  key: DrillColumnKey
): ColumnDef<RecordsDrillRow, unknown> {
  const header = DRILL_COLUMN_LABELS[key];
  switch (key) {
    case 'fullName':
      return {
        id: 'fullName',
        accessorKey: 'fullName',
        header,
        cell: ({ row }) => {
          // KD #81: unsynced rows (sectionId===null) route to the assign-section
          // queue; synced rows use KD #4's studentNumber-stable URL with the
          // enroleeNumber fallback for pre-sync states.
          const href =
            row.original.sectionId === null
              ? `/records/unsynced`
              : row.original.studentNumber
                ? `/records/students/${encodeURIComponent(row.original.studentNumber)}`
                : `/records/students/by-enrolee/${encodeURIComponent(row.original.enroleeNumber)}`;
          return (
            <div className="space-y-0.5">
              <Link
                href={href}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.fullName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.enroleeNumber}
              </div>
            </div>
          );
        },
        enableSorting: true,
      };
    case 'studentNumber':
      return {
        id: 'studentNumber',
        accessorKey: 'studentNumber',
        header,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.studentNumber ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'enroleeNumber':
      return {
        id: 'enroleeNumber',
        accessorKey: 'enroleeNumber',
        header,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.enroleeNumber}
          </span>
        ),
        enableSorting: true,
      };
    case 'enrollmentStatus':
      return {
        id: 'enrollmentStatus',
        accessorKey: 'enrollmentStatus',
        header,
        cell: ({ row }) => (
          <EnrollmentBadge enrollmentStatus={row.original.enrollmentStatus} />
        ),
        enableSorting: true,
      };
    case 'applicationStatus':
      return {
        id: 'applicationStatus',
        accessorKey: 'applicationStatus',
        header,
        cell: ({ row }) => (
          <ApplicationStatusBadge status={row.original.applicationStatus} />
        ),
        enableSorting: true,
      };
    case 'level':
      return {
        id: 'level',
        accessorKey: 'level',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.level ?? '—'}
          </span>
        ),
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.level ?? 'Unknown';
          const bv = b.original.level ?? 'Unknown';
          return compareLevels(av, bv);
        },
      };
    case 'sectionName':
      return {
        id: 'sectionName',
        accessorKey: 'sectionName',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sectionName ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'pipelineStage':
      return {
        id: 'pipelineStage',
        accessorKey: 'pipelineStage',
        header,
        cell: ({ row }) => <StageBadge stage={row.original.pipelineStage} />,
        enableSorting: true,
      };
    case 'applicationDate':
      return {
        id: 'applicationDate',
        accessorKey: 'applicationDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.applicationDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'enrollmentDate':
      return {
        id: 'enrollmentDate',
        accessorKey: 'enrollmentDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.enrollmentDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'withdrawalDate':
      return {
        id: 'withdrawalDate',
        accessorKey: 'withdrawalDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.withdrawalDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'daysSinceUpdate':
      return {
        id: 'daysSinceUpdate',
        accessorKey: 'daysSinceUpdate',
        header,
        cell: ({ row }) => (
          <div className="tabular-nums">
            <StalenessBadge days={row.original.daysSinceUpdate} />
          </div>
        ),
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.daysSinceUpdate;
          const bv = b.original.daysSinceUpdate;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv;
        },
      };
    case 'documentsComplete':
      return {
        id: 'documentsComplete',
        accessorKey: 'documentsComplete',
        header,
        cell: ({ row }) => (
          <DocsCell
            complete={row.original.documentsComplete}
            total={row.original.documentsTotal}
          />
        ),
        enableSorting: true,
      };
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = key;
      throw new Error(`unreachable column key: ${String(_exhaustive)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The wrapper

export function RecordsDrillSheet({
  target,
  segment,
  ayCode,
  initialFrom,
  initialTo,
  initialRows,
}: RecordsDrillSheetProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>('none');
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    DrillColumnKey[]
  >(() => defaultColumnsForTarget(target));

  // ── Fetch on range change ────────────────────────────────────────────────
  // Read via TanStack Query. When the parent hydrated us with initialRows the
  // drill renders instantly and the first fetch is skipped (matching the
  // original `skipNextFetchRef = initialRows !== undefined` guard); otherwise
  // it fetches on open + shows the skeleton. The queryFn forwards the abort
  // signal so a fast close/reopen aborts the stale request.
  const drillQuery = useQuery({
    queryKey: queryKeys.sisRecordsDrill(target, {
      ay: ayCode,
      from: initialFrom ?? null,
      to: initialTo ?? null,
      segment: segment ?? null,
    }),
    queryFn: async ({ signal }) => {
      const url = buildDrillUrl(
        target,
        ayCode,
        initialFrom,
        initialTo,
        segment,
        'json'
      );
      const json = await apiFetch<{ rows?: RecordsDrillRow[] }>(url, {
        credentials: 'include',
        signal,
      });
      return Array.isArray(json.rows) ? json.rows : [];
    },
    // The seed is the broad, un-narrowed row set — per-(target,segment)
    // narrowing happens server-side in the drill route (KD #82). So it's a
    // placeholder for instant paint, not authoritative: placeholderData paints
    // it immediately while the query STILL fetches the narrowed rows and
    // replaces it.
    placeholderData: initialRows,
  });

  const rows = drillQuery.data ?? EMPTY_ROWS;

  // ── Pre-filter rows by status + level ───────────────────────────────────
  const preFiltered = React.useMemo<RecordsDrillRow[]>(() => {
    if (selectedStatuses.length === 0 && selectedLevels.length === 0)
      return rows;
    const statusSet = new Set(selectedStatuses);
    const levelSet = new Set(selectedLevels);
    return rows.filter((r) => {
      if (selectedStatuses.length > 0 && !statusSet.has(r.enrollmentStatus))
        return false;
      if (selectedLevels.length > 0 && !levelSet.has(r.level ?? 'Unknown'))
        return false;
      return true;
    });
  }, [rows, selectedStatuses, selectedLevels]);

  // ── Filter options derived from the *fetched* row set ────────────────────
  const statusOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.enrollmentStatus) set.add(r.enrollmentStatus);
    return Array.from(set).sort();
  }, [rows]);

  const levelOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.level ?? 'Unknown');
    return Array.from(set).sort(compareLevels);
  }, [rows]);

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = React.useMemo<ColumnDef<RecordsDrillRow, unknown>[]>(
    () => ALL_DRILL_COLUMNS.map(buildColumnDef),
    []
  );

  const columnOptions = React.useMemo(
    () =>
      ALL_DRILL_COLUMNS.map((k) => ({
        key: k,
        label: DRILL_COLUMN_LABELS[k],
      })),
    []
  );

  // ── Group accessor ───────────────────────────────────────────────────────
  const groupAccessor = React.useCallback(
    (row: RecordsDrillRow): string | null => {
      switch (groupBy) {
        case 'level':
          return row.level ?? 'Unknown';
        case 'status':
          return row.enrollmentStatus;
        case 'stage':
          return row.pipelineStage;
        default:
          return null;
      }
    },
    [groupBy]
  );

  // ── Header + CSV ────────────────────────────────────────────────────────
  const heading = drillHeaderForTarget(target, segment ?? null);

  // Show a skeleton on first load (parent didn't hydrate via initialRows).
  if (drillQuery.isLoading && rows.length === 0) {
    return <DrillSheetSkeleton title={heading.title} />;
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
            Couldn’t load {heading.title.toLowerCase()}
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

  const csvHref = buildDrillUrl(
    target,
    ayCode,
    initialFrom,
    initialTo,
    segment,
    'csv',
    visibleColumnKeys
  );

  return (
    <DrillDownSheet<RecordsDrillRow>
      title={heading.title}
      eyebrow={heading.eyebrow}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={preFiltered}
      // Toolkit
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
