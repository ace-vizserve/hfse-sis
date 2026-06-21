'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type {
  FacetConfig,
  StatusTabConfig,
} from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { PFileValidationRow } from '@/lib/p-files/document-validation';
import { cn } from '@/lib/utils';

type Props = {
  rows: PFileValidationRow[];
};

function expiryTone(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days <= 0) return 'text-destructive font-medium';
  if (days <= 30) return 'text-destructive';
  if (days <= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function ExpiringQueue({ rows }: Props) {
  // Active window filter: ≤30 | ≤60 | ≤90
  const [window, setWindow] = React.useState<30 | 60 | 90>(90);

  const filtered = React.useMemo(
    () => rows.filter((r) => (r.daysUntilExpiry ?? 9999) <= window),
    [rows, window]
  );

  const rowKey = React.useCallback(
    (r: PFileValidationRow) => `${r.enroleeNumber}::${r.slotKey}`,
    []
  );

  const columns = React.useMemo<ColumnDef<PFileValidationRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <IdentifierLink
              href={`/p-files/${encodeURIComponent(row.original.enroleeNumber)}`}
            >
              {row.original.fullName}
            </IdentifierLink>
            <div className="font-mono text-[10px] text-muted-foreground">
              {row.original.enroleeNumber}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'slotLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Document</SortableHeader>
        ),
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.slotLabel}</Badge>
        ),
      },
      {
        accessorKey: 'owner',
        header: 'Owner',
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wider"
          >
            {row.original.owner}
          </Badge>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'levelApplied',
        header: ({ column }) => (
          <SortableHeader column={column}>Level</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.levelApplied ?? '—'}
          </span>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'daysUntilExpiry',
        header: ({ column }) => (
          <SortableHeader column={column}>Expires in</SortableHeader>
        ),
        cell: ({ row }) => {
          const days = row.original.daysUntilExpiry;
          const iso = row.original.expiryDateIso;
          const label = iso
            ? new Date(iso).toLocaleDateString('en-SG', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : '—';
          return (
            <div className="space-y-0.5">
              <span
                className={cn(
                  'font-mono text-xs tabular-nums',
                  expiryTone(days)
                )}
              >
                {days !== null ? (days === 0 ? 'Today' : `${days}d`) : '—'}
              </span>
              <div className="font-mono text-[10px] text-muted-foreground">
                {label}
              </div>
            </div>
          );
        },
      },
      {
        id: 'preview',
        header: 'Preview',
        cell: ({ row }) => (
          <a
            href={row.original.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open file
          </a>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`/p-files/${encodeURIComponent(row.original.enroleeNumber)}`}
            >
              View profile
            </Link>
          </Button>
        ),
      },
    ],
    []
  );

  const facets: FacetConfig[] = React.useMemo(
    // Owner is the status-tab dimension (below) — not duplicated as a facet.
    () => [
      { columnId: 'slotLabel', label: 'Document' },
      { columnId: 'levelApplied', label: 'Level' },
    ],
    []
  );

  const statusTabs: StatusTabConfig<PFileValidationRow>[] = React.useMemo(
    () => [
      { value: 'all', label: 'All', predicate: () => true, isDefault: true },
      {
        value: 'student',
        label: 'Student',
        predicate: (r) => r.owner === 'Student',
      },
      {
        value: 'parent',
        label: 'Parent',
        predicate: (r) => r.owner === 'Mother' || r.owner === 'Father',
      },
      {
        value: 'guardian',
        label: 'Guardian',
        predicate: (r) => r.owner === 'Guardian',
      },
    ],
    []
  );

  const windowFilter = (
    <div className="flex items-center gap-1 rounded-lg border border-hairline p-0.5">
      {([30, 60, 90] as const).map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => setWindow(w)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition',
            window === w
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60'
          )}
        >
          ≤{w}d
        </button>
      ))}
    </div>
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      getRowId={rowKey}
      searchKeys={['fullName', 'enroleeNumber', 'slotLabel']}
      searchPlaceholder="Search student or document…"
      facets={facets}
      statusTabs={statusTabs}
      toolbarTrailing={windowFilter}
      // Distinct namespace from the sibling Awaiting queue on this same page so
      // the two tables' filters don't collide in the URL (KD #84).
      url={{ enabled: true, namespace: 'expiring' }}
      initialSort={[{ id: 'daysUntilExpiry', desc: false }]}
      pageSize={25}
    />
  );
}
