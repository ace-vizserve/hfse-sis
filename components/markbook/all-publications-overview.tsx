'use client';

import * as React from 'react';
import { FileText, Users } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  type FacetConfig,
  type StatusTabConfig,
} from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { StatusBadge } from '@/components/ui/status-badge';

// Cross-section view of every publication window in the current AY.
// Renders on /markbook/report-cards when no section is picked, so registrars
// land on a "what's published right now" snapshot instead of an empty state.
//
// Per row = one (section × term) publication window. Status (active /
// scheduled / expired / revoked) is computed at request time. Section name
// links into that section's existing roster view.

export type PublicationOverviewRow = {
  id: string;
  section_id: string;
  section_name: string;
  level_label: string;
  level_code: string;
  term_id: string;
  term_number: number;
  term_label: string;
  publish_from: string;
  publish_until: string;
  status: 'active' | 'scheduled' | 'expired' | 'revoked';
  student_count: number;
  notified_at?: string | null;
  published_by?: string | null;
};

const DATE_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', DATE_FMT);
}

function PublicationStatusBadge({
  status,
}: {
  status: PublicationOverviewRow['status'];
}) {
  switch (status) {
    case 'active':
      return <StatusBadge tone="healthy">Active</StatusBadge>;
    case 'scheduled':
      return <StatusBadge tone="info">Scheduled</StatusBadge>;
    case 'revoked':
      return <StatusBadge tone="locked">Revoked</StatusBadge>;
    default:
      return <StatusBadge tone="muted">Expired</StatusBadge>;
  }
}

const COLUMNS: ColumnDef<PublicationOverviewRow>[] = [
  {
    accessorKey: 'level_code',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    meta: { label: 'Level' },
    cell: ({ row }) => (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {row.original.level_code}
      </span>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'section_name',
    header: ({ column }) => (
      <SortableHeader column={column}>Section</SortableHeader>
    ),
    meta: { label: 'Section' },
    cell: ({ row }) => (
      <IdentifierLink
        href={`/markbook/report-cards?section_id=${row.original.section_id}`}
      >
        {row.original.section_name}
      </IdentifierLink>
    ),
  },
  {
    accessorKey: 'term_label',
    header: 'Term',
    cell: ({ row }) => (
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          T{row.original.term_number}
        </span>
        <span className="text-[13px] text-foreground">
          {row.original.term_label}
        </span>
      </div>
    ),
  },
  {
    id: 'window',
    header: 'Window',
    cell: ({ row }) => (
      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatDate(row.original.publish_from)} –{' '}
        {formatDate(row.original.publish_until)}
      </span>
    ),
    enableSorting: false,
  },
  {
    // Distinct id from the reserved `<ns>.status` status-tab key (KD #84
    // collision) — the term-based status tabs own that param; this facet uses
    // its own id while keeping accessorKey 'status'.
    id: 'pub_status',
    accessorKey: 'status',
    header: ({ column }) => (
      <SortableHeader column={column}>Status</SortableHeader>
    ),
    meta: { label: 'Status' },
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <PublicationStatusBadge status={row.original.status} />
        {row.original.notified_at && (
          <span className="font-mono text-[9px] text-muted-foreground">
            Notified {formatDate(row.original.notified_at)}
          </span>
        )}
      </div>
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'student_count',
    header: ({ column }) => (
      <SortableHeader column={column}>Students</SortableHeader>
    ),
    meta: { label: 'Students' },
    cell: ({ row }) => (
      <span className="text-right font-mono tabular-nums">
        {row.original.student_count}
      </span>
    ),
  },
  {
    accessorKey: 'published_by',
    header: 'Published by',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.published_by ?? '—'}
      </span>
    ),
  },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const { section_id } = row.original;
      // section_id is always present on a valid publication row, but guard defensively.
      if (!section_id) return null;
      return (
        <RowActionsMenu>
          <DropdownMenuItem asChild>
            <Link href={`/markbook/sections/${section_id}`}>
              <Users className="size-3.5" />
              Open roster
            </Link>
          </DropdownMenuItem>
        </RowActionsMenu>
      );
    },
  },
];

const FACETS: FacetConfig[] = [
  { columnId: 'level_code', label: 'Level' },
  {
    columnId: 'pub_status',
    label: 'Status',
    valueOptions: ['active', 'scheduled', 'expired', 'revoked'],
  },
];

export function AllPublicationsOverview({
  publications,
  currentTermId,
}: {
  publications: PublicationOverviewRow[];
  /** When set + the table is on the "Current term" tab (default), only
   *  rows for that term render. Setting null disables the filter. */
  currentTermId?: string | null;
}) {
  if (publications.length === 0) {
    return (
      <Card className="items-center py-16 text-center">
        <CardContent className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileText className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="font-serif text-xl font-semibold text-foreground">
              No publication windows yet
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Pick a section above and open a publication window to make report
              cards visible to parents. Active windows will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Current term count for tab labels
  const currentTermCount = currentTermId
    ? publications.filter((p) => p.term_id === currentTermId).length
    : 0;
  const allTermsCount = publications.length;

  const statusTabs: StatusTabConfig<PublicationOverviewRow>[] = currentTermId
    ? [
        {
          value: 'current',
          label: 'Current term',
          predicate: (r) => r.term_id === currentTermId,
          isDefault: true,
          countOverride: () => currentTermCount,
        },
        {
          value: 'all',
          label: 'All terms',
          predicate: () => true,
          countOverride: () => allTermsCount,
        },
      ]
    : [];

  return (
    <DataTable<PublicationOverviewRow>
      data={publications}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      searchKeys={['section_name', 'level_code', 'term_label']}
      searchPlaceholder="Search section, level, term…"
      facets={FACETS}
      statusTabs={statusTabs.length > 0 ? statusTabs : undefined}
      initialSort={[
        { id: 'pub_status', desc: false },
        { id: 'level_code', desc: false },
        { id: 'section_name', desc: false },
      ]}
      initialColumnVisibility={{ published_by: false }}
      pageSize={25}
      csv={{ filename: 'publications.csv' }}
      url={{ enabled: true, namespace: 'publications' }}
      emptyState={{
        icon: FileText,
        title: 'No publication windows yet.',
        body: 'Pick a section above and open a publication window to make report cards visible to parents.',
        cta: { label: 'Configure', href: '/markbook/report-cards' },
      }}
      emptyFilteredState={{
        title: 'No windows match the current filters.',
        body: 'Try switching to All terms or clearing the filters.',
      }}
    />
  );
}
