'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  CalendarClock,
  ChevronRight,
  GalleryHorizontalEndIcon,
  ListIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type {
  FacetConfig,
  MeScopeConfig,
  StatusTabConfig,
} from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import type { ValidationQueueRow } from '@/lib/admissions/document-validation';

import { RejectDialog } from './reject-dialog';
import { TriagePane } from './triage-pane';

type Props = {
  rows: ValidationQueueRow[];
  ayCode: string;
  /**
   * May the viewer approve or reject? Gates the actions column, the triage
   * mode, and the reject dialog — everything that writes.
   *
   * Defaults to FALSE deliberately: a caller who forgets to pass it renders a
   * read-only queue rather than buttons that 403. That was the live bug this
   * prop fixes — the page admitted `school_admin` (read-only oversight per
   * KD #74 + KD #31) while the PATCH route deliberately excludes them, and
   * this component took no viewer prop at all, so it rendered Approve/Reject
   * to everyone who could open the page. Its P-Files sibling
   * (components/p-files/document-validation/awaiting-queue.tsx) had always
   * gated correctly on `isOfficer`; this side was the outlier.
   */
  canValidate?: boolean;
};

function ValidationGroupHeader({
  rows,
  isExpanded,
  toggle,
  ayCode,
}: {
  rows: ValidationQueueRow[];
  isExpanded: boolean;
  toggle: () => void;
  ayCode: string;
}) {
  const first = rows[0];
  return (
    // A <button> can't legally contain the <a> that IdentifierLink
    // renders (HTML forbids interactive content inside <button>) — use
    // a keyboard-accessible div instead (role="button" + tabIndex +
    // Enter/Space handling), same substitution React docs recommend
    // whenever a clickable container must wrap a link.
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      aria-expanded={isExpanded}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          isExpanded && 'rotate-90'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/* IdentifierLink doesn't accept onClick — wrap it so the link
            navigates without also toggling the group (the wrapping
            div's onClick would otherwise fire on every click inside). */}
        <span onClick={(e) => e.stopPropagation()}>
          <IdentifierLink
            href={`/admissions/applications/${encodeURIComponent(first.enroleeNumber)}?ay=${encodeURIComponent(ayCode)}`}
          >
            {first.fullName}
          </IdentifierLink>
        </span>
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {first.enroleeNumber}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.levelApplied ?? '—'}
      </span>
      <Badge variant="outline">{first.applicationStatus}</Badge>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}

