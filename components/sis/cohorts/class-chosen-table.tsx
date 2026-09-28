'use client';

import { CheckCircle2, Hourglass } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ClassChosenRow } from '@/lib/admissions/class-chosen';
import { ENROLLED_PREREQ_STAGES } from '@/lib/schemas/sis';

// The table for /admissions/cohorts/class-chosen — children whose class is
// chosen but whose application is not Enrolled yet. Rows arrive pre-sorted
// from the loader (ready to enrol first, then the longest-waiting class
// choice), so no `initialSort`: the server's order IS the working order.

function detailHref(row: ClassChosenRow): string {
  // The Enrollment tab holds the stage tiles — the Application status is
  // changed there, which is the job this list sends people to finish.
  const params = new URLSearchParams({ ay: row.ayCode, tab: 'enrollment' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

function chosenClassLabel(row: ClassChosenRow): string {
  return [row.classLevel, row.classSection].filter(Boolean).join(' · ');
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The name before the @ — the column is narrow, and every SIS writer is
 *  staff on the school domain. The full address stays in the tooltip. */
function shortActor(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

const COLUMNS: ColumnDef<ClassChosenRow>[] = [
  {
    id: 'student',
    accessorFn: (r) => r.fullName,
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => (
      <IdentifierLink href={detailHref(row.original)}>
        {row.original.fullName}
      </IdentifierLink>
    ),
    enableSorting: true,
  },
  {
    id: 'enroleeNumber',
    accessorKey: 'enroleeNumber',
    header: 'Enrolee number',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.enroleeNumber}
      </span>
    ),
  },
  {
    id: 'ayCode',
    accessorKey: 'ayCode',
    header: 'Year',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-foreground">
        {row.original.ayCode}
      </span>
    ),
  },
  {
    id: 'chosenClass',
    accessorFn: chosenClassLabel,
    header: ({ column }) => (
      <SortableHeader column={column}>Chosen class</SortableHeader>
    ),
    meta: { label: 'Chosen class' },
    cell: ({ row }) => (
      <span className="text-sm font-medium text-foreground">
        {chosenClassLabel(row.original)}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'applicationStatus',
    accessorFn: (r) => r.applicationStatus ?? '',
    header: 'Application status',
    cell: ({ row }) => (
      <ApplicationStatusBadge status={row.original.applicationStatus} />
    ),
  },
  {
    id: 'stillNeeded',
    // Ready rows read "Ready to enrol" in the CSV too, not a blank cell.
    accessorFn: (r) => (r.ready ? 'Ready to enrol' : r.outstanding.join(', ')),
    header: 'Still needed to enrol',
    cell: ({ row }) =>
      row.original.ready ? (
        <StatusBadge tone="healthy" icon={CheckCircle2}>
          Ready to enrol
        </StatusBadge>
      ) : (
        <div className="space-y-0.5">
          <p className="text-sm text-foreground">
            {row.original.outstanding.join(', ')}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {ENROLLED_PREREQ_STAGES.length - row.original.outstanding.length} of{' '}
            {ENROLLED_PREREQ_STAGES.length} steps done
          </p>
        </div>
      ),
  },
  {
    id: 'classChosenAt',
    accessorFn: (r) => r.classChosenAt ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Class chosen</SortableHeader>
    ),
    // Exported through `csv.extraColumns` instead, as a readable date plus
    // the full "chosen by" address.
    meta: { label: 'Class chosen', excludeFromExport: true },
    cell: ({ row }) => {
      const date = formatDate(row.original.classChosenAt);
      const by = shortActor(row.original.classChosenBy);
      if (!date && !by) {
        return (
          <span className="text-sm text-muted-foreground">Not recorded</span>
        );
      }
      return (
        <div
          className="space-y-0.5"
          title={row.original.classChosenBy ?? undefined}
        >
          <p className="text-sm tabular-nums text-foreground">
            {date || 'Date not recorded'}
          </p>
          {by ? (
            <p className="max-w-40 truncate text-xs text-muted-foreground">
              by {by}
            </p>
          ) : null}
        </div>
      );
    },
    enableSorting: true,
    // ISO strings compare correctly as strings; an unrecorded date sorts after
    // the dated rows (oldest first), matching the loader's order.
    sortingFn: (a, b) => {
      const va = a.getValue<string>('classChosenAt');
      const vb = b.getValue<string>('classChosenAt');
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return va < vb ? -1 : va > vb ? 1 : 0;
    },
  },
];

const STATUS_TABS: StatusTabConfig<ClassChosenRow>[] = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  { value: 'ready', label: 'Ready to enrol', predicate: (r) => r.ready },
  { value: 'waiting', label: 'Steps still open', predicate: (r) => !r.ready },
];

const FACETS = [
  { columnId: 'ayCode', label: 'Year' },
  { columnId: 'applicationStatus', label: 'Application status' },
];

export function ClassChosenTable({ rows }: { rows: ClassChosenRow[] }) {
  return (
    <DataTable<ClassChosenRow>
      data={rows}
      columns={COLUMNS}
      getRowId={(r) => `${r.ayCode}:${r.enroleeNumber}`}
      searchKeys={['fullName', 'enroleeNumber', (r) => chosenClassLabel(r)]}
      searchPlaceholder="Search name, enrolee number or class…"
      facets={FACETS}
      statusTabs={STATUS_TABS}
      pageSize={25}
      csv={{
        filename: 'class-chosen-not-enrolled.csv',
        extraColumns: [
          {
            id: 'classChosenOn',
            header: 'Class chosen on',
            accessor: (r) => formatDate(r.classChosenAt) || null,
            defaultChecked: true,
          },
          {
            id: 'classChosenBy',
            header: 'Class chosen by',
            accessor: (r) => r.classChosenBy,
            defaultChecked: true,
          },
        ],
      }}
      url={{ enabled: true, namespace: 'cohort' }}
      emptyState={{
        icon: Hourglass,
        title: 'No child is waiting to enrol',
        body: 'When a class is chosen for a child whose application is not Enrolled yet, they are listed here until their enrolment is finished.',
      }}
      emptyFilteredState={{ title: 'No matches for current filters.' }}
    />
  );
}
