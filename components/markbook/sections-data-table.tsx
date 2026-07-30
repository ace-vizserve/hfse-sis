'use client';

// Markbook sections list as a unified <DataTable> with per-row ⋯ actions menu.
// Mirrors SisSectionsDataTable exactly, with three markbook-specific deltas:
//   1. Row type omits `withdrawn` (Markbook only shows active enrolment counts).
//   2. Section link is role-aware (Phase 8, design doc
//      2026-07-28-classroom-workspace-design.md): a teacher lands in
//      Classroom's Grades tab for that class (staying in class context);
//      oversight (academic_coordinator/school_admin/superadmin) lands on
//      the module-native grading-sheets list, filtered to that section — the
//      same href the classroom class page and several drills already use.
//      `/markbook/sections/[id]` itself is unchanged (still a redirect stub
//      into Classroom, kept alive for bookmarks) — it's simply no longer
//      this table's own row target.
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
import type { ClassroomCapability } from '@/lib/classroom/scope';

// ─── Row type ────────────────────────────────────────────────────────────────

export type MarkbookSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  active: number;
  fcaName: string | null;
  /**
   * This viewer's capability in THIS section (lib/classroom/scope.ts). Markbook
   * scopes on any assignment, so a row here can be one the viewer only teaches
   * a subject in — and the row menu's Attendance / Write-ups cross-links land
   * on adviser-only surfaces. Per-section, not per-person: an adviser of one
   * class who teaches a subject in another needs a different answer per row.
   */
  capability: ClassroomCapability | null;
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
  ayId: string,
  isOversight: boolean
): ColumnDef<MarkbookSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      meta: { label: 'Section' },
      cell: ({ row }) => (
        <IdentifierLink
          href={
            isOversight
              ? `/markbook/grading?grading.section=${encodeURIComponent(row.original.name)}`
              : `/classroom/${row.original.id}/grades`
          }
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
    {
      accessorKey: 'fcaName',
      header: ({ column }) => (
        <SortableHeader column={column}>Adviser</SortableHeader>
      ),
      meta: { label: 'Adviser' },
      cell: ({ row }) => <AdviserCell name={row.original.fcaName} />,
    },
    {
      accessorKey: 'active',
      header: ({ column }) => (
        <SortableHeader column={column}>Students</SortableHeader>
      ),
      meta: { label: 'Students' },
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
          // Same resolver value the name link above uses, so "Open grading"
          // and the row's own name can't send you to different places.
          isOversight={isOversight}
          capability={row.original.capability}
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
  isOversight,
}: {
  rows: MarkbookSectionRow[];
  levels: { id: string; code: string; label: string }[];
  role: Role | null;
  termStarted: boolean;
  ayId: string;
  /** From lib/classroom/scope.ts's resolver (Phase 8) — decides both the
   *  row link target above and the empty-state copy below. Never re-derive
   *  this from role inline; it must match how Classroom itself decides. */
  isOversight: boolean;
}) {
  const columns = buildColumns(role, termStarted, ayId, isOversight);

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
        title: isOversight ? 'No sections yet.' : 'No classes assigned yet.',
        body: isOversight
          ? 'Sections appear here once they are created and a roster is synced. Ask the registrar to set up sections in SIS Admin.'
          : "You don't have any classes assigned this year. Ask your coordinator to add you as a form adviser or subject teacher.",
      }}
      emptyFilteredState={{
        title: 'No sections match the current filters.',
        body: 'Try a different level, or clear the search.',
      }}
    />
  );
}