export function ValidationQueue({
  rows: initialRows,
  ayCode,
  canValidate = false,
}: Props) {
  const [mode, setMode] = React.useState<'table' | 'triage'>('table');
  const [rows, setRows] = React.useState<ValidationQueueRow[]>(initialRows);
  const [actingKey, setActingKey] = React.useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    React.useState<ValidationQueueRow | null>(null);

  // Sync from server when initialRows changes (router.refresh after a successful action).
  React.useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // Single-list now — STP docs were removed from the enrollment workflow
  // (migration 050; parents file directly with ICA). All remaining rows
  // are general admissions slots.
  const tabRows = rows;

  const rowKey = React.useCallback(
    (r: ValidationQueueRow) => `${r.enroleeNumber}::${r.slotKey}`,
    []
  );

  type PatchBody =
    | { status: 'Valid' }
    | { status: 'Rejected'; rejectionReason: string };

  // Tier-1 optimistic mutation. The list is local state mirrored from the RSC
  // `initialRows` (not a useQuery cache), so the optimistic target is `rows`:
  // onMutate snapshots + removes the row immediately, onError restores it.
  //
  // The optimistic snapshot and its rollback stay on `useMutation` — that is
  // exactly why `useWriteAction` wraps the promise rather than replacing the
  // mutation. Only the toast and the refresh move. The bespoke error message
  // (route's `body.error`) is preserved via ApiError.message, and per-row
  // `actingKey` keeps the existing per-row disable.
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: ValidationQueueRow; body: PatchBody }) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(row.enroleeNumber)}/document/${encodeURIComponent(row.slotKey)}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', body)
      ),
    onMutate: ({ row }) => {
      const key = rowKey(row);
      setActingKey(key);
      // Snapshot the current rows for rollback. Capture from the closure (the
      // latest committed value — RQ uses the freshest onMutate each render),
      // NOT from inside the setRows updater, which runs later at commit time.
      const prev = rows;
      setRows((r) => r.filter((x) => rowKey(x) !== key));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setRows(ctx.prev); // rollback the optimistic removal
    },
    onSettled: () => setActingKey(null),
  });

  const run = useWriteAction();

  // Keeps the `Promise<boolean>` contract TriagePane + RejectDialog depend on
  // (true → advance / close). `run` resolves `undefined` on failure, and the
  // rollback has already happened by then.
  const patchStatus = React.useCallback(
    async (row: ValidationQueueRow, body: PatchBody): Promise<boolean> => {
      const result = await run(
        () => statusMutation.mutateAsync({ row, body }),
        {
          // The row leaves the queue the instant it is clicked, so a pending
          // toast would narrate a change already on screen. The refresh is
          // still awaited underneath — it is what corrects the SSR badge count
          // — and the success toast lands once that count is real.
          pending: false,
          success: `${row.slotLabel} ${body.status === 'Valid' ? 'approved' : 'rejected'}.`,
          error: (e) =>
            e instanceof Error ? e.message : 'Could not save the change.',
        }
      );
      return result !== undefined;
    },
    [run, statusMutation]
  );

  const columns = React.useMemo<ColumnDef<ValidationQueueRow>[]>(
    () => [
      {
        accessorKey: 'slotLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Document</SortableHeader>
        ),
        meta: { label: 'Document' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{row.original.slotLabel}</Badge>
            {row.original.isExpirable && (
              <Badge variant="warning">Expires</Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'owner',
        header: 'Owner',
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wider"
          >
            {row.original.owner}
          </Badge>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'levelApplied',
        header: ({ column }) => (
          <SortableHeader column={column}>Level</SortableHeader>
        ),
        meta: { label: 'Level' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.levelApplied ?? '—'}
          </span>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'applicationStatus',
        header: 'App status',
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.applicationStatus}</Badge>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        id: 'preview',
        header: 'Preview',
        cell: ({ row }) => (
          <a
            href={row.original.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open file
          </a>
        ),
      },
      // Spread, not a conditional cell: a viewer who can't act sees no column
      // at all rather than an empty one, matching the sibling queue.
      ...(canValidate
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }) => {
                const key = rowKey(row.original);
                const busy = actingKey === key;
                return (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busy}
                      onClick={() =>
                        void patchStatus(row.original, { status: 'Valid' })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setRejectTarget(row.original)}
                    >
                      Reject
                    </Button>
                  </div>
                );
              },
            } satisfies ColumnDef<ValidationQueueRow>,
          ]
        : []),
    ],
    [actingKey, ayCode, canValidate, patchStatus, rowKey]
  );

  // Facets: document type, owner, level, app status. The shell renders
  // each as a multi-select chip dropdown via FacetDropdown.
  const facets: FacetConfig[] = React.useMemo(
    () => [
      { columnId: 'slotLabel', label: 'Document' },
      { columnId: 'owner', label: 'Owner' },
      { columnId: 'levelApplied', label: 'Level' },
      { columnId: 'applicationStatus', label: 'App status' },
    ],
    []
  );

  // Status tabs split by application-pipeline stage so registrars can
  // triage Submitted (fresh upload — first review) vs Ongoing Verification
  // / Processing (later stages, often re-uploads after a Rejected). All
  // tab keeps the unfiltered view.
  const statusTabs: StatusTabConfig<ValidationQueueRow>[] = React.useMemo(
    () => [
      { value: 'all', label: 'All', predicate: () => true, isDefault: true },
      {
        value: 'submitted',
        label: 'Submitted',
        predicate: (r) => r.applicationStatus === 'Submitted',
      },
      {
        value: 'ongoing',
        label: 'Ongoing',
        predicate: (r) => r.applicationStatus === 'Ongoing Verification',
      },
      {
        value: 'processing',
        label: 'Processing',
        predicate: (r) => r.applicationStatus === 'Processing',
      },
    ],
    []
  );

  // Expires-only toggle (passport / pass / parent-pass slots). The
  // predicate has nothing to do with the viewer so we opt in via
  // `enabled: true` + `userId: null` per MeScopeConfig JSDoc.
  const expiresScope: MeScopeConfig<ValidationQueueRow> = React.useMemo(
    () => ({
      enabled: true,
      userId: null,
      label: 'Expirable only',
      icon: CalendarClock,
      predicate: (r) => r.isExpirable,
    }),
    []
  );

  // Toolbar: mode toggle. Triage exists to approve or reject one document at a
  // time, so it has nothing to offer a read-only viewer.
  const modeToggle = !canValidate ? null : (
    <div className="flex items-center gap-1 rounded-lg border border-hairline p-0.5">
      <Toggle
        size="sm"
        pressed={mode === 'table'}
        onPressedChange={() => setMode('table')}
        aria-label="Table view"
      >
        <ListIcon className="size-3.5" />
        <span className="ml-1.5 text-xs">Table</span>
      </Toggle>
      <Toggle
        size="sm"
        pressed={mode === 'triage'}
        onPressedChange={() => setMode('triage')}
        aria-label="Triage mode"
      >
        <GalleryHorizontalEndIcon className="size-3.5" />
        <span className="ml-1.5 text-xs">Triage</span>
      </Toggle>
    </div>
  );

  if (mode === 'triage' && canValidate) {
    return (
      <div className="space-y-4">
        <TriagePane
          rows={tabRows}
          ayCode={ayCode}
          actingKey={actingKey}
          onApprove={(row) => patchStatus(row, { status: 'Valid' })}
          onReject={(row, reason) =>
            patchStatus(row, { status: 'Rejected', rejectionReason: reason })
          }
          onExit={() => setMode('table')}
          headerToggle={modeToggle}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={tabRows}
        getRowId={rowKey}
        searchKeys={['fullName', 'enroleeNumber', 'slotLabel']}
        searchPlaceholder="Search student or document…"
        facets={facets}
        statusTabs={statusTabs}
        meScope={expiresScope}
        toolbarTrailing={modeToggle}
        // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
        url={{ enabled: true, namespace: 'validation' }}
        pageSize={25}
        // Level + status render once in the group header (keyed by enroleeNumber); hide the redundant per-row
        // cells while keeping both columns filterable via their facets.
        initialColumnVisibility={{
          levelApplied: false,
          applicationStatus: false,
        }}
        expandable={{
          enabled: true,
          groupBy: (row) => row.enroleeNumber,
          renderGroupHeader: ({ rows, isExpanded, toggle }) => (
            <ValidationGroupHeader
              rows={rows}
              isExpanded={isExpanded}
              toggle={toggle}
              ayCode={ayCode}
            />
          ),
        }}
      />
      {canValidate && (
        <RejectDialog
          open={rejectTarget != null}
          onOpenChange={(open) => {
            if (!open) setRejectTarget(null);
          }}
          slotLabel={rejectTarget?.slotLabel ?? ''}
          studentName={rejectTarget?.fullName ?? ''}
          onConfirm={async (reason) => {
            if (!rejectTarget) return;
            const ok = await patchStatus(rejectTarget, {
              status: 'Rejected',
              rejectionReason: reason,
            });
            if (ok) setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}
