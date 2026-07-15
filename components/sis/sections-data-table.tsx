'use client';

// SIS sections list as a unified <DataTable> with per-row ⋯ actions menu.
// Mirrors EvaluationSectionsList exactly — same wiring: facetFilterFn, columns
// w/ SortableHeader + IdentifierLink, FacetConfig (Level), DataTable props.
// The bulk "Generate all indexes" button lives in toolbarTrailing (registrar+).
//
// Rows come in two kinds (merged into one list, not two separate surfaces —
// a "levels needing a section" panel used to sit above this table showing
// the exact same level data with no search/sort/facets of its own; folded
// in here instead): real sections ('section'), and offered/core levels with
// zero sections yet ('needed') — a gap that can never appear as a row in a
// sections-only table, since there's no section row to represent it. A
// 'needed' row renders its own Section-name + actions cells; every other
// column (Level, Schedule, Adviser, Active, Withdrawn, Index) just shows a
// muted "—" for it, so the Level facet still finds it like any other row.

import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle2, Layers, Plus } from 'lucide-react';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { SectionRowActions } from '@/components/sections/section-row-actions';
import { NewSectionButton } from '@/components/markbook/new-section-button';
import {
  GenerateAllIndexButton,
  GenerateIndexButton,
} from '@/components/sis/generate-index-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge } from '@/components/ui/status-badge';
import type { Role } from '@/lib/auth/roles';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';
import type { IndexStatus } from '@/lib/sis/section-index-status';

// ─── Row type ────────────────────────────────────────────────────────────────

