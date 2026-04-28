'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import {
  DrillDownSheet,
  type DrillDownDensity,
} from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Badge } from '@/components/ui/badge';
import {
  ALL_LIFECYCLE_DRILL_COLUMNS,
  defaultColumnsForLifecycleTarget,
  LIFECYCLE_DRILL_COLUMN_LABELS,
  lifecycleDrillHeaderForTarget,
  type LifecycleDrillColumnKey,
  type LifecycleDrillRow,
  type LifecycleDrillTarget,
} from '@/lib/sis/drill';

// ─── Props ──────────────────────────────────────────────────────────────────

export type LifecycleDrillSheetProps = {
  target: LifecycleDrillTarget;
  ayCode: string;
  /** Pre-fetched rows — when provided, the drill renders immediately without
   *  a network call. Subsequent re-renders triggered by target changes will
   *  still hit the API. */
  initialRows?: LifecycleDrillRow[];
};

// ─── Cell badges ────────────────────────────────────────────────────────────

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
        className={`${BADGE_BASE} border-hairline bg-muted text-ink-3`}
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
        className={`${BADGE_BASE} border-destructive/40 bg-destructive/10 text-destructive`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  if (tier === 'amber') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-chart-4/50 bg-chart-4/15 text-ink`}
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`${BADGE_BASE} border-brand-mint bg-brand-mint/30 text-ink`}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Fresh · {days}d
    </Badge>
  );
}

function StatusPill({ value }: { value: string | null | undefined }) {
  return (
    <Badge variant="outline" className={`${BADGE_BASE} border-hairline bg-muted text-ink-3`}>
      {value && value.trim().length > 0 ? value : '—'}
    </Badge>
  );
}

function SlotChips({
  slots,
  color,
}: {
  slots: string[] | undefined;
  color: ChartLegendChipColor;
}) {
  if (!slots || slots.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((s) => (
        <ChartLegendChip key={s} color={color} label={s} />
      ))}
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Level sort ─────────────────────────────────────────────────────────────

const CANONICAL_LEVELS = [
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4',
] as const;
const CANONICAL_LEVEL_INDEX: Record<string, number> = CANONICAL_LEVELS.reduce(
  (acc, lvl, i) => {
    acc[lvl] = i;
    return acc;
  },
  {} as Record<string, number>,
);

function compareLevels(a: string, b: string): number {
  const aIsUnknown = a === 'Unknown';
  const bIsUnknown = b === 'Unknown';
  if (aIsUnknown && bIsUnknown) return 0;
  if (aIsUnknown) return 1;
  if (bIsUnknown) return -1;
  const aIdx = CANONICAL_LEVEL_INDEX[a];
  const bIdx = CANONICAL_LEVEL_INDEX[b];
  const aIsCanon = aIdx !== undefined;
  const bIsCanon = bIdx !== undefined;
  if (aIsCanon && bIsCanon) return aIdx - bIdx;
  if (aIsCanon) return -1;
  if (bIsCanon) return 1;
  return a.localeCompare(b);
}

// ─── Column factory ─────────────────────────────────────────────────────────

function buildColumnDef(
  key: LifecycleDrillColumnKey,
): ColumnDef<LifecycleDrillRow, unknown> {
  const header = LIFECYCLE_DRILL_COLUMN_LABELS[key];
  switch (key) {
    case 'enroleeFullName':
      return {
        id: 'enroleeFullName',
        accessorKey: 'enroleeFullName',
        header,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">
              {row.original.enroleeFullName ?? '—'}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.enroleeNumber}
            </div>
          </div>
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
    case 'levelApplied':
      return {
        id: 'levelApplied',
        accessorKey: 'levelApplied',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.levelApplied ?? '—'}
          </span>
        ),
        enableSorting: true,
        sortingFn: (a, b) =>
          compareLevels(
            a.original.levelApplied ?? 'Unknown',
            b.original.levelApplied ?? 'Unknown',
          ),
      };
    case 'applicationStatus':
      return {
        id: 'applicationStatus',
        accessorKey: 'applicationStatus',
        header,
        cell: ({ row }) => <StatusPill value={row.original.applicationStatus} />,
        enableSorting: true,
      };
    case 'applicationUpdatedDate':
      return {
        id: 'applicationUpdatedDate',
        accessorKey: 'applicationUpdatedDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.applicationUpdatedDate)}
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
    case 'feeStatus':
      return {
        id: 'feeStatus',
        accessorKey: 'feeStatus',
        header,
        cell: ({ row }) => <StatusPill value={row.original.feeStatus} />,
        enableSorting: true,
      };
    case 'feeInvoice':
      return {
        id: 'feeInvoice',
        accessorKey: 'feeInvoice',
        header,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.feeInvoice ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'feePaymentDate':
      return {
        id: 'feePaymentDate',
        accessorKey: 'feePaymentDate',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.feePaymentDate)}
          </span>
        ),
        enableSorting: true,
      };
    case 'documentStatus':
      return {
        id: 'documentStatus',
        accessorKey: 'documentStatus',
        header,
        cell: ({ row }) => <StatusPill value={row.original.documentStatus} />,
        enableSorting: true,
      };
    case 'rejectedSlots':
      return {
        id: 'rejectedSlots',
        accessorKey: 'rejectedSlots',
        header,
        cell: ({ row }) => (
          <SlotChips slots={row.original.rejectedSlots} color="very-stale" />
        ),
        enableSorting: false,
      };
    case 'expiredSlots':
      return {
        id: 'expiredSlots',
        accessorKey: 'expiredSlots',
        header,
        cell: ({ row }) => (
          <SlotChips slots={row.original.expiredSlots} color="stale" />
        ),
        enableSorting: false,
      };
    case 'uploadedSlots':
      return {
        id: 'uploadedSlots',
        accessorKey: 'uploadedSlots',
        header,
        cell: ({ row }) => (
          <SlotChips slots={row.original.uploadedSlots} color="primary" />
        ),
        enableSorting: false,
      };
    case 'promisedSlots':
      return {
        id: 'promisedSlots',
        accessorKey: 'promisedSlots',
        header,
        cell: ({ row }) => (
          <SlotChips slots={row.original.promisedSlots} color="stale" />
        ),
        enableSorting: false,
      };
    case 'assessmentStatus':
      return {
        id: 'assessmentStatus',
        accessorKey: 'assessmentStatus',
        header,
        cell: ({ row }) => <StatusPill value={row.original.assessmentStatus} />,
        enableSorting: true,
      };
    case 'assessmentSchedule':
      return {
        id: 'assessmentSchedule',
        accessorKey: 'assessmentSchedule',
        header,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDate(row.original.assessmentSchedule)}
          </span>
        ),
        enableSorting: true,
      };
    case 'contractStatus':
      return {
        id: 'contractStatus',
        accessorKey: 'contractStatus',
        header,
        cell: ({ row }) => <StatusPill value={row.original.contractStatus} />,
        enableSorting: true,
      };
    case 'classSection':
      return {
        id: 'classSection',
        accessorKey: 'classSection',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.classSection ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    default: {
      const _exhaustive: never = key;
      throw new Error(`unreachable column key: ${String(_exhaustive)}`);
    }
  }
}

// ─── Wrapper ────────────────────────────────────────────────────────────────

function buildDrillUrl(
  target: LifecycleDrillTarget,
  ayCode: string,
  format: 'json' | 'csv',
  visibleColumnKeys?: string[],
): string {
  const params = new URLSearchParams();
  params.set('ay', ayCode);
  if (format === 'csv') {
    params.set('format', 'csv');
    if (visibleColumnKeys && visibleColumnKeys.length > 0) {
      params.set('columns', visibleColumnKeys.join(','));
    }
  }
  return `/api/sis/drill/${target}?${params.toString()}`;
}

export function LifecycleDrillSheet({
  target,
  ayCode,
  initialRows,
}: LifecycleDrillSheetProps) {
  const [rows, setRows] = React.useState<LifecycleDrillRow[]>(initialRows ?? []);
  const [loading, setLoading] = React.useState<boolean>(initialRows === undefined);
  const [selectedLevels, setSelectedLevels] = React.useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>([]);
  const [density, setDensity] = React.useState<DrillDownDensity>('comfortable');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<
    LifecycleDrillColumnKey[]
  >(() => defaultColumnsForLifecycleTarget(target));

  // Reset visible columns when target changes (defaults differ per bucket).
  React.useEffect(() => {
    setVisibleColumnKeys(defaultColumnsForLifecycleTarget(target));
  }, [target]);

  const skipNextFetchRef = React.useRef<boolean>(initialRows !== undefined);

  React.useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const url = buildDrillUrl(target, ayCode, 'json');
    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { rows?: LifecycleDrillRow[] };
        if (cancelled) return;
        setRows(Array.isArray(json.rows) ? json.rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load drill data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, ayCode]);

  // Pre-filter by status + level (universal toolkit).
  const preFiltered = React.useMemo<LifecycleDrillRow[]>(() => {
    if (selectedLevels.length === 0 && selectedStatuses.length === 0) return rows;
    const levelSet = new Set(selectedLevels);
    const statusSet = new Set(selectedStatuses);
    return rows.filter((r) => {
      if (selectedLevels.length > 0 && !levelSet.has(r.levelApplied ?? 'Unknown')) {
        return false;
      }
      if (
        selectedStatuses.length > 0 &&
        !statusSet.has((r.applicationStatus ?? '').trim() || 'Unknown')
      ) {
        return false;
      }
      return true;
    });
  }, [rows, selectedLevels, selectedStatuses]);

  const levelOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.levelApplied ?? 'Unknown');
    return Array.from(set).sort(compareLevels);
  }, [rows]);

  const statusOptions = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r.applicationStatus ?? '').trim();
      set.add(v || 'Unknown');
    }
    return Array.from(set).sort();
  }, [rows]);

  const columns = React.useMemo<ColumnDef<LifecycleDrillRow, unknown>[]>(
    () => ALL_LIFECYCLE_DRILL_COLUMNS.map(buildColumnDef),
    [],
  );

  const columnOptions = React.useMemo(
    () =>
      ALL_LIFECYCLE_DRILL_COLUMNS.map((k) => ({
        key: k,
        label: LIFECYCLE_DRILL_COLUMN_LABELS[k],
      })),
    [],
  );

  const heading = lifecycleDrillHeaderForTarget(target);

  if (loading && rows.length === 0) {
    return <DrillSheetSkeleton title={heading.title} />;
  }

  const csvHref = buildDrillUrl(target, ayCode, 'csv', visibleColumnKeys);

  return (
    <DrillDownSheet<LifecycleDrillRow>
      title={heading.title}
      eyebrow={heading.eyebrow}
      count={preFiltered.length}
      csvHref={csvHref}
      columns={columns}
      rows={preFiltered}
      // Toolkit — no scope toggle (lifecycle is always current AY).
      statusOptions={statusOptions}
      selectedStatuses={selectedStatuses}
      onStatusesChange={setSelectedStatuses}
      levelOptions={levelOptions}
      selectedLevels={selectedLevels}
      onLevelsChange={setSelectedLevels}
      showGroupBy={false}
      density={density}
      onDensityChange={setDensity}
      columnOptions={columnOptions}
      visibleColumnKeys={visibleColumnKeys}
      onColumnsChange={(next) =>
        setVisibleColumnKeys(next as LifecycleDrillColumnKey[])
      }
    />
  );
}
