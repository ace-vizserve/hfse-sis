'use client';

import { CalendarRange, Tag } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';

import { DiscountCodeRowActions } from '@/components/sis/discount-code-row-actions';
import { CodeChip } from '@/components/ui/code-chip';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  DiscountCodeStatusBadge,
  classifyCodeStatus,
  type DiscountCodeStatus,
} from '@/components/ui/discount-code-status-badge';
import { TABLE_COPY } from '@/lib/copy/data-table';
import { toPlainText } from '@/lib/rich-text';
import type { DiscountCode } from '@/lib/sis/queries';

// ─── Row type (DiscountCode + derived status + selected AY for actions) ────────

export type DiscountCodeRow = DiscountCode & {
  status: DiscountCodeStatus;
  ayCode: string;
  /**
   * `details` with the formatting taken off — one line, for the table.
   *
   * ⚠ IT IS A SECOND FIELD AND NOT AN OVERWRITE. `details` is written in the
   * formatting editor, so the stored value is HTML, and the row is handed
   * whole to `DiscountCodeRowActions` → the edit dialog, whose editor needs
   * that HTML back. Flattening `details` in place would quietly strip a code's
   * formatting the next time somebody opened the dialog and saved.
   */
  detailsPlain: string;
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDate(s: string | null): string {
  if (!s) return '—';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<DiscountCodeRow>[] = [
  {
    id: 'discountCode',
    accessorKey: 'discountCode',
    header: ({ column }) => (
      <SortableHeader column={column}>Code</SortableHeader>
    ),
    meta: { label: 'Code' },
    cell: ({ row }) => <CodeChip>{row.original.discountCode}</CodeChip>,
    enableHiding: false,
  },
  {
    id: 'enroleeType',
    accessorFn: (row) => row.enroleeType ?? '',
    header: 'Type',
    cell: ({ row }) =>
      row.original.enroleeType ? (
        <CodeChip tone="muted">{row.original.enroleeType}</CodeChip>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return value.includes(row.original.enroleeType ?? '');
    },
  },
  {
    id: 'window',
    header: 'Window',
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        <CalendarRange className="size-3" />
        {formatDate(row.original.startDate)} →{' '}
        {formatDate(row.original.endDate)}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'dc_status',
    accessorFn: (row) => row.status,
    header: 'Status',
    cell: ({ row }) => <DiscountCodeStatusBadge status={row.original.status} />,
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      // Capitalise first letter to match filter option labels
      const label =
        row.original.status.charAt(0).toUpperCase() +
        row.original.status.slice(1);
      return value.includes(label);
    },
  },
  {
    id: 'details',
    // STRIPPED, NOT RENDERED — and the accessor is what does it, so the cell,
    // the sort and the CSV column all read the same one-line value. A table
    // row is the wrong home for a bullet list: it would push every other row
    // in the table down to match.
    accessorFn: (row) => row.detailsPlain,
    header: 'Details',
    meta: { label: 'Details' },
    cell: ({ row }) =>
      row.original.detailsPlain ? (
        <span className="max-w-md text-xs leading-relaxed text-foreground">
          {row.original.detailsPlain}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <DiscountCodeRowActions
        ayCode={row.original.ayCode}
        code={row.original}
      />
    ),
  },
];

// ─── Main exported client component ──────────────────────────────────────────

type DiscountCodesDataTableProps = {
  codes: DiscountCode[];
  ayCode: string;
  ayLabel: string;
  toolbarTrailing?: React.ReactNode;
};

export function DiscountCodesDataTable({
  codes,
  ayCode,
  ayLabel,
  toolbarTrailing,
}: DiscountCodesDataTableProps) {
  // Derive status once per row — avoids per-render Date allocations inside
  // cells. `detailsPlain` rides along for the same reason and a stronger one:
  // stripping the formatting means parsing the HTML, which must not happen in
  // an accessor or a cell renderer that runs per row per render.
  const rows: DiscountCodeRow[] = React.useMemo(
    () =>
      codes.map((c) => ({
        ...c,
        status: classifyCodeStatus(c.startDate, c.endDate),
        ayCode,
        detailsPlain: toPlainText(c.details),
      })),
    [codes, ayCode]
  );

  // Unique enroleeType values for the facet dropdown.
  const enroleeTypes = Array.from(
    new Set(
      codes.map((c) => c.enroleeType).filter((t): t is string => Boolean(t))
    )
  ).sort();

  return (
    <DataTable<DiscountCodeRow>
      data={rows}
      columns={columns}
      getRowId={(row) => String(row.id)}
      searchKeys={[
        'discountCode',
        // The plain copy — searching the raw column would match `strong` and
        // miss a phrase split across two formatting tags.
        'detailsPlain',
        (row) => row.enroleeType ?? '',
      ]}
      searchPlaceholder="Search codes, details, or type…"
      statusTabs={[
        {
          value: 'all',
          label: 'All',
          predicate: () => true,
          isDefault: true,
        },
        {
          value: 'active',
          label: 'Active',
          predicate: (r: DiscountCodeRow) => r.status === 'active',
        },
        {
          value: 'scheduled',
          label: 'Scheduled',
          predicate: (r: DiscountCodeRow) => r.status === 'scheduled',
        },
        {
          value: 'expired',
          label: 'Expired',
          predicate: (r: DiscountCodeRow) => r.status === 'expired',
        },
        {
          value: 'inactive',
          label: 'Inactive',
          predicate: (r: DiscountCodeRow) => r.status === 'inactive',
        },
      ]}
      facets={[
        ...(enroleeTypes.length > 0
          ? [
              {
                columnId: 'enroleeType',
                label: 'Type',
                valueOptions: enroleeTypes,
              },
            ]
          : []),
      ]}
      toolbarTrailing={toolbarTrailing}
      // Namespaced so filters/search persist + are shareable; leaves the page's
      // own ?ay= (server-scope) untouched (KD #84).
      url={{ enabled: true, namespace: 'discounts' }}
      initialSort={[{ id: 'discountCode', desc: false }]}
      pageSize={25}
      emptyState={{
        icon: Tag,
        title: 'No discount codes yet.',
        body: TABLE_COPY.discountCodesFooter(ayLabel),
      }}
      emptyFilteredState={{
        title: 'No codes match.',
        body: 'Try clearing filters or adjusting the search.',
      }}
    />
  );
}
