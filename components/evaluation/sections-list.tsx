'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ClipboardList, BookOpen, Users } from 'lucide-react';
import Link from 'next/link';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';

export type SectionWriteupProgress = {
  submitted: number;
  active: number;
};

export type SectionCardData = {
  id: string;
  name: string;
  levelId: string | null;
  levelLabel: string | null;
  fcaName: string | null;
  /** Keyed by term id — one entry per AY term the page loaded (T1–T3,
   *  KD #49). Missing entry reads as 0/0, same as a term with no roster. */
  writeupProgress: Record<string, SectionWriteupProgress>;
};

export type SectionTermColumn = {
  id: string;
  /** Compact header, e.g. "T2" — see lib/evaluation/term-short-labels.ts. */
  shortLabel: string;
  label: string;
};

export type LevelOption = { id: string; code: string; label: string };

// Flat, filterable row — replaces the old per-level card grid. The grouping
// is a Level facet. Phase 10 restores write-up progress here as one column
// per AY term (Phase 9 had removed it entirely when de-term-scoping this
// list — the data was never wrong, see phase-10-brief.md).
type EvalSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  fcaName: string | null;
  writeupProgress: Record<string, SectionWriteupProgress>;
};

function deriveRow(s: SectionCardData): EvalSectionRow {
  return {
    id: s.id,
    name: s.name,
    levelLabel: s.levelLabel ?? 'Unknown level',
    fcaName: s.fcaName,
    writeupProgress: s.writeupProgress,
  };
}

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

function buildColumns(
  isTeacher: boolean,
  isOversight: boolean,
  terms: SectionTermColumn[]
): ColumnDef<EvalSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      cell: ({ row }) => (
        <IdentifierLink
          href={
            isOversight
              ? `/evaluation/sections/${row.original.id}`
              : `/classroom/${row.original.id}/write-ups`
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
      cell: ({ row }) => (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {row.original.levelLabel}
        </span>
      ),
      filterFn: facetFilterFn,
    },
    // One column per AY term (T1–T3, KD #49) — "submitted/active" from
    // getWriteupProgressByTerm. A term with zero submissions renders "0/N",
    // never blank and never styled as an error: for the in-progress term
    // that's the honest reading, not a defect (phase-10-brief.md).
    ...terms.map(
      (t): ColumnDef<EvalSectionRow> => ({
        id: `writeups_${t.id}`,
        accessorFn: (r) => r.writeupProgress[t.id]?.submitted ?? 0,
        header: ({ column }) => (
          <SortableHeader column={column}>{t.shortLabel}</SortableHeader>
        ),
        cell: ({ row }) => {
          const p = row.original.writeupProgress[t.id];
          return (
            <span className="font-mono text-xs tabular-nums text-foreground">
              {p?.submitted ?? 0}/{p?.active ?? 0}
            </span>
          );
        },
        enableSorting: true,
        sortingFn: 'basic',
      })
    ),
    ...(!isTeacher
      ? ([
          {
            accessorKey: 'fcaName',
            header: ({ column }) => (
              <SortableHeader column={column}>Adviser</SortableHeader>
            ),
            cell: ({ row }) => <AdviserCell name={row.original.fcaName} />,
          },
        ] as ColumnDef<EvalSectionRow>[])
      : []),
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const { id, name } = row.original;
        return (
          <RowActionsMenu>
            <DropdownMenuItem asChild>
              <Link href={`/evaluation/sections/${id}`}>
                <ClipboardList className="size-3.5" />
                Open write-ups
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/markbook/grading?grading.section=${encodeURIComponent(name)}`}
              >
                <BookOpen className="size-3.5" />
                Open grading
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/sis/sections/${id}`}>
                <Users className="size-3.5" />
                Open roster
              </Link>
            </DropdownMenuItem>
          </RowActionsMenu>
        );
      },
    },
  ];
}

export function EvaluationSectionsList({
  sections,
  levels,
  terms,
  isTeacher = false,
  isOversight,
}: {
  sections: SectionCardData[];
  levels: LevelOption[];
  /** The AY's T1–T3 terms (KD #49) — one write-up progress column each. */
  terms: SectionTermColumn[];
  isTeacher?: boolean;
  /** From lib/classroom/scope.ts's resolver (Phase 8, design doc
   *  2026-07-28-classroom-workspace-design.md) — decides the row link
   *  target: a teacher lands in Classroom's Write-ups tab for that class;
   *  oversight lands on this module's own section detail (unchanged).
   *  Never re-derive this from role inline. */
  isOversight: boolean;
}) {
  const rows = sections.map(deriveRow);
  const columns = buildColumns(isTeacher, isOversight, terms);

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
    <DataTable<EvalSectionRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={['name', 'levelLabel']}
      searchPlaceholder="Search section or level…"
      facets={facets}
      initialSort={[
        { id: 'levelLabel', desc: false },
        { id: 'name', desc: false },
      ]}
      pageSize={25}
      csv={{ filename: 'evaluation-sections.csv' }}
      url={{ enabled: true, namespace: 'sections' }}
      emptyState={{
        icon: ClipboardList,
        title: 'No sections to evaluate.',
        body: 'Sections you advise (or, for registrars, all sections) appear here once the roster is synced.',
      }}
      emptyFilteredState={{
        title: 'No sections match the current filters.',
        body: 'Try a different level, or clear the search.',
      }}
    />
  );
}
