'use client';

import { type ColumnDef } from '@tanstack/react-table';

import { TierChip } from '@/components/markbook/awards/award-tier-visuals';
import { DASH, Num } from '@/components/markbook/overview-cells';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  NEAR_BAND_POINTS,
  TIER_DISPLAY_ORDER,
  type AwardsStudentRow,
} from '@/lib/markbook/awards-overview-compute';

// Per-student awards detail, on the shared <DataTable> shell.
//
// ⚠ THE DEFAULT ORDER IS DISTANCE TO THE NEXT BAND, closest first, and that is
// the point of the page rather than a preference. A list sorted by score names
// the students who are already fine; a list sorted by distance names the ones a
// tenth of a point below a boundary. Measured on production 2026-08-18, 66 of
// 372 students sit within a point of moving up, and nothing in the SIS could
// show you which.
//
// Gold sorts last, not first — a student at the top of the ladder has nowhere
// to move, so "closest to moving up" does not apply to them.
//
// No `csv` config: the page owns one Export for every table on it.

export function AwardsStudentTable({
  rows,
  settled,
  categoryLabel,
}: {
  rows: AwardsStudentRow[];
  /** True only when the year is complete and awards have actually settled. */
  settled: boolean;
  categoryLabel: string;
}) {
  const columns: ColumnDef<AwardsStudentRow>[] = [
    {
      accessorKey: 'fullName',
      header: ({ column }) => (
        <SortableHeader column={column}>Student</SortableHeader>
      ),
      meta: { label: 'Student' },
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          {row.original.studentNumber ? (
            <IdentifierLink
              href={`/records/students/${encodeURIComponent(row.original.studentNumber)}`}
            >
              {row.original.fullName}
            </IdentifierLink>
          ) : (
            <span className="font-medium text-foreground">
              {row.original.fullName}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            {row.original.studentNumber}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'levelLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Grade level</SortableHeader>
      ),
      meta: { label: 'Grade level' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {row.original.levelLabel || DASH}
        </span>
      ),
      filterFn: (r, id, value) =>
        !Array.isArray(value) || value.length === 0
          ? true
          : value.includes(r.getValue(id)),
    },
    {
      accessorKey: 'sectionName',
      header: ({ column }) => (
        <SortableHeader column={column}>Class</SortableHeader>
      ),
      meta: { label: 'Class' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {row.original.sectionName || DASH}
        </span>
      ),
    },
    {
      accessorKey: 'score',
      header: ({ column }) => (
        <SortableHeader column={column} align="right">
          Average
        </SortableHeader>
      ),
      meta: { label: 'Average' },
      cell: ({ row }) => (
        <Num>
          {row.original.score == null ? DASH : row.original.score.toFixed(1)}
        </Num>
      ),
    },
    {
      accessorKey: 'standing',
      header: ({ column }) => (
        <SortableHeader column={column}>
          {settled ? 'Award' : 'Standing'}
        </SortableHeader>
      ),
      meta: { label: settled ? 'Award' : 'Standing' },
      cell: ({ row }) => (
        <TierChip
          tier={settled ? row.original.official : row.original.standing}
          settled={settled}
        />
      ),
      filterFn: (r, id, value) =>
        !Array.isArray(value) || value.length === 0
          ? true
          : value.includes(r.getValue(id)),
    },
    {
      accessorKey: 'toNextBand',
      header: ({ column }) => (
        <SortableHeader column={column} align="right">
          To next
        </SortableHeader>
      ),
      meta: { label: 'To next' },
      cell: ({ row }) => {
        const points = row.original.toNextBand;
        if (points == null) {
          // Already at the top of the ladder — an em dash, not a zero.
          return <Num>{DASH}</Num>;
        }
        return (
          <Num tone={points <= NEAR_BAND_POINTS ? 'bad' : undefined}>
            +{points.toFixed(1)}
          </Num>
        );
      },
    },
    {
      accessorKey: 'termsCounted',
      header: ({ column }) => (
        <SortableHeader column={column} align="right">
          Terms
        </SortableHeader>
      ),
      meta: { label: 'Terms' },
      cell: ({ row }) => <Num>{row.original.termsCounted}</Num>,
    },
  ];

  return (
    <DataTable<AwardsStudentRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.studentId}
      searchKeys={['fullName', 'studentNumber', 'sectionName', 'levelLabel']}
      searchPlaceholder="Search students…"
      facets={[
        {
          columnId: 'standing',
          label: settled ? 'Award' : 'Standing',
          valueOptions: TIER_DISPLAY_ORDER.map((t) => t.key),
        },
        { columnId: 'levelLabel', label: 'Grade level' },
      ]}
      pageSize={25}
      emptyState={{
        title: `No ${categoryLabel.toLowerCase()} to show.`,
        body: 'Nothing has been marked for this scope yet.',
      }}
      emptyFilteredState={{
        title: 'No student matches.',
        body: 'Clear the filters to see everyone in scope.',
      }}
    />
  );
}