export type SisSectionRow = {
  kind: 'section' | 'needed';
  /** Real section id, or a `needed:${levelId}` sentinel — never a real
   *  section, so it can't collide with SectionRowActions' expectations
   *  (those cells are never rendered for a 'needed' row). */
  id: string;
  levelId: string;
  /** Section name for 'section' rows; '' for 'needed' (the Level column +
   *  search already surface the level, so there's nothing to name here —
   *  an empty string sorts predictably first/last, never mid-list). */
  name: string;
  levelLabel: string;
  schedule: Schedule | null;
  active: number;
  withdrawn: number;
  indexStatus: IndexStatus | null;
  fcaName: string | null;
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

const DASH = <span className="text-muted-foreground/50">—</span>;

// ─── Columns ──────────────────────────────────────────────────────────────────

function buildColumns(
  role: Role | null,
  termStarted: boolean,
  ayId: string,
  onAddSection: (levelId: string) => void
): ColumnDef<SisSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      cell: ({ row }) => {
        if (row.original.kind === 'needed') {
          return (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="size-3.5 text-brand-amber" />
              No section yet
            </span>
          );
        }
        // Serif — section names are HFSE's virtue names (Obedience, Patience,
        // …, KD #144), not arbitrary labels, so the row anchor carries the
        // same editorial weight as a section's hero title.
        return (
          <IdentifierLink
            href={`/sis/sections/${row.original.id}`}
            className="font-serif text-[14.5px] font-semibold"
          >
            {row.original.name}
          </IdentifierLink>
        );
      },
    },
    {
      accessorKey: 'levelLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Level</SortableHeader>
      ),
      cell: ({ row }) => (
        // Same chip recipe as the Schedule column + the page header's
        // level/schedule/AY chips — one "module chip anatomy," not a
        // one-off. bg-card (not bg-white) per the no-new-bg-white rule;
        // renders identically since both resolve to #FFFFFF.
        <Badge
          variant="outline"
          className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground"
        >
          {row.original.levelLabel}
        </Badge>
      ),
      filterFn: facetFilterFn,
    },
    {
      // accessorFn returns the human label so it's both the facet vocabulary
      // and the sort key (the cell still renders from the raw enum).
      accessorFn: (row) => (row.schedule ? SCHEDULE_LABELS[row.schedule] : '—'),
      id: 'schedule',
      header: ({ column }) => (
        <SortableHeader column={column}>Schedule</SortableHeader>
      ),
      cell: ({ row }) =>
        row.original.schedule ? (
          // Same chip recipe as the Level column above — bg-card (not
          // bg-white) per the no-new-bg-white rule; renders identically.
          <Badge
            variant="outline"
            className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground"
          >
            {SCHEDULE_LABELS[row.original.schedule]}
          </Badge>
        ) : (
          DASH
        ),
      filterFn: facetFilterFn,
    },
    {
      accessorKey: 'fcaName',
      header: ({ column }) => (
        <SortableHeader column={column}>Adviser</SortableHeader>
      ),
      cell: ({ row }) =>
        row.original.kind === 'needed' ? (
          DASH
        ) : (
          <AdviserCell name={row.original.fcaName} showAvatar flagMissing />
        ),
    },
    {
      accessorKey: 'active',
      header: ({ column }) => (
        <SortableHeader column={column}>Active</SortableHeader>
      ),
      cell: ({ row }) =>
        row.original.kind === 'needed' ? (
          DASH
        ) : (
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
      cell: ({ row }) =>
        row.original.kind === 'needed' ? (
          DASH
        ) : (
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
            {row.original.withdrawn}
          </span>
        ),
    },
    {
      id: 'indexStatus',
      header: 'Index',
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original.indexStatus;
        if (!s) return DASH;
        const Icon = s.tone === 'mint' ? CheckCircle2 : AlertTriangle;
        return (
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={s.tone === 'mint' ? 'healthy' : 'warning'}
              icon={Icon}
            >
              {s.label}
            </StatusBadge>
            {s.tone === 'amber' && (
              <GenerateIndexButton
                sectionId={row.original.id}
                sectionName={row.original.name}
                termStarted={termStarted}
                variant="compact"
              />
            )}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.kind === 'needed' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => onAddSection(row.original.levelId)}
          >
            <Plus className="size-3.5" />
            Add section
          </Button>
        ) : (
          <SectionRowActions
            module="sis"
            sectionId={row.original.id}
            sectionName={row.original.name}
            role={role}
            termStarted={termStarted}
            hasAdviser={!!row.original.fcaName}
            ayId={ayId}
          />
        ),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SisSectionsDataTable({
  rows,
  levels,
  levelOptions,
  ayCode,
  role,
  termStarted,
  sections,
  ayId,
}: {
  rows: SisSectionRow[];
  levels: { id: string; code: string; label: string }[];
  /** Full level catalog (id/code/label) for the "Add section" dialog's
   *  level dropdown — deliberately wider than `levels` (which is only the
   *  levels that already appear as a row, i.e. the facet vocabulary). */
  levelOptions: { id: string; code: string; label: string }[];
  ayCode: string | null;
  role: Role | null;
  termStarted: boolean;
  sections: { id: string; name: string }[];
  ayId: string;
}) {
  // Shared controlled "New section" dialog for every 'needed' row's "Add
  // section" action — same one-dialog-many-triggers pattern as
  // components/sis/sections-needed-panel.tsx (which this table replaces).
  const [addSectionLevelId, setAddSectionLevelId] = useState<string | null>(
    null
  );

  const columns = buildColumns(role, termStarted, ayId, setAddSectionLevelId);

  const facets: FacetConfig[] = [
    ...(levels.length > 1
      ? [
          {
            columnId: 'levelLabel',
            label: 'Level',
            valueOptions: levels.map((l) => l.label),
          },
        ]
      : []),
    {
      columnId: 'schedule',
      label: 'Schedule',
      valueOptions: Object.values(SCHEDULE_LABELS),
    },
  ];

  const isRegistrarPlus =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

  return (
    <>
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
      <NewSectionButton
        levels={levelOptions}
        ayCode={ayCode}
        open={addSectionLevelId !== null}
        onOpenChange={(open) => {
          if (!open) setAddSectionLevelId(null);
        }}
        initialLevelId={addSectionLevelId ?? undefined}
      />
    </>
  );
}
