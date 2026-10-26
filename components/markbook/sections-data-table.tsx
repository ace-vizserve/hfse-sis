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
import { ArrowDownAZ, FilePlus2, Layers } from 'lucide-react';
import { useState } from 'react';

import { BulkActionDialog } from '@/components/ui/bulk-action-dialog';
import { runExclusively, useBulkAction } from '@/lib/hooks/use-bulk-action';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { warnSowMissing, type SowMissing } from '@/lib/sow/missing-message';

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
  /**
   * The same answer with cover excluded. Only the Write-ups cross-link uses it:
   * a substitute covering this class works its marks and attendance, but the
   * regular adviser still writes the write-ups, so that one destination would
   * 404 for them (migrations 112/113).
   */
  substantiveCapability: ClassroomCapability | null;
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
          substantiveCapability={row.original.substantiveCapability}
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

  // Bulk Generate sheets / Renumber A–Z: the same registrar-and-above actions
  // the row menu offers (SectionRowActions' showGenerateItems), run on every
  // ticked section.
  const canBulk =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  const run = useWriteAction();
  const bulk = useBulkAction();
  const [confirm, setConfirm] = useState<{
    kind: 'sheets' | 'index';
    rows: MarkbookSectionRow[];
  } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  async function confirmBulk() {
    if (!confirm) return;
    const { kind, rows: picked } = confirm;
    setConfirm(null);
    const n = picked.length;
    const sections = `${n} ${n === 1 ? 'section' : 'sections'}`;
    if (kind === 'sheets') {
      // One call: the route takes the whole list of sections.
      await runExclusively(() =>
        run(
          () =>
            apiFetch<{ inserted?: number; sowMissing?: SowMissing[] }>(
              '/api/grading-sheets/bulk-create',
              jsonInit('POST', {
                ay_id: ayId,
                section_ids: picked.map((s) => s.id),
              })
            ),
          {
            pending: `Generating sheets for ${sections}…`,
            success: (json) => {
              const inserted = Number(json?.inserted ?? 0);
              warnSowMissing(json?.sowMissing);
              return inserted === 0
                ? 'Nothing to generate. Every sheet already exists.'
                : `Generated ${inserted.toLocaleString('en-SG')} ${inserted === 1 ? 'sheet' : 'sheets'} for ${sections}`;
            },
          }
        )
      );
    } else {
      await bulk(picked, {
        pending: `Renumbering ${sections}…`,
        done: (c) => `${c} ${c === 1 ? 'section' : 'sections'} renumbered`,
        failed: 'Could not renumber',
        label: (s) => s.name,
        one: (s) =>
          apiFetch(
            `/api/sections/${encodeURIComponent(s.id)}/generate-index`,
            jsonInit('POST')
          ),
      });
    }
    setResetSignal((s) => s + 1);
  }
  const confirmCount = confirm?.rows.length ?? 0;
  const confirmNoun = confirmCount === 1 ? 'section' : 'sections';

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
    <>
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
        selection={{
          enabled: canBulk,
          bulkActions: [
            {
              key: 'sheets',
              label: 'Generate sheets',
              icon: FilePlus2,
              onTrigger: (picked) =>
                setConfirm({ kind: 'sheets', rows: picked }),
            },
            {
              key: 'index',
              label: 'Renumber A–Z',
              icon: ArrowDownAZ,
              destructive: true,
              onTrigger: (picked) =>
                setConfirm({ kind: 'index', rows: picked }),
            },
          ],
        }}
        selectionResetSignal={resetSignal}
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
      <BulkActionDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === 'sheets'
            ? `Generate grading sheets for ${confirmCount} ${confirmNoun}?`
            : `Renumber ${confirmCount} ${confirmNoun} A–Z?`
        }
        description={
          confirm?.kind === 'sheets'
            ? 'Creates every missing grading sheet (section, subject and term) for the ticked sections. Sheets that already exist are skipped, so it is safe to run again.'
            : termStarted
              ? 'The term has started. Renumbering changes the index numbers students already use in class, in every ticked section.'
              : 'Gives each ticked section a fresh A–Z index-number order.'
        }
        confirmLabel={
          confirm?.kind === 'sheets' ? 'Generate sheets' : 'Renumber'
        }
        destructive={confirm?.kind === 'index' && termStarted}
        onConfirm={confirmBulk}
      />
    </>
  );
}
