'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { TierCompositionBar } from '@/components/markbook/awards/tier-composition-bar';
import { DASH, Num } from '@/components/markbook/overview-cells';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  TIER_DISPLAY_ORDER,
  type AwardsLevelRow,
} from '@/lib/markbook/awards-overview-compute';

// The grade-level ladder for Awards.
//
// Same rules as the Academic Summary ladder: rows arrive in school order and
// `initialSort` is empty so TanStack keeps it, because the order carries
// progression rather than rank. "Grade level" sorts by school position, not by
// its own text, so there is a way back once you have sorted by anything else —
// SortableHeader only cycles asc/desc and never clears.

export type AwardsLevelTableRow = AwardsLevelRow & {
  href: string;
  /** Wording only — a standing is not an award. */
  settled: boolean;
};

const columns: ColumnDef<AwardsLevelTableRow>[] = [
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
        className="whitespace-nowrap font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    cell: ({ row }) => (
      <Num>
        {row.original.average == null ? DASH : row.original.average.toFixed(1)}
      </Num>
    ),
  },
  ...TIER_DISPLAY_ORDER.map<ColumnDef<AwardsLevelTableRow>>((band) => ({
    id: band.key,
    accessorFn: (row) => row.tiers[band.key],
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        {band.label}
      </SortableHeader>
    ),
    meta: { label: band.label },
    cell: ({ row }) => {
      const n = row.original.tiers[band.key];
      // A zero is information here — Secondary Four has no Gold at all — but it
      // should not shout as loudly as a real count.
      return (
        <div
          className={`text-right tabular-nums ${n === 0 ? 'text-muted-foreground' : ''}`}
        >
          {n}
        </div>
      );
    },
  })),
  {
    id: 'spread',
    header: () => (
      <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
        Spread
      </span>
    ),
    meta: { label: 'Spread' },
    enableSorting: false,
    cell: ({ row }) => (
      <TierCompositionBar
        tiers={row.original.tiers}
        title={row.original.levelLabel}
        withinReach={row.original.withinReach}
        settled={row.original.settled}
      />
    ),
  },
  {
    accessorKey: 'withinReach',
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        Within reach
      </SortableHeader>
    ),
    meta: { label: 'Within reach' },
    cell: ({ row }) => (
      <Num tone={row.original.withinReach > 0 ? 'bad' : undefined}>
        {row.original.withinReach}
      </Num>
    ),
  },
];

export function AwardsLevelTable({ rows }: { rows: AwardsLevelTableRow[] }) {
  return (
    <DataTable<AwardsLevelTableRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.levelId}
      searchKeys={['levelLabel']}
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
