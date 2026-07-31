'use client';

// Attendance sections list as a unified <DataTable> with per-row ⋯ actions menu.
// Mirrors MarkbookSectionsDataTable with attendance-specific deltas:
//   1. Section link goes straight to the `/attendance/[id]?date=…` daily
//      writer for EVERY viewer. It was role-aware (Phase 8, design doc
//      2026-07-28-classroom-workspace-design.md) — teachers detoured through
//      Classroom's Attendance tab — until 2026-07-31, when that detour was
//      removed: picking a class inside Attendance already states the intent.
//   2. Props omit `role` and `termStarted` — attendance row-action is "Open daily"
//      only (no Generate-index / Generate-sheets, so no role gating needed).
//   3. Column header "Active" (vs "Students" in Markbook — both are fine labels;
//      "Active" mirrors the existing attendance page copy).
//   4. Optional `showAdviser` prop surfaces the FCA column for registrar+ view;
//      teachers always see their own section and don't need the adviser column.

import { type ColumnDef } from '@tanstack/react-table';
import { Layers } from 'lucide-react';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { SectionRowActions } from '@/components/sections/section-row-actions';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';

// ─── Row type ────────────────────────────────────────────────────────────────

export type AttendanceSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  active: number;
  fcaName: string | null;
};

// ─── facetFilterFn (verbatim copy from MarkbookSectionsDataTable) ─────────────

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
  today: string,
  showAdviser: boolean
): ColumnDef<AttendanceSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      meta: { label: 'Section' },
      cell: ({ row }) => (
        <IdentifierLink
          // Everyone goes to the register. The teacher branch used to detour
          // through /classroom/{id}/attendance — a summary tab whose own
          // primary button is "Open the attendance sheet", so marking a class
          // took two clicks where the row already said where you were going.
          //
          // KD #160's own rationale ("being in a module already declares
          // intent") argues for this: someone who opened Attendance and picked
          // a class has stated the intent twice. Classroom stays available and
          // is still where the adviser goes for the whole-class view; it is
          // just no longer on the path to the day's marking.
          href={`/attendance/${row.original.id}?date=${today}`}
        >
          {row.original.name}
        </IdentifierLink>
      ),
    },
    {
      accessorKey: 'levelLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Level</SortableHeader>
      ),
      meta: { label: 'Level' },
      cell: ({ row }) => (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {row.original.levelLabel}
        </span>
      ),
      filterFn: facetFilterFn,
    },
    ...(showAdviser
      ? ([
          {
            accessorKey: 'fcaName',
            header: ({ column }) => (
              <SortableHeader column={column}>Adviser</SortableHeader>
            ),
            meta: { label: 'Adviser' },
            cell: ({ row }) => <AdviserCell name={row.original.fcaName} />,
          },
        ] as ColumnDef<AttendanceSectionRow>[])
      : []),
    {
      accessorKey: 'active',
      header: ({ column }) => (
        <SortableHeader column={column}>Active</SortableHeader>
      ),
      meta: { label: 'Active' },
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
          module="attendance"
          sectionId={row.original.id}
          sectionName={row.original.name}
          role={null}
          termStarted={false}
          todayHref={`/attendance/${row.original.id}?date=${today}`}
        />
      ),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AttendanceSectionsDataTable({
  rows,
  levels,
  today,
  showAdviser = false,
}: {
  rows: AttendanceSectionRow[];
  levels: { id: string; code: string; label: string }[];
  today: string;
  showAdviser?: boolean;
}) {
  const columns = buildColumns(today, showAdviser);

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
    <DataTable<AttendanceSectionRow>
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
      csv={{ filename: 'attendance-sections.csv' }}
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
