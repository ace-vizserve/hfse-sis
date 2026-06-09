'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { OutdatedRow } from '@/lib/admissions/dashboard';

// ─── Staleness helpers ────────────────────────────────────────────────────────

type StaleTier = 'unknown' | 'green' | 'amber' | 'red';

function tierFor(days: number | null): StaleTier {
  if (days === null) return 'unknown';
  if (days >= 14) return 'red';
  if (days >= 7) return 'amber';
  return 'green';
}

// Lightweight RAG indicator for the "In pipeline" column.
function PipelineAgeCell({ days }: { days: number }) {
  const tier = tierFor(days);
  const dotClass =
    tier === 'red'
      ? 'bg-destructive'
      : tier === 'amber'
        ? 'bg-chart-4'
        : 'bg-brand-mint';
  const textClass =
    tier === 'red'
      ? 'text-destructive'
      : tier === 'amber'
        ? 'text-ink'
        : 'text-ink-3';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span className={`text-sm font-medium tabular-nums ${textClass}`}>
        {days}d
      </span>
    </span>
  );
}

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

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
        className={`${BADGE_BASE} border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive`}
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

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// ─── Status tabs (tier tabs) ───────────────────────────────────────────────────

type StaleTierFilter = 'all' | 'red' | 'amber' | 'unknown';

const STATUS_TABS = [
  {
    value: 'all' as StaleTierFilter,
    label: 'All',
    isDefault: true,
    predicate: (_row: OutdatedRow) => true,
  },
  {
    value: 'red' as StaleTierFilter,
    label: 'Critical',
    isDefault: false,
    predicate: (row: OutdatedRow) => tierFor(row.daysSinceUpdate) === 'red',
  },
  {
    value: 'amber' as StaleTierFilter,
    label: 'Warning',
    isDefault: false,
    predicate: (row: OutdatedRow) => tierFor(row.daysSinceUpdate) === 'amber',
  },
  {
    value: 'unknown' as StaleTierFilter,
    label: 'Never updated',
    isDefault: false,
    predicate: (row: OutdatedRow) => tierFor(row.daysSinceUpdate) === 'unknown',
  },
];

// ─── Facets ───────────────────────────────────────────────────────────────────

const FACETS: FacetConfig[] = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'status', label: 'Application status' },
];

// ─── Columns ─────────────────────────────────────────────────────────────────

function buildColumns(ayCode?: string): ColumnDef<OutdatedRow>[] {
  return [
    {
      accessorKey: 'fullName',
      header: ({ column }) => (
        <SortableHeader column={column}>Applicant</SortableHeader>
      ),
      cell: ({ row }) => {
        const href = ayCode
          ? `/admissions/applications/${row.original.enroleeNumber}?ay=${ayCode}`
          : `/admissions/applications/${row.original.enroleeNumber}`;
        return (
          <div className="space-y-0.5">
            <IdentifierLink href={href}>{row.original.fullName}</IdentifierLink>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.enroleeNumber}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'studentNumber',
      header: 'Student no.',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.studentNumber ?? '—'}
        </span>
      ),
      enableHiding: true,
    },
    {
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      filterFn: (row, id, value) => {
        const v = row.getValue<string | null>(id) ?? '—';
        if (Array.isArray(value)) {
          return value.length === 0 || value.includes(v);
        }
        return !value || value === v;
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      cell: ({ row }) => (
        <ApplicationStatusBadge status={row.original.status} />
      ),
      filterFn: (row, id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        const v = row.getValue<string>(id);
        return Array.isArray(value) ? value.includes(v) : value === v;
      },
    },
    {
      id: 'tier',
      accessorFn: (row) => tierFor(row.daysSinceUpdate),
      header: ({ column }) => (
        <SortableHeader column={column}>Staleness</SortableHeader>
      ),
      cell: ({ row }) => <StalenessBadge days={row.original.daysSinceUpdate} />,
      sortingFn: (a, b) => {
        const av = a.original.daysSinceUpdate;
        const bv = b.original.daysSinceUpdate;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      },
    },
    {
      accessorKey: 'lastUpdated',
      header: 'Last updated',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDate(row.original.lastUpdated)}
        </span>
      ),
    },
    {
      accessorKey: 'daysInPipeline',
      header: ({ column }) => (
        <SortableHeader column={column}>In pipeline</SortableHeader>
      ),
      cell: ({ row }) => <PipelineAgeCell days={row.original.daysInPipeline} />,
    },
    {
      accessorKey: 'motherEmail',
      header: 'Mother email',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.motherEmail ?? '—'}
        </span>
      ),
      enableHiding: true,
    },
    {
      accessorKey: 'fatherEmail',
      header: 'Father email',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.fatherEmail ?? '—'}
        </span>
      ),
      enableHiding: true,
    },
  ];
}

// These are hidden by default; users can reveal via the Columns toggle.
const INITIAL_COLUMN_VISIBILITY = {
  studentNumber: false,
  motherEmail: false,
  fatherEmail: false,
};

// ─── Empty state ──────────────────────────────────────────────────────────────

const EMPTY_STATE = (
  <Card className="items-center py-12 text-center">
    <div className="flex flex-col items-center gap-3">
      <CheckCircle2 className="size-6 text-chart-5" />
      <p className="font-serif text-lg font-semibold text-foreground">
        Nothing stale.
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        Every active application has been touched recently. Keep the momentum
        going.
      </p>
    </div>
  </Card>
);

// ─── Component ────────────────────────────────────────────────────────────────

export function OutdatedApplicationsTable({
  rows,
  ayCode,
}: {
  rows: OutdatedRow[];
  ayCode?: string;
}) {
  const columns = React.useMemo(() => buildColumns(ayCode), [ayCode]);

  if (rows.length === 0) {
    return EMPTY_STATE;
  }

  return (
    <div className="space-y-4">
      {/* Staleness legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-background px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Staleness
        </span>
        <ChartLegendChip color="fresh" label="Fresh · < 7 days" />
        <ChartLegendChip color="stale" label="Warning · 7–13 days" />
        <ChartLegendChip color="very-stale" label="Critical · ≥ 14 days" />
        <ChartLegendChip color="chart-4" label="Never updated" />
      </div>

      <DataTable<OutdatedRow>
        data={rows}
        columns={columns}
        getRowId={(row) => row.enroleeNumber}
        searchKeys={['fullName', 'enroleeNumber', 'levelApplied', 'status']}
        searchPlaceholder="Search applicant, enrolee #, level, status…"
        facets={FACETS}
        statusTabs={STATUS_TABS}
        // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
        url={{ enabled: true, namespace: 'outdated' }}
        initialSort={[{ id: 'tier', desc: true }]}
        initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
        pageSize={25}
        csv={{
          filename: ayCode
            ? `outdated-applications-${ayCode}.csv`
            : 'outdated-applications.csv',
        }}
        emptyState={{
          title: 'Nothing stale.',
          body: 'Every active application has been touched recently.',
        }}
        emptyFilteredState={{
          title: 'No applications match the current filters.',
          body: 'Try clearing the search or filters.',
        }}
      />
    </div>
  );
}
