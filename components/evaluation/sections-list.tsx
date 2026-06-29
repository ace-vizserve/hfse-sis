'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ClipboardList, BookOpen, Users } from 'lucide-react';
import Link from 'next/link';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  type FacetConfig,
  type StatusTabConfig,
} from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge } from '@/components/ui/status-badge';

export type SectionCardData = {
  id: string;
  name: string;
  levelId: string | null;
  levelLabel: string | null;
  active: number;
  submitted: number;
  fcaName: string | null;
};

export type LevelOption = { id: string; code: string; label: string };

type WriteupStatus = 'not_started' | 'in_progress' | 'complete';

// Flat, filterable row — replaces the old per-level card grid. The grouping is
// now a Level facet, and "where do I still owe write-ups" is the status-tab
// split (Not started / In progress / Complete) so the registrar can sort/filter
// instead of scanning cards.
type EvalSectionRow = {
  id: string;
  name: string;
  levelLabel: string;
  active: number;
  submitted: number;
  percent: number;
  status: WriteupStatus;
  fcaName: string | null;
};

const STATUS_LABEL: Record<WriteupStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
};

function deriveRow(s: SectionCardData): EvalSectionRow {
  const percent =
    s.active === 0 ? 0 : Math.round((s.submitted / s.active) * 100);
  const status: WriteupStatus =
    s.active > 0 && s.submitted === s.active
      ? 'complete'
      : s.submitted > 0
        ? 'in_progress'
        : 'not_started';
  return {
    id: s.id,
    name: s.name,
    levelLabel: s.levelLabel ?? 'Unknown level',
    active: s.active,
    submitted: s.submitted,
    percent,
    status,
    fcaName: s.fcaName,
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
  selectedTermId: string,
  isTeacher: boolean
): ColumnDef<EvalSectionRow>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Section</SortableHeader>
      ),
      cell: ({ row }) => (
        <IdentifierLink
          href={`/evaluation/sections/${row.original.id}?term_id=${selectedTermId}`}
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
      id: 'writeups',
      accessorFn: (row) => row.percent,
      header: ({ column }) => (
        <SortableHeader column={column}>Write-ups</SortableHeader>
      ),
      cell: ({ row }) => {
        const { submitted, active, percent } = row.original;
        return (
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[13px] tabular-nums text-foreground">
              {submitted}
              <span className="text-muted-foreground">/{active}</span>
            </span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${
                  percent === 100 ? 'bg-brand-mint' : 'bg-brand-indigo/70'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="w-9 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {percent}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      cell: ({ row }) => {
        const st = row.original.status;
        return (
          <StatusBadge
            tone={
              st === 'complete'
                ? 'healthy'
                : st === 'in_progress'
                  ? 'info'
                  : 'muted'
            }
          >
            {STATUS_LABEL[st]}
          </StatusBadge>
        );
      },
      filterFn: facetFilterFn,
    },
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
              <Link
                href={`/evaluation/sections/${id}?term_id=${selectedTermId}`}
              >
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
  selectedTermId,
  isTeacher = false,
}: {
  sections: SectionCardData[];
  levels: LevelOption[];
  selectedTermId: string;
  isTeacher?: boolean;
}) {
  const rows = sections.map(deriveRow);
  const columns = buildColumns(selectedTermId, isTeacher);

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

  const statusTabs: StatusTabConfig<EvalSectionRow>[] = [
    { value: 'all', label: 'All', predicate: () => true, isDefault: true },
    {
      value: 'not_started',
      label: 'Not started',
      predicate: (r) => r.status === 'not_started',
    },
    {
      value: 'in_progress',
      label: 'In progress',
      predicate: (r) => r.status === 'in_progress',
    },
    {
      value: 'complete',
      label: 'Complete',
      predicate: (r) => r.status === 'complete',
    },
  ];

  return (
    <DataTable<EvalSectionRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={['name', 'levelLabel']}
      searchPlaceholder="Search section or level…"
      facets={facets}
      statusTabs={statusTabs}
      initialSort={[
        { id: 'levelLabel', desc: false },
        { id: 'name', desc: false },
      ]}
      pageSize={25}
      csv={{ filename: 'evaluation-sections.csv' }}
      // Namespace the URL state so the page's own `?term_id=` param isn't read
      // as a phantom facet filter (which zeroes the status-tab counts) or
      // clobbered when the table writes its own state.
      url={{ enabled: true, namespace: 'sections' }}
      emptyState={{
        icon: ClipboardList,
        title: 'No sections to evaluate.',
        body: 'Sections you advise (or, for registrars, all sections) appear here once the roster is synced for this term.',
      }}
      emptyFilteredState={{
        title: 'No sections match the current filters.',
        body: 'Try a different level or status, or clear the search.',
      }}
    />
  );
}
