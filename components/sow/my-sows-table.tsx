'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { NotebookPen, Plus } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';

import { NewSowSheet } from '@/components/sow/new-sow-sheet';
import { SowStatusBadge } from '@/components/sow/sow-status-badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { HoverHint } from '@/components/ui/hover-hint';
import type { MySowRow } from '@/lib/sow/access';

export { SowStatusBadge };

// "My schemes of work" (board 1): one row per subject x level the
// teacher holds this term, with the scheme's state and what to do next.
//
// The ONE primary button on this screen is "New SOW". Row actions are outline
// even where the mockup draws them filled ("Fix and resend", "Start SOW"):
// five rows of gradient buttons would be five primary CTAs (09a §9.2).

export type MySowListRow = MySowRow & {
  /** Last year's approved scheme to copy from, for a row not started yet. */
  lastYear: { label: string } | null;
  /** Every class of this level this year, any class type: the drawer's checkboxes. */
  groupSections: { sectionId: string; name: string }[];
  /**
   * The approval step it waits on (in review) or that returned it (returned),
   * from its current submission's ladder. Absent when it was never sent.
   */
  stepLabel?: string | null;
};

export const rowKey = (r: Pick<MySowRow, 'subjectId' | 'levelId'>) =>
  `${r.subjectId}|${r.levelId}`;

/** What the "This week" column says for a row. */
export function thisWeekText(
  row: Pick<MySowListRow, 'sow' | 'stepLabel'>
): string {
  switch (row.sow?.state) {
    case 'draft':
      return 'Not sent for review yet';
    case 'in_review':
      return "Can't be checked until approved";
    case 'returned':
      return row.stepLabel
        ? `${row.stepLabel} left a note`
        : 'Returned with a note';
    default:
      // Approved: the weekly check arrives with the checks themselves.
      return '—';
  }
}

export function MySowsTable({
  rows,
  termLabel,
  ayCode,
  termTabs,
}: {
  rows: MySowListRow[];
  /** "Term 2", for the drawer. */
  termLabel: string;
  ayCode?: string;
  /** The term switcher, set on the left of the action row. */
  termTabs?: ReactNode;
}) {
  // Which row the drawer is for; null = opened from "New SOW", which offers
  // every row not started yet.
  const [sheet, setSheet] = useState<{ open: boolean; key: string | null }>({
    open: false,
    key: null,
  });
  const notStarted = useMemo(() => rows.filter((r) => !r.sow), [rows]);

  const columns = useMemo<ColumnDef<MySowListRow>[]>(
    () => [
      {
        id: 'subject',
        accessorFn: (r) => `${r.subjectName} ${r.levelLabel}`,
        header: 'Subject · level',
        meta: { label: 'Subject and level' },
        enableSorting: false,
        cell: ({ row }) => (
          <span>
            <span className="font-medium text-foreground">
              {row.original.subjectName}
            </span>{' '}
            <span className="text-muted-foreground">
              · {row.original.levelLabel}
            </span>
          </span>
        ),
      },
      {
        id: 'classes',
        accessorFn: (r) => r.classes.map((c) => c.name).join(', '),
        header: 'Classes',
        meta: { label: 'Classes' },
        enableSorting: false,
        cell: ({ row }) => {
          const missing = row.original.myClassesNotOnSow;
          return (
            <div className="space-y-1">
              <p className="text-ink-2">
                {row.original.classes.map((c) => c.name).join(', ') || '—'}
              </p>
              {missing.length > 0 && (
                <p className="text-xs text-brand-amber">
                  {`Your class ${missing.map((c) => c.name).join(', ')} isn't on this scheme of work.`}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: 'status',
        accessorFn: (r) => r.sow?.state ?? 'not_started',
        header: 'Status',
        meta: { label: 'Status' },
        enableSorting: false,
        cell: ({ row }) => (
          <SowStatusBadge
            state={row.original.sow?.state ?? null}
            step={row.original.stepLabel}
          />
        ),
      },
      {
        id: 'thisWeek',
        accessorFn: (r) => thisWeekText(r),
        header: 'This week',
        meta: { label: 'This week' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[13px] text-ink-3">
            {thisWeekText(row.original)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end">
              {r.sow ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/classroom/sow/${r.sow.id}`}>
                    {r.sow.state === 'returned' ? 'Fix and resend' : 'Open'}
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSheet({ open: true, key: rowKey(r) })}
                >
                  Start SOW
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>{termTabs}</div>
        <HoverHint
          wrap
          hint={
            rows.length > 0 && notStarted.length === 0
              ? `Every subject you teach already has a scheme of work for ${termLabel}.`
              : undefined
          }
        >
          <Button
            disabled={notStarted.length === 0}
            onClick={() => setSheet({ open: true, key: null })}
          >
            <Plus className="size-4" />
            New SOW
          </Button>
        </HoverHint>
      </div>

      <DataTable<MySowListRow>
        data={rows}
        columns={columns}
        getRowId={rowKey}
        hidePagination
        emptyState={{
          icon: NotebookPen,
          title: 'No subjects to plan yet.',
          body: 'A scheme of work is written for each subject you teach. Once you are set up as the subject teacher of a class, it appears here.',
        }}
      />

      <NewSowSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        rows={notStarted}
        fixedKey={sheet.key}
        termLabel={termLabel}
        ayCode={ayCode}
      />
    </div>
  );
}
