'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { BandCompositionBar } from '@/components/markbook/band-composition-bar';
import {
  DASH,
  ExtremeCell,
  Num,
  TrendCell,
  fmt,
  pct,
} from '@/components/markbook/overview-cells';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  type OverviewLevelRow,
} from '@/lib/markbook/academic-overview-compute';

// The grade-level ladder, on the shared <DataTable> shell.
//
// ⚠ THE DEFAULT ORDER IS THE SCHOOL LADDER, NOT A RANKING — Primary One first,
// Secondary Four last, because the order carries progression. `initialSort` is
// therefore empty (TanStack keeps input order when nothing is sorted) and the
// rows arrive pre-sorted by `sortOrder`.
//
// The "Grade level" column sorts by `sortOrder` rather than by its own text,
// for two reasons: alphabetical would read "Primary One, Primary Six, Primary
// Three", and SortableHeader only cycles asc/desc — it never clears — so
// without this there would be no way back to the ladder once you had sorted by
// anything else.
//
// No `csv` config on purpose. The page already has one Export button covering
// all three summary tables (lib/markbook/academic-overview-export.ts); a second
// export here would produce a different file from the same screen.

/** A ladder row with its destination already resolved (a server component
 *  cannot hand a client component the href-building function itself). */
export type OverviewLevelTableRow = OverviewLevelRow & { href: string };

const columns: ColumnDef<OverviewLevelTableRow>[] = [
  {
    id: 'levelLabel',
    accessorFn: (row) => row.sortOrder,
    header: ({ column }) => (
      <SortableHeader column={column}>Grade level</SortableHeader>
    ),
    meta: { label: 'Grade level' },
    cell: ({ row }) => (
      <Link
        href={row.original.href}
        className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.original.levelLabel}
      </Link>
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
    accessorKey: 'failedSubjectsAvg',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Subjects below 75
      </SortableHeader>
    ),
    meta: { label: 'Subjects below 75' },
    cell: ({ row }) => <Num>{fmt(row.original.failedSubjectsAvg)}</Num>,
  },
  {
    id: 'strongestSubject',
    // Sorted by the FIGURE, not the subject name — "which level's best subject
    // is strongest" is the question; an alphabetical list of subject names is
    // not an answer to anything.
    accessorFn: (row) => row.strongestSubject?.average ?? null,
    header: ({ column }) => (
      <SortableHeader column={column}>Strongest subject</SortableHeader>
    ),
    meta: { label: 'Strongest subject' },
    cell: ({ row }) => (
      <ExtremeCell
        name={row.original.strongestSubject?.name ?? null}
        average={row.original.strongestSubject?.average ?? null}
      />
    ),
  },
  {
    id: 'weakestSubject',
    accessorFn: (row) => row.weakestSubject?.average ?? null,
    header: ({ column }) => (
      <SortableHeader column={column}>Weakest subject</SortableHeader>
    ),
    meta: { label: 'Weakest subject' },
    cell: ({ row }) => (
      <ExtremeCell
        name={row.original.weakestSubject?.name ?? null}
        average={row.original.weakestSubject?.average ?? null}
      />
    ),
  },
  {
    id: 'spread',
    // Not sortable: a five-band composition has no single value to order by,
    // and picking one (say the share outstanding) would be a hidden choice the
    // header could not admit to.
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
        title={row.original.levelLabel}
      />
    ),
  },
  {
    accessorKey: 'attendanceRate',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Attendance
      </SortableHeader>
    ),
    meta: { label: 'Attendance' },
    cell: ({ row }) => <Num>{pct(row.original.attendanceRate)}</Num>,
  },
  {
    accessorKey: 'attendanceBelowThreshold',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Below {AT_RISK_ATTENDANCE_THRESHOLD_PCT}%
      </SortableHeader>
    ),
    meta: { label: `Below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}%` },
    cell: ({ row }) => (
      <Num tone={row.original.attendanceBelowThreshold ? 'bad' : undefined}>
        {row.original.attendanceBelowThreshold ?? DASH}
      </Num>
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

export function OverviewLevelTable({
  rows,
}: {
  rows: OverviewLevelTableRow[];
}) {
  return (
    <DataTable<OverviewLevelTableRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.levelId}
      searchKeys={['levelLabel', 'levelCode']}
      searchPlaceholder="Search grade levels…"
      hidePagination
      emptyState={{
        title: 'No grade levels to report.',
        body: 'Nothing has been marked for this academic year yet.',
      }}
      emptyFilteredState={{
        title: 'No grade level matches.',
        body: 'Clear the search to see the whole ladder.',
      }}
    />
  );
}
