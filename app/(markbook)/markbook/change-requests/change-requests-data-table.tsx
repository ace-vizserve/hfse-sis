'use client';

import { CalendarIcon, ExternalLink, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import {
  type FacetConfig,
  type MeScopeConfig,
  type StatusTabConfig,
} from '@/components/ui/data-table/types';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  CHANGE_REQUEST_STATUS_CONFIG,
  type ChangeRequestStatus,
} from '@/lib/markbook/change-request-status';
import { TABLE_COPY } from '@/lib/copy/data-table';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChangeRequestDecisionButtons } from './decision-buttons';

// Inline menu-item version of UndoRejectionButton — triggers the same dialog
// but from a DropdownMenuItem so it fits inside RowActionsMenu.
function UndoRejectionMenuItem({ requestId }: { requestId: string }) {
  const [open, setOpen] = React.useState(false);

  // ApiError.message already resolves to the body's `error` field, so
  // `e.message` carries the route's plain-English copy; the original generic
  // fallback is preserved for non-ApiError failures.
  const undoMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${encodeURIComponent(requestId)}`,
        jsonInit('PATCH', { action: 'undo_rejection' })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = React.useState(false);

  async function handleUndo() {
    setBusy(true);
    await run(() => undoMutation.mutateAsync(), {
      pending: 'Undoing the decline…',
      success: 'Decline undone — the request is back to Awaiting Review.',
      error: (e) =>
        e instanceof Error ? e.message : 'Could not undo the decline.',
      onResolved: () => setOpen(false),
    });
    setBusy(false);
  }

  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="text-destructive focus:text-destructive"
      >
        <RotateCcw className="size-3.5" />
        Undo decline
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Undo this decline?</DialogTitle>
            <DialogDescription>
              The request will go back to Awaiting Review. The teacher will see
              the change. You have a 2-hour window from when you declined.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleUndo()}
              disabled={busy}
            >
              {busy ? 'Undoing…' : 'Undo decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type AdminRequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: ChangeRequestStatus;
  requested_by_email: string;
  requested_at: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  applied_by: string | null;
  applied_at: string | null;
  // Per-designee reviewer columns (migration 044). When BOTH are set the
  // request was co-signed by both designated approvers; when only one is
  // set the request is in the legacy single-reviewer shape. The legacy
  // reviewed_by_email above stays as the back-compat fallback.
  primary_reviewed_by_email: string | null;
  secondary_reviewed_by_email: string | null;
  // primary_reviewed_at gates the 2-hour undo window for the rejecting
  // approver; approved_at + rejection_undone_at are the post-decision
  // signals (aging chip on the admin Status cell, audit-trail badge).
  primary_reviewed_at: string | null;
  approved_at: string | null;
  rejection_undone_at: string | null;
  // Context fields populated by the loader join (section/subject/term).
  sectionId?: string | null;
  sectionName?: string | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  termLabel?: string | null;
};

// TODO(loader-join): surface section/subject/term/student per spec §5.2 + §7
// when the change-requests-loader-join-expansion ticket lands.

function fieldLabel(field: string, slot: number | null): string {
  switch (field) {
    case 'ww_scores':
      return slot != null ? `W${slot + 1}` : 'WW';
    case 'pt_scores':
      return slot != null ? `PT${slot + 1}` : 'PT';
    case 'qa_score':
      return 'QA';
    case 'letter_grade':
      return 'Letter';
    case 'is_na':
      return 'N/A';
    default:
      return field;
  }
}

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function endOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

const STATUS_TABS: StatusTabConfig<AdminRequestRow>[] = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  {
    value: 'pending',
    label: 'Pending',
    predicate: (r) => r.status === 'pending',
  },
  {
    value: 'approved',
    label: 'Approved',
    predicate: (r) => r.status === 'approved',
  },
  {
    value: 'applied',
    label: 'Applied',
    predicate: (r) => r.status === 'applied',
  },
  {
    value: 'rejected',
    label: 'Declined',
    predicate: (r) => r.status === 'rejected',
  },
  {
    value: 'cancelled',
    label: 'Cancelled',
    predicate: (r) => r.status === 'cancelled',
  },
];

// Status is the status-tab dimension (below) — not duplicated as a facet.
const FACETS: FacetConfig[] = [
  {
    columnId: 'fieldLabel',
    label: 'Field changed',
  },
  {
    columnId: 'reason_category',
    label: 'Reason',
  },
  {
    columnId: 'sectionName',
    label: 'Section',
  },
  {
    columnId: 'subjectCode',
    label: 'Subject',
  },
  {
    columnId: 'termLabel',
    label: 'Term',
  },
];

// Aging line below the Status pill on approved-but-not-yet-applied rows.
// Tone escalates by days-since-approval so the admin can see at a glance
// which approved requests are stalling. Plain English ("approved today",
// "approved 5 days ago") — no relative-time-library jargon.
function AgingLine({ approvedAt }: { approvedAt: string }) {
  const days = (Date.now() - Date.parse(approvedAt)) / 86_400_000;
  const rounded = Math.floor(days);
  const label =
    rounded <= 0
      ? 'approved today'
      : rounded === 1
        ? 'approved yesterday'
        : `approved ${rounded} days ago`;
  const tone =
    days < 3
      ? 'text-muted-foreground'
      : days < 7
        ? 'text-brand-amber'
        : 'text-destructive';
  return (
    <span
      className={cn(
        'mt-1 block font-mono text-[10px] uppercase tracking-wider tabular-nums',
        tone
      )}
    >
      {label}
    </span>
  );
}

// Reviewer attribution line: shows "Co-signed by …" when both designees
// have acted, "Reviewed by …" when only one has. Hidden when neither has
// reviewed yet (the row is still pending).
function ReviewerLine({ row }: { row: AdminRequestRow }) {
  const primary = row.primary_reviewed_by_email ?? row.reviewed_by_email;
  const secondary = row.secondary_reviewed_by_email;
  if (!primary && !secondary) return null;
  if (primary && secondary) {
    return (
      <div className="mt-1 text-[11px] text-muted-foreground">
        Co-signed by{' '}
        <span className="font-medium text-foreground">{primary}</span>
        {' and '}
        <span className="font-medium text-foreground">{secondary}</span>
      </div>
    );
  }
  return (
    <div className="mt-1 text-[11px] text-muted-foreground">
      Reviewed by{' '}
      <span className="font-medium text-foreground">
        {primary ?? secondary}
      </span>
    </div>
  );
}

export function ChangeRequestsDataTable({
  rows,
  canDecide,
  actorEmail = null,
  showNotAppliedFilter = false,
  initialSheetIdFilter,
  initialRequestId,
  initialAction,
  ayCode,
}: {
  rows: AdminRequestRow[];
  canDecide: boolean;
  /** Current viewer's email — used to gate the rejection-undo button to the
   *  rejecting approver only. Pass from the page RSC's getSessionUser. */
  actorEmail?: string | null;
  /** Registrar-only: enables the "Waiting to be applied" Toggle in the
   *  toolbar (filters to status='approved' AND applied_at IS NULL). The
   *  registrar is the one applying approved requests; school_admin /
   *  superadmin approve but don't apply, so the chip is hidden for them. */
  showNotAppliedFilter?: boolean;
  initialSheetIdFilter?: string;
  initialRequestId?: string | null;
  initialAction?: 'approve' | 'reject' | null;
  ayCode?: string;
}) {
  const [range, setRange] = React.useState<DateRange | undefined>(undefined);
  const [rangeOpen, setRangeOpen] = React.useState(false);
  const [sheetIdFilter, setSheetIdFilter] = React.useState<string | null>(
    initialSheetIdFilter ?? null
  );

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [controlledByRow, setControlledByRow] = React.useState<
    Record<string, { action: 'approve' | 'reject'; nonce: string }>
  >({});

  // Date-filtered rows passed to DataTable
  const dateFilteredRows = React.useMemo(() => {
    return rows.filter((r) => {
      if (sheetIdFilter && r.grading_sheet_id !== sheetIdFilter) return false;
      if (range?.from) {
        const ts = new Date(r.requested_at).getTime();
        const from = startOfDay(range.from).getTime();
        if (ts < from) return false;
        if (range.to) {
          const to = endOfDay(range.to).getTime();
          if (ts > to) return false;
        }
      }
      return true;
    });
  }, [rows, range, sheetIdFilter]);

  // Deep-link: open specific request dialog on mount
  React.useEffect(() => {
    if (!initialRequestId) return;

    const row = rows.find((r) => r.id === initialRequestId);
    const isVisible =
      row != null && dateFilteredRows.some((r) => r.id === initialRequestId);

    if (!row || !isVisible) {
      toast.error("This request isn't visible in the current view.");
      clearReqParams();
      return;
    }

    window.setTimeout(() => {
      const el = document.getElementById(`change-request-row-${row.id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);

    if (!initialAction) {
      clearReqParams();
      return;
    }

    if (row.status !== 'pending') {
      const pastLabel: Record<ChangeRequestStatus, string> = {
        pending: 'pending',
        approved: 'approved',
        applied: 'applied (changes are live)',
        rejected: 'declined',
        cancelled: 'cancelled',
      };
      toast.info(`This request was already ${pastLabel[row.status]}.`);
      clearReqParams();
      return;
    }

    if (!canDecide) {
      toast.error('You do not have permission to decide this request.');
      clearReqParams();
      return;
    }

    setControlledByRow((prev) => ({
      ...prev,
      [row.id]: { action: initialAction, nonce: `${row.id}:${Date.now()}` },
    }));
    clearReqParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearReqParams() {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('req');
    next.delete('action');
    const queryString = next.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname);
  }

  function consumeControlledFor(requestId: string) {
    setControlledByRow((prev) => {
      if (!(requestId in prev)) return prev;
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  }

  // Augment rows with a computed fieldLabel for faceting
  const augmentedRows = React.useMemo(
    () =>
      dateFilteredRows.map((r) => ({
        ...r,
        fieldLabel: fieldLabel(r.field_changed, r.slot_index),
      })),
    [dateFilteredRows]
  );

  type AugmentedRow = (typeof augmentedRows)[number];

  // Registrar-only: "Waiting to be applied" Toggle. The predicate has nothing
  // to do with the viewer — it filters purely on row status/applied_at — so
  // we opt the Toggle in via `enabled: true` and pass `userId: null` to make
  // the absence of user-scoping explicit (per MeScopeConfig JSDoc).
  const notAppliedScope: MeScopeConfig<AugmentedRow> | undefined =
    showNotAppliedFilter
      ? {
          enabled: true,
          userId: null,
          label: TABLE_COPY.changeRequestNotApplied,
          predicate: (r) => r.status === 'approved' && r.applied_at === null,
        }
      : undefined;

  const columns = React.useMemo<ColumnDef<AugmentedRow>[]>(
    () => [
      {
        accessorKey: 'requested_at',
        header: ({ column }) => (
          <SortableHeader column={column}>Filed</SortableHeader>
        ),
        meta: { label: 'Filed' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {new Date(row.original.requested_at).toLocaleString('en-SG', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        ),
      },
      {
        accessorKey: 'requested_by_email',
        header: 'Teacher',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.requested_by_email}</span>
        ),
      },
      {
        accessorKey: 'sectionName',
        header: ({ column }) => (
          <SortableHeader column={column}>Section</SortableHeader>
        ),
        meta: { label: 'Section' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sectionName ?? '—'}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'subjectCode',
        header: ({ column }) => (
          <SortableHeader column={column}>Subject</SortableHeader>
        ),
        meta: { label: 'Subject' },
        cell: ({ row }) => (
          <div>
            <span className="font-mono text-xs text-foreground">
              {row.original.subjectCode ?? '—'}
            </span>
            {row.original.subjectName && (
              <div className="text-[11px] text-muted-foreground">
                {row.original.subjectName}
              </div>
            )}
          </div>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'termLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Term</SortableHeader>
        ),
        meta: { label: 'Term' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.termLabel ?? '—'}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'fieldLabel',
        accessorKey: 'fieldLabel',
        header: 'Field',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
            {row.original.fieldLabel}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'change',
        header: 'Change',
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {row.original.current_value ?? '(blank)'}{' '}
            <span className="text-muted-foreground">→</span>{' '}
            <span className="font-medium">{row.original.proposed_value}</span>
          </span>
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'reason_category',
        header: 'Reason / Justification',
        cell: ({ row }) => (
          <div className="max-w-xs text-xs text-muted-foreground">
            <div className="font-mono text-[10px] uppercase tracking-wider">
              {row.original.reason_category.replace(/_/g, ' ')}
            </div>
            <div className="mt-0.5 line-clamp-2">
              {row.original.justification}
            </div>
            {row.original.decision_note && (
              <div className="mt-1 line-clamp-1 text-[11px]">
                Note: {row.original.decision_note}
              </div>
            )}
            <ReviewerLine row={row.original} />
          </div>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'cr_status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const cfg = CHANGE_REQUEST_STATUS_CONFIG[row.original.status];
          const Icon = cfg.icon;
          return (
            <div>
              <Badge variant={cfg.variant}>
                <Icon className="h-3 w-3" />
                {cfg.label}
              </Badge>
              {row.original.status === 'approved' &&
                row.original.approved_at != null && (
                  <AgingLine approvedAt={row.original.approved_at} />
                )}
            </div>
          );
        },
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const r = row.original;
          // Undo gate: only the rejecting approver, only on rejected rows,
          // only within 2 hours of the rejection. The PATCH endpoint
          // re-checks all three; the client gate is for surface visibility.
          const undoVisible =
            r.status === 'rejected' &&
            actorEmail != null &&
            r.primary_reviewed_by_email === actorEmail &&
            r.primary_reviewed_at != null &&
            Date.now() - Date.parse(r.primary_reviewed_at) < 2 * 60 * 60 * 1000;

          const hasSecondaryActions = !!r.grading_sheet_id || undoVisible;

          return (
            <div
              id={`change-request-row-${r.id}`}
              className="flex items-center justify-end gap-2"
            >
              {canDecide && r.status === 'pending' && (
                <ChangeRequestDecisionButtons
                  requestId={r.id}
                  controlledOpen={controlledByRow[r.id] ?? null}
                  onControlledOpenConsumed={() => consumeControlledFor(r.id)}
                />
              )}
              {hasSecondaryActions && (
                <RowActionsMenu>
                  {r.grading_sheet_id && (
                    <DropdownMenuItem asChild>
                      <Link href={`/markbook/grading/${r.grading_sheet_id}`}>
                        <ExternalLink className="size-3.5" />
                        Open sheet
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {undoVisible && <UndoRejectionMenuItem requestId={r.id} />}
                </RowActionsMenu>
              )}
            </div>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDecide, controlledByRow, actorEmail]
  );

  // Toolbar: date-range picker + sheet ID chip
  const toolbarLeading = (
    <>
      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 gap-2 font-normal',
              !range?.from && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {range?.from ? (
              <span className="font-mono text-[11px] tabular-nums">
                {formatDay(range.from)}
                {range.to ? ` – ${formatDay(range.to)}` : ''}
              </span>
            ) : (
              <span className="text-sm">Any date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={range}
            onSelect={setRange}
            numberOfMonths={2}
            captionLayout="dropdown"
          />
          <div className="flex items-center justify-between border-t border-hairline p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRange(undefined)}
              disabled={!range?.from}
            >
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => setRangeOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {sheetIdFilter && (
        <Badge
          variant="outline"
          className="h-8 gap-1.5 border-border bg-accent px-2.5 font-mono text-[11px] text-accent-foreground"
        >
          Sheet {sheetIdFilter.slice(0, 8)}…
          <button
            type="button"
            onClick={() => setSheetIdFilter(null)}
            aria-label="Clear sheet filter"
            className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
    </>
  );

  return (
    <DataTable<AugmentedRow>
      data={augmentedRows}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={['requested_by_email', 'justification']}
      searchPlaceholder="Search teacher, justification…"
      facets={FACETS}
      statusTabs={STATUS_TABS}
      meScope={notAppliedScope}
      toolbarLeading={toolbarLeading}
      initialSort={[{ id: 'requested_at', desc: true }]}
      pageSize={20}
      csv={{ filename: `change-requests-${ayCode ?? 'export'}.csv` }}
      url={{ enabled: true, namespace: 'requests' }}
      emptyState={{
        title: 'No change requests yet.',
        body: 'When teachers request changes to locked sheets, they appear here.',
      }}
      emptyFilteredState={{
        title: 'No requests match the current filters.',
        body: 'Try clearing some filters or the date range.',
      }}
    />
  );
}
