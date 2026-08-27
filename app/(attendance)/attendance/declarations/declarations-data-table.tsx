'use client';

import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { CalendarCheck, Inbox, Plane, Stethoscope } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StaffDeclarationView } from '@/lib/declarations/staff';
import type { DeclarationType } from '@/lib/schemas/declarations';
import { DeclarationDecisionSheet } from './decision-sheet';
import { formatDayRange, formatFiledAt } from './format';

// The queue itself.
//
// ── PATTERN (design-system §5, step 2) ─────────────────────────────────────
// `data table` + `Sheet` — the list-detail shape. The table answers "what is
// waiting and how urgent does it look"; the sheet answers "what exactly did
// the parent send", which is the question you must answer before deciding.
//
// ⚠ THE STEP CHIP IS NOT DECORATION. Numbering here encodes something true:
// approval on this flow really is a sequence, and which step a filing sits on
// is the single most useful thing on the row — it separates "yours to decide"
// from "already past you" from "not yet". Elsewhere in this codebase numbered
// markers would be ornament; here they are the data.

export type DeclarationQueueRow = {
  id: string;
  requestId: string;
  studentName: string;
  studentNumber: string;
  className: string | null;
  declarationType: DeclarationType;
  startDate: string;
  endDate: string;
  dayCount: number;
  withMedical: boolean | null;
  stageLabel: string;
  stageOrder: number;
  stageCount: number;
  waitingOn: 'you' | 'someone else';
  canDecide: boolean;
  filedAt: string;
  detail: StaffDeclarationView;
  /** Stage order → the people on it, already resolved to names server-side. */
  peopleByStageOrder: Record<number, string>;
  /** Stage order → who decided it. */
  decidedByNames: Record<number, string>;
};

export function DeclarationsQueueTable({
  rows,
  forYou,
  openRequestId,
}: {
  rows: DeclarationQueueRow[];
  forYou: number;
  /**
   * A request to open on arrival, from `?req=` — how the notification bell
   * hands somebody straight to the filing it told them about.
   *
   * ⚠ Held as state seeded once, not read on every render. Reading the URL
   * each time would re-open the sheet the moment the reader closed it, since
   * the query string is still there.
   */
  openRequestId?: string;
}) {
  const [openRow, setOpenRow] = useState<DeclarationQueueRow | null>(
    () => rows.find((r) => r.requestId === openRequestId) ?? null
  );

  const columns: ColumnDef<DeclarationQueueRow>[] = [
    {
      accessorKey: 'studentName',
      header: ({ column }) => (
        <SortableHeader column={column}>Child</SortableHeader>
      ),
      meta: { label: 'Child' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-foreground">
            {row.original.studentName}
          </p>
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground">
            {row.original.studentNumber}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'className',
      header: ({ column }) => (
        <SortableHeader column={column}>Class</SortableHeader>
      ),
      meta: { label: 'Class' },
      cell: ({ row }) => (
        <span className="text-[14px] text-foreground">
          {row.original.className ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'declarationType',
      header: ({ column }) => (
        <SortableHeader column={column}>Reason</SortableHeader>
      ),
      meta: { label: 'Reason' },
      cell: ({ row }) => {
        const isTravel = row.original.declarationType === 'travel';
        const Icon = isTravel
          ? Plane
          : row.original.withMedical
            ? Stethoscope
            : CalendarCheck;
        return (
          <div className="flex items-center gap-2">
            <Icon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-[14px] text-foreground">
              {isTravel
                ? 'Travel'
                : row.original.withMedical
                  ? 'Away, with a certificate'
                  : 'Away, no certificate'}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'startDate',
      header: ({ column }) => (
        <SortableHeader column={column}>Days away</SortableHeader>
      ),
      meta: { label: 'Days away' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-[14px] tabular-nums text-foreground">
            {formatDayRange(row.original.startDate, row.original.endDate)}
          </p>
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            {row.original.dayCount === 1
              ? '1 day'
              : `${row.original.dayCount} days`}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'stageLabel',
      header: ({ column }) => (
        <SortableHeader column={column}>Waiting on</SortableHeader>
      ),
      meta: { label: 'Waiting on' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-accent font-mono text-[10px] font-semibold text-accent-foreground tabular-nums">
            {row.original.stageOrder}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] text-foreground">
              {row.original.stageLabel}
            </p>
            <p className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
              Step {row.original.stageOrder} of {row.original.stageCount}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'waitingOn',
      header: 'Yours?',
      meta: { label: 'Yours to decide' },
      cell: ({ row }) =>
        row.original.canDecide ? (
          // §9.3 healthy recipe — this is the row you can move forward.
          <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
            Yours to decide
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-6">
            With someone else
          </Badge>
        ),
    },
    {
      accessorKey: 'filedAt',
      header: ({ column }) => (
        <SortableHeader column={column}>Filed</SortableHeader>
      ),
      meta: { label: 'Filed' },
      cell: ({ row }) => (
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {formatFiledAt(row.original.filedAt)}
        </span>
      ),
    },
    {
      id: 'open',
      header: '',
      meta: { label: 'Open', excludeFromExport: true },
      enableSorting: false,
      // A blank header would show as an unlabelled row in the Columns menu.
      // There is nothing to hide here anyway — it is the row's own action.
      enableHiding: false,
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenRow(row.original)}
          >
            {row.original.canDecide ? 'Read and decide' : 'Read'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        searchKeys={['studentName', 'studentNumber', 'className']}
        searchPlaceholder="Search by child, number or class"
        statusTabs={[
          {
            value: 'yours',
            label: 'Yours to decide',
            predicate: (row) => row.canDecide,
            isDefault: forYou > 0,
          },
          {
            value: 'all',
            label: 'Everything waiting',
            predicate: () => true,
            isDefault: forYou === 0,
          },
        ]}
        facets={[
          { columnId: 'className', label: 'Class' },
          { columnId: 'stageLabel', label: 'Step' },
        ]}
        initialSort={[{ id: 'filedAt', desc: false }]}
        emptyState={{
          icon: Inbox,
          title: 'Nothing waiting',
          body: 'When a parent tells the school a child will be away, it will appear here for you to approve.',
        }}
        emptyFilteredState={{
          title: 'Nothing matches that',
          body: 'Clear the filters to see everything waiting.',
        }}
        csv={{ filename: 'declarations' }}
      />

      <DeclarationDecisionSheet
        row={openRow}
        onOpenChange={(open) => {
          if (!open) setOpenRow(null);
        }}
      />
    </>
  );
}
