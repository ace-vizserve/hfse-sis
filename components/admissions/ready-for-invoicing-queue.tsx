'use client';

import { FilePlus2, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StageStatusBadge } from '@/components/sis/status-badge';
import {
  INVOICE_STAGES,
  INVOICE_STAGE_LABELS,
  type ReadyForInvoicingRow,
} from '@/lib/admissions/ready-for-invoicing';
import { createFromStageHref } from '@/lib/billing/stage-card';

// ──────────────────────────────────────────────────────────────────────────
// List surface at /admissions/ready-for-invoicing — one row per (student,
// stage) ticked Ready for invoicing. Modelled on the "Enrolled, steps still
// open" queue. Rows arrive sorted oldest tick first
// (`compareReadyForInvoicing`), so no initial sort is set.
// ──────────────────────────────────────────────────────────────────────────

const STATUS_TABS: StatusTabConfig<ReadyForInvoicingRow>[] = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  ...INVOICE_STAGES.map((k) => ({
    value: k,
    label: INVOICE_STAGE_LABELS[k],
    predicate: (r: ReadyForInvoicingRow) => r.stage === k,
  })),
];

/** `yyyy-MM-dd` (already a Singapore date) → "21 Oct 2026". */
function formatDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function applicationHref(row: ReadyForInvoicingRow): string {
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?ay=${encodeURIComponent(row.ayCode)}&tab=enrollment`;
}

export function ReadyForInvoicingQueue({
  rows,
  ayCode,
  canInvoice,
}: {
  rows: ReadyForInvoicingRow[];
  ayCode: string;
  /** Same rule as the stage card's Create invoice (`canInvoiceInQbo`). */
  canInvoice: boolean;
}) {
  const columns = React.useMemo<ColumnDef<ReadyForInvoicingRow>[]>(() => {
    const cols: ColumnDef<ReadyForInvoicingRow>[] = [
      {
        accessorKey: 'studentName',
        header: 'Student',
        cell: ({ row }) => (
          <IdentifierLink href={applicationHref(row.original)}>
            {row.original.studentName}
          </IdentifierLink>
        ),
      },
      {
        id: 'studentNumber',
        accessorFn: (r) => r.studentNumber ?? '',
        header: 'Student number',
        cell: ({ row }) =>
          row.original.studentNumber ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {row.original.studentNumber}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">None yet</span>
          ),
      },
      {
        id: 'level',
        accessorFn: (r) => r.level,
        header: 'Level',
        meta: { label: 'Level' },
        cell: ({ row }) => row.original.level ?? '—',
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'applicationStatus',
        accessorFn: (r) => r.applicationStatus ?? '',
        header: 'Application status',
        meta: { label: 'Application status' },
        cell: ({ row }) => (
          <StageStatusBadge status={row.original.applicationStatus} />
        ),
      },
      {
        id: 'stage',
        accessorFn: (r) => INVOICE_STAGE_LABELS[r.stage],
        header: 'Invoice needed',
        meta: { label: 'Invoice needed' },
        cell: ({ row }) => (
          <span className="inline-flex h-6 items-center rounded-md border border-brand-amber/45 bg-brand-amber/10 px-2 text-xs font-medium text-foreground">
            {INVOICE_STAGE_LABELS[row.original.stage]}
          </span>
        ),
      },
      {
        id: 'tickedBy',
        accessorFn: (r) => r.tickedBy ?? '',
        header: 'Ticked by',
        meta: { label: 'Ticked by' },
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate text-sm text-foreground">
            {row.original.tickedBy ?? '—'}
          </span>
        ),
      },
      {
        id: 'tickedOn',
        accessorFn: (r) => r.tickedOn ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Ticked on</SortableHeader>
        ),
        meta: { label: 'Ticked on' },
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-foreground">
            {row.original.tickedOn ? formatDate(row.original.tickedOn) : '—'}
          </span>
        ),
      },
      {
        id: 'remarks',
        accessorFn: (r) => r.remarks ?? '',
        header: 'Remarks',
        meta: { label: 'Remarks' },
        cell: ({ row }) =>
          row.original.remarks ? (
            <span
              className="block max-w-[18rem] truncate text-sm text-muted-foreground"
              title={row.original.remarks}
            >
              {row.original.remarks}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ];
    if (canInvoice) {
      cols.push({
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center justify-end">
              {r.studentNumber ? (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    href={createFromStageHref(r.studentNumber, r.stage, ayCode)}
                  >
                    <FilePlus2 className="size-3.5" />
                    Create invoice
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  No student number yet
                </Button>
              )}
            </div>
          );
        },
      });
    }
    return cols;
  }, [ayCode, canInvoice]);

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => `${r.enroleeNumber}:${r.stage}`}
      searchKeys={[
        (r) => r.studentName,
        (r) => r.enroleeNumber,
        (r) => r.studentNumber ?? '',
        (r) => r.level ?? '',
        (r) => r.tickedBy ?? '',
      ]}
      searchPlaceholder="Search by name, student number, or level…"
      statusTabs={STATUS_TABS}
      facets={[{ columnId: 'level', label: 'Level' }]}
      url={{ enabled: true, namespace: 'ready-invoicing' }}
      emptyState={{
        icon: ReceiptText,
        title: 'Nobody waiting',
        body: `Nobody is waiting to be invoiced for ${ayCode}.`,
      }}
      emptyFilteredState={{
        title: 'No matches',
        body: 'Try another tab or clear the search.',
      }}
    />
  );
}
