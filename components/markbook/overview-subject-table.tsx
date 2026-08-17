'use client';

import { type ColumnDef } from '@tanstack/react-table';

import { BandCompositionBar } from '@/components/markbook/band-composition-bar';
import {
  ExtremeCell,
  Num,
  TrendCell,
  fmt,
  pct,
} from '@/components/markbook/overview-cells';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type OverviewSubjectRow } from '@/lib/markbook/academic-overview-compute';

// Performance by subject, on the shared <DataTable> shell.
//
// Default order is widest reach first — the subjects most of the school sits —
// which the rows arrive in. `initialSort` is left empty so TanStack keeps that
// order; sorting "Students" descending puts it back.
//
// No `csv` config, for the same reason as the level table: the page's own
// Export button already covers all three summary tables.

const columns: ColumnDef<OverviewSubjectRow>[] = [
  {
    accessorKey: 'subjectName',
    header: ({ column }) => (
      <SortableHeader column={column}>Subject</SortableHeader>
    ),
    meta: { label: 'Subject' },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.subjectName}</span>
    ),
  },
  {
    accessorKey: 'students',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Students
      </SortableHeader>
    ),
    meta: { label: 'Students' },
    cell: ({ row }) => <Num>{row.original.students}</Num>,
  },
  {
    accessorKey: 'average',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Average
      </SortableHeader>
    ),
    meta: { label: 'Average' },
    cell: ({ row }) => <Num>{fmt(row.original.average)}</Num>,
  },
  {
    accessorKey: 'passingRate',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Passing
      </SortableHeader>
    ),
    meta: { label: 'Passing' },
    cell: ({ row }) => <Num>{pct(row.original.passingRate)}</Num>,
  },
  {
    id: 'strongestLevel',
    accessorFn: (row) => row.strongestLevel?.average ?? null,
    header: ({ column }) => (
      <SortableHeader column={column}>Strongest level</SortableHeader>
    ),
    meta: { label: 'Strongest level' },
    cell: ({ row }) => (
      <ExtremeCell
        name={row.original.strongestLevel?.label ?? null}
        average={row.original.strongestLevel?.average ?? null}
      />
    ),
  },
  {
    id: 'weakestLevel',
    accessorFn: (row) => row.weakestLevel?.average ?? null,
    header: ({ column }) => (
      <SortableHeader column={column}>Weakest level</SortableHeader>
    ),
    meta: { label: 'Weakest level' },
    cell: ({ row }) => (
      <ExtremeCell
        name={row.original.weakestLevel?.label ?? null}
        average={row.original.weakestLevel?.average ?? null}
        // A subject taught at one level only has no weakest level to name —
        // that is a fact about the timetable, not missing data.
        emptyLabel="Only level"
      />
    ),
  },
  {
    id: 'spread',
    header: () => (
      <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
        How marks are spread
      </span>
    ),
    meta: { label: 'How marks are spread' },
    enableSorting: false,
    cell: ({ row }) => (
      <BandCompositionBar
        bands={row.original.bands}
        title={row.original.subjectName}
        basis="subject"
      />
    ),
  },
  {
    accessorKey: 'delta',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Trend
      </SortableHeader>
    ),
    meta: { label: 'Trend' },
    cell: ({ row }) => (
      <div className="text-right">
        <TrendCell delta={row.original.delta} />
      </div>
    ),
  },
];

export function OverviewSubjectTable({ rows }: { rows: OverviewSubjectRow[] }) {
  return (
    <DataTable<OverviewSubjectRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.subjectId}
      searchKeys={['subjectName']}
      searchPlaceholder="Search subjects…"
      hidePagination
      emptyState={{
        title: 'No subjects to report.',
        body: 'Nothing examinable has been marked for this academic year yet.',
      }}
      emptyFilteredState={{
        title: 'No subject matches.',
        body: 'Clear the search to see them all.',
      }}
    />
  );
}
