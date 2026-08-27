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
import { formatDayRange, formatFiledAt } from '@/lib/declarations/format';

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
  /**
   * How the whole filing ended. `pending` while it is still moving.
   *
   * ⚠ NOT the same as the step's own status. A turned-down filing's LAST step
   * may read `waiting` forever — the request stopped before reaching it — so
   * reading the step would call a rejected filing "not started".
   */
  outcome: 'pending' | 'approved' | 'rejected' | 'cancelled';
  /** Who ended it. Null while it is still moving. */
  decidedByName: string | null;
  decidedAt: string | null;
  filedAt: string;
  detail: StaffDeclarationView;
  /** Stage order → the people on it, already resolved to names server-side. */
  peopleByStageOrder: Record<number, string>;
  /** Stage order → who decided it. */
  decidedByNames: Record<number, string>;
};

export function DeclarationsQueueTable({
  rows,
  counts,
  openRequestId,
}: {
  rows: DeclarationQueueRow[];
  counts: {
    forYou: number;
    waiting: number;
    approved: number;
    rejected: number;
  };
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
      // ⚠ ONE COLUMN, TWO MEANINGS, decided by whether the filing is finished.
      // A finished row has nothing to be "yours to decide" about; what somebody
      // wants from it is how it ended and who ended it. Splitting these into
      // two columns would leave each one blank half the time.
      cell: ({ row }) => {
        const r = row.original;
        if (r.outcome === 'approved') {
          return (
            <div className="min-w-0">
              <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
                Approved
              </Badge>
              {r.decidedByName && (
                <p className="mt-1 truncate text-[12px] text-muted-foreground">
                  by {r.decidedByName}
                </p>
              )}
            </div>
          );
        }
        if (r.outcome === 'cancelled') {
          // Nothing produces this today — no screen withdraws a filing. It is
          // in the status list, so it is rendered rather than silently falling
          // through to "With someone else", which would be a lie.
          return (
            <Badge variant="secondary" className="h-6">
              Withdrawn
            </Badge>
          );
        }
        if (r.outcome === 'rejected') {
          return (
            <div className="min-w-0">
              <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
                Not approved
              </Badge>
              {r.decidedByName && (
                <p className="mt-1 truncate text-[12px] text-muted-foreground">
                  by {r.decidedByName}
                </p>
              )}
            </div>
          );
        }
        return r.canDecide ? (
          // §9.3 healthy recipe — this is the row you can move forward.
          <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
            Yours to decide
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-6">
            With someone else
          </Badge>
        );
      },
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
            {row.original.canDecide
              ? 'Read and decide'
              : row.original.outcome === 'pending'
                ? 'Read'
                : 'View history'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      {/* ⚠ THE COUNT STRIP IS GONE, and it went in two steps because only the
          second one was obvious.
          It read "Waiting for you · Waiting in total · Approved · Not
          approved". The first two were the SAME NUMBERS as the first two tab
          badges a few inches below — Mr Ace: *"remove the waiting for you
          waiting in total section its redundant no?"* Trimming it to the
          outcome split left a full-width bar holding two figures, which he
          then cut outright: *"just remove this section bro what is that for?"*
          He was right twice. The Decided tab already says how many filings are
          settled, and splitting that into approved-versus-not is a question
          you ask ON that tab, where the rows themselves answer it.
          `counts` stays — the tabs read it to decide which one opens. */}

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
            isDefault: counts.forYou > 0,
          },
          {
            value: 'waiting',
            label: 'Everything waiting',
            predicate: (row) => row.outcome === 'pending',
            isDefault: counts.forYou === 0 && counts.waiting > 0,
          },
          {
            // ⚠ The history tab, and the reason it exists: before this, a
            // filing vanished the moment it was decided and there was nowhere
            // to see what had happened to it. An adviser who approved
            // something was never told whether the officer agreed.
            value: 'decided',
            label: 'Decided',
            predicate: (row) => row.outcome !== 'pending',
            isDefault: counts.forYou === 0 && counts.waiting === 0,
          },
        ]}
        facets={[
          { columnId: 'className', label: 'Class' },
          { columnId: 'stageLabel', label: 'Step' },
        ]}
        initialSort={[{ id: 'filedAt', desc: false }]}
        emptyState={{
          icon: Inbox,
          title: 'Nothing here yet',
          body: 'When a parent tells the school a child will be away, it will appear here for you to approve — and it stays on the Decided tab once it has been settled.',
        }}
        emptyFilteredState={{
          title: 'Nothing matches that',
          body: 'Clear the filters to see everything again.',
        }}
        csv={{ filename: 'declarations' }}
        // The tab, the search and the filters live in the address bar, so a
        // queue can be linked to and survives a reload or a back button.
        // ⚠ This table was the only staff queue that had never opted in —
        // change requests, the validation queues and the grading tables all
        // pass this already. Namespaced so the `?filing=` deep link the
        // attendance sheet builds cannot collide with a facet key.
        url={{ enabled: true, namespace: 'decl' }}
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
