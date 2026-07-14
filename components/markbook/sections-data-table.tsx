'use client';

// Markbook sections list as a unified <DataTable> with per-row ⋯ actions menu.
// Mirrors SisSectionsDataTable exactly, with three markbook-specific deltas:
//   1. Row type omits `withdrawn` (Markbook only shows active enrolment counts).
//   2. Section link → /markbook/sections/${id} (not /sis/sections/${id}).
//   3. No `toolbarTrailing` bulk button — Markbook has no toolbar bulk action.
//      (Generate-index is available per-row via SectionRowActions.)
// The `Students` header label replaces `Active` — cleaner for teacher view.

import { type ColumnDef } from '@tanstack/react-table';
import { Layers } from 'lucide-react';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { SectionRowActions } from '@/components/sections/section-row-actions';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { Role } from '@/lib/auth/roles';

// ─── Row type ────────────────────────────────────────────────────────────────

export type MarkbookSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  active: number;
  fcaName: string | null;
};

// ─── facetFilterFn (verbatim copy from SisSectionsDataTable / EvaluationSectionsList) ─

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

function buildColumns(
  role: Role | null,
  termStarted: boolean,
  ayId: string
): ColumnDef<MarkbookSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      cell: ({ row }) => (
        <IdentifierLink href={`/markbook/sections/${row.original.id}`}>
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
      accessorKey: 'fcaName',
      header: ({ column }) => (
        <SortableHeader column={column}>Adviser</SortableHeader>
      ),
      cell: ({ row }) => <AdviserCell name={row.original.fcaName} />,
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
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <SectionRowActions
          module="markbook"
          sectionId={row.original.id}
          sectionName={row.original.name}
          role={role}
          termStarted={termStarted}
          ayId={ayId}
        />
      ),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MarkbookSectionsDataTable({
  rows,
  levels,
  role,
  termStarted,
  ayId,
}: {
  rows: MarkbookSectionRow[];
  levels: { id: string; code: string; label: string }[];
  role: Role | null;
  termStarted: boolean;
  ayId: string;
}) {
  const columns = buildColumns(role, termStarted, ayId);

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
    <DataTable<MarkbookSectionRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={['name', 'levelLabel']}
      searchPlaceholder="Search section or level…"
      facets={facets}
      initialSort={[
        { id: 'levelLabel', desc: false },
        { id: 'name', desc: false },
      ]}
      pageSize={25}
      csv={{ filename: 'markbook-sections.csv' }}
      url={{ enabled: true, namespace: 'sections' }}
      emptyState={{
        icon: Layers,
        title: 'No sections yet.',
        body: 'Sections appear here once they are created and a roster is synced. Ask the registrar to set up sections in SIS Admin.',
      }}
      emptyFilteredState={{
        title: 'No sections match the current filters.',
        body: 'Try a different level, or clear the search.',
      }}
    />
  );
}
