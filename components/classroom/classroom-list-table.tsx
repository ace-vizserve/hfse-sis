'use client';

// Classroom class list as a unified <DataTable> — the closest existing
// analogue is components/markbook/sections-data-table.tsx (same shape:
// Class/Level/Adviser/Students), minus the row-actions menu (Generate
// index / Generate sheets are SIS Admin / Markbook concerns, not surfaced
// here) and with an empty state that's caller-supplied — Phase 2's scoping
// means "no classes" reads differently for a teacher with zero assignments
// vs. an oversight role viewing a truly empty AY.

import { type ColumnDef } from '@tanstack/react-table';
import { School } from 'lucide-react';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';

// ─── Row type ────────────────────────────────────────────────────────────────

export type ClassroomListRow = {
  id: string;
  name: string;
  levelLabel: string;
  active: number;
  adviserName: string | null;
};

// ─── facetFilterFn (verbatim copy from the module section-list tables) ───────

function facetFilterFn(
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
) {
  if (!value || (Array.isArray(value) && value.length === 0)) return true;
  return Array.isArray(value)
    ? value.includes(row.getValue(id))
    : row.getValue(id) === value;
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const columns: ColumnDef<ClassroomListRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Class</SortableHeader>
    ),
    cell: ({ row }) => (
      <IdentifierLink href={`/classroom/${row.original.id}`}>
        {row.original.name}
      </IdentifierLink>
    ),
  },
  {
    accessorKey: 'levelLabel',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {row.original.levelLabel}
      </span>
    ),
    filterFn: facetFilterFn,
  },
  {
    accessorKey: 'adviserName',
    header: ({ column }) => (
      <SortableHeader column={column}>Adviser</SortableHeader>
    ),
    cell: ({ row }) => <AdviserCell name={row.original.adviserName} />,
  },
  {
    accessorKey: 'active',
    header: ({ column }) => (
      <SortableHeader column={column}>Students</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-[13px] tabular-nums">
        {row.original.active}
      </span>
    ),
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ClassroomListTable({
  rows,
  levels,
  emptyTitle,
  emptyBody,
}: {
  rows: ClassroomListRow[];
  levels: { id: string; code: string; label: string }[];
  emptyTitle: string;
  emptyBody: string;
}) {
  const facets: FacetConfig[] =
    levels.length > 1
      ? [
          {
            columnId: 'levelLabel',
            label: 'Level',
            valueOptions: levels.map((l) => l.label),
          },
        ]
      : [];

  return (
    <DataTable<ClassroomListRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={['name', 'levelLabel']}
      searchPlaceholder="Search class or level…"
      facets={facets}
      initialSort={[
        { id: 'levelLabel', desc: false },
        { id: 'name', desc: false },
      ]}
      pageSize={25}
      // Namespaced so the shell only reads/writes its own `classes.*` query
      // params — a namespace-less `url={{ enabled: true }}` treats every
      // page param as a phantom facet filter (KD #84 footgun).
      url={{ enabled: true, namespace: 'classes' }}
      emptyState={{
        icon: School,
        title: emptyTitle,
        body: emptyBody,
      }}
      emptyFilteredState={{
        title: 'No classes match the current filters.',
        body: 'Try a different level, or clear the search.',
      }}
    />
  );
}
