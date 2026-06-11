'use client';

// SIS sections list as a unified <DataTable> with per-row ⋯ actions menu.
// Mirrors EvaluationSectionsList exactly — same wiring: facetFilterFn, columns
// w/ SortableHeader + IdentifierLink, FacetConfig (Level), DataTable props.
// The bulk "Generate all indexes" button lives in toolbarTrailing (registrar+).

import { type ColumnDef } from '@tanstack/react-table';
import { Layers } from 'lucide-react';

import { SectionRowActions } from '@/components/sections/section-row-actions';
import { GenerateAllIndexButton } from '@/components/sis/generate-index-button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { Role } from '@/lib/auth/roles';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';

// ─── Row type ────────────────────────────────────────────────────────────────

export type SisSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  schedule: Schedule | null;
  active: number;
  withdrawn: number;
};

// ─── facetFilterFn (verbatim copy from EvaluationSectionsList) ────────────────

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
  termStarted: boolean
): ColumnDef<SisSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      cell: ({ row }) => (
        <IdentifierLink href={`/sis/sections/${row.original.id}`}>
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
      accessorKey: 'schedule',
      header: ({ column }) => (
        <SortableHeader column={column}>Schedule</SortableHeader>
      ),
      cell: ({ row }) =>
        row.original.schedule ? (
          <Badge
            variant="outline"
            className="h-6 border-border bg-white px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground"
          >
            {SCHEDULE_LABELS[row.original.schedule]}
          </Badge>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      accessorKey: 'active',
      header: ({ column }) => (
        <SortableHeader column={column}>Active</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] tabular-nums">
          {row.original.active}
        </span>
      ),
    },
    {
      accessorKey: 'withdrawn',
      header: ({ column }) => (
        <SortableHeader column={column}>Withdrawn</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
          {row.original.withdrawn}
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
          module="sis"
          sectionId={row.original.id}
          sectionName={row.original.name}
          role={role}
          termStarted={termStarted}
        />
      ),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SisSectionsDataTable({
  rows,
  levels,
  role,
  termStarted,
  sections,
}: {
  rows: SisSectionRow[];
  levels: { id: string; code: string; label: string }[];
  role: Role | null;
  termStarted: boolean;
  sections: { id: string; name: string }[];
}) {
  const columns = buildColumns(role, termStarted);

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

  const isRegistrarPlus =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

  return (
    <DataTable<SisSectionRow>
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
      csv={{ filename: 'sis-sections.csv' }}
      url={{ enabled: true, namespace: 'sections' }}
      toolbarTrailing={
        isRegistrarPlus && sections.length > 0 ? (
          <GenerateAllIndexButton
            sections={sections}
            termStarted={termStarted}
          />
        ) : undefined
      }
      emptyState={{
        icon: Layers,
        title: 'No sections yet.',
        body: 'Click "New section" above, or create a new AY via AY Setup to copy sections forward from the prior year.',
      }}
      emptyFilteredState={{
        title: 'No sections match the current filters.',
        body: 'Try a different level, or clear the search.',
      }}
    />
  );
}
