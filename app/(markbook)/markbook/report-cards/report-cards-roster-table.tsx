'use client';

import { type ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { CalendarClock, CheckCircle2, Clock, Lock } from 'lucide-react';

export type ReportCardsRosterRow = {
  enrolment_id: string;
  index_number: number;
  /** UUID from `public.students.id` — used for the report-card deep-link. */
  student_id: string;
  /** Stable cross-year identifier per Hard Rule #4. */
  student_number: string;
  name: string;
  withdrawn: boolean;
  /** Derived from the section's publication-windows array. */
  publication_status: 'published' | 'scheduled' | 'closed' | 'none';
};

type PublicationStatus = ReportCardsRosterRow['publication_status'];

function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  switch (status) {
    case 'published':
      return (
        <StatusBadge tone="healthy" icon={CheckCircle2}>
          Published
        </StatusBadge>
      );
    case 'scheduled':
      return (
        <StatusBadge tone="warning" icon={CalendarClock}>
          Scheduled
        </StatusBadge>
      );
    case 'closed':
      return (
        <StatusBadge tone="locked" icon={Lock}>
          Closed
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge tone="muted" icon={Clock}>
          Awaiting publication
        </StatusBadge>
      );
  }
}

const COLUMNS: ColumnDef<ReportCardsRosterRow>[] = [
  {
    accessorKey: 'index_number',
    header: ({ column }) => <SortableHeader column={column}>#</SortableHeader>,
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
        {row.original.index_number}
      </span>
    ),
  },
  {
    accessorKey: 'student_number',
    header: 'Student number',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.student_number || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    cell: ({ row }) => {
      if (row.original.withdrawn) {
        return (
          <span className="font-medium line-through text-muted-foreground">
            {row.original.name}
          </span>
        );
      }
      return (
        <IdentifierLink
          href={`/markbook/report-cards/${row.original.student_id}`}
        >
          {row.original.name}
        </IdentifierLink>
      );
    },
  },
  {
    accessorKey: 'publication_status',
    header: 'Publication',
    cell: ({ row }) => (
      <PublicationStatusBadge status={row.original.publication_status} />
    ),
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
];

const STATUS_TABS: StatusTabConfig<ReportCardsRosterRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'published',
    label: 'Published',
    predicate: (r) => r.publication_status === 'published',
  },
  {
    value: 'awaiting',
    label: 'Awaiting publication',
    predicate: (r) =>
      r.publication_status === 'none' || r.publication_status === 'scheduled',
  },
  {
    value: 'closed',
    label: 'Closed',
    predicate: (r) => r.publication_status === 'closed',
  },
];

export function ReportCardsRosterTable({
  data,
}: {
  data: ReportCardsRosterRow[];
}) {
  return (
    <DataTable<ReportCardsRosterRow>
      data={data}
      columns={COLUMNS}
      getRowId={(row) => row.enrolment_id}
      searchKeys={['name', 'student_number']}
      searchPlaceholder="Search name or student number…"
      statusTabs={STATUS_TABS}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'rcroster' }}
      initialSort={[{ id: 'index_number', desc: false }]}
      hidePagination
      emptyState={{ title: 'No students enrolled.' }}
      emptyFilteredState={{ title: 'No students match the current filter.' }}
    />
  );
}
