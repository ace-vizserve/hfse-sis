'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight, GalleryHorizontalEndIcon, ListIcon } from 'lucide-react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import type { PFileValidationRow } from '@/lib/p-files/document-validation';

import { RejectDialog } from './reject-dialog';
import { TriagePane } from './triage-pane';

type Props = {
  rows: PFileValidationRow[];
  ayCode: string;
  isOfficer: boolean;
};

function AwaitingGroupHeader({
  rows,
  isExpanded,
  toggle,
}: {
  rows: PFileValidationRow[];
  isExpanded: boolean;
  toggle: () => void;
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
            href={`/p-files/${encodeURIComponent(first.enroleeNumber)}`}
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
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {first.classSection ?? '—'}
      </span>
      <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
        {rows.length} document{rows.length === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}

export function AwaitingQueue({ rows: initialRows, ayCode, isOfficer }: Props) {
  const [mode, setMode] = React.useState<'table' | 'triage'>('table');
  const [rows, setRows] = React.useState<PFileValidationRow[]>(initialRows);
  const [actingKey, setActingKey] = React.useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    React.useState<PFileValidationRow | null>(null);

  React.useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const rowKey = React.useCallback(
    (r: PFileValidationRow) => `${r.enroleeNumber}::${r.slotKey}`,
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
  // why `useWriteAction` wraps the promise instead of replacing the mutation.
  // Only the toast and the refresh move.
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: PFileValidationRow; body: PatchBody }) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(row.enroleeNumber)}/document/${encodeURIComponent(row.slotKey)}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', body)
      ),
    onMutate: ({ row }) => {
      const key = rowKey(row);
      setActingKey(key);
      // Snapshot the current rows for rollback. Capture from the closure (the
      // latest committed value), NOT from inside the setRows updater, which
      // runs later at commit time and would give a stale snapshot.
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
  // rollback has already run by then.
  const patchStatus = React.useCallback(
    async (row: PFileValidationRow, body: PatchBody): Promise<boolean> => {
      const result = await run(
        () => statusMutation.mutateAsync({ row, body }),
        {
          // The row disappears from the queue the instant it is clicked, so a
          // pending toast would narrate something already visible. The refresh
          // is still awaited underneath — it is what updates the SSR badge
          // count — and the success toast lands when that count is real.
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

  const columns = React.useMemo<ColumnDef<PFileValidationRow>[]>(
    () => [
      {
        accessorKey: 'slotLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Document</SortableHeader>
        ),
        meta: { label: 'Document' },
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.slotLabel}</Badge>
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
        accessorKey: 'studentNumber',
        header: ({ column }) => (
          <SortableHeader column={column}>Student number</SortableHeader>
        ),
        meta: { label: 'Student number' },
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.studentNumber ?? '—'}
          </span>
        ),
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
        accessorKey: 'classSection',
        header: ({ column }) => (
          <SortableHeader column={column}>Section</SortableHeader>
        ),
        meta: { label: 'Section' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.classSection ?? '—'}
          </span>
        ),
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <SortableHeader column={column}>Status</SortableHeader>
        ),
        meta: { label: 'Status' },
        cell: ({ row }) => {
          const s = row.original.status;
          // Not started is the honest label for a slot nothing was ever
          // written to — "Missing" reads like something went wrong, and for
          // most of these the family simply has not sent it yet.
          if (!s)
            return (
              <span className="text-xs text-muted-foreground">Not started</span>
            );
          const tone =
            s === 'Valid'
              ? 'border-brand-mint/40 bg-brand-mint/10 text-foreground'
              : s === 'Uploaded'
                ? 'border-brand-amber/50 bg-brand-amber/10 text-foreground'
                : s === 'Rejected' || s === 'Expired'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-hairline text-muted-foreground';
          return (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] uppercase tracking-wider ${tone}`}
            >
              {s === 'Uploaded' ? 'Needs review' : s}
            </Badge>
          );
        },
        filterFn: 'arrIncludesSome',
      },
      {
        accessorKey: 'expiryDateIso',
        header: ({ column }) => (
          <SortableHeader column={column}>Expiry</SortableHeader>
        ),
        meta: { label: 'Expiry' },
        // The date you are actually being asked to accept when approving a
        // renewed passport or pass. Blank on every other document — they have
        // no expiry column at all.
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.expiryDateIso
              ? new Date(row.original.expiryDateIso).toLocaleDateString(
                  'en-GB',
                  { day: 'numeric', month: 'short', year: 'numeric' }
                )
              : '—'}
          </span>
        ),
      },
      {
        id: 'preview',
        header: 'Preview',
        // No file means nothing to open. The table lists every slot now, so
        // most rows legitimately have none.
        cell: ({ row }) =>
          row.original.fileUrl ? (
            <a
              href={row.original.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Open file
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      ...(isOfficer
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: PFileValidationRow } }) => {
                const key = rowKey(row.original);
                const busy = actingKey === key;
                // Only a document a parent has just sent is awaiting a
                // decision. The table lists every slot now, so most rows have
                // nothing to approve — an Approve button on a slot with no
                // file would mark an empty document valid.
                if (row.original.status !== 'Uploaded') return null;
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
            } satisfies ColumnDef<PFileValidationRow>,
          ]
        : []),
    ],
    [actingKey, isOfficer, patchStatus, rowKey]
  );

  const facets: FacetConfig[] = React.useMemo(
    () => [
      { columnId: 'slotLabel', label: 'Document' },
      { columnId: 'status', label: 'Status' },
      { columnId: 'owner', label: 'Owner' },
      { columnId: 'levelApplied', label: 'Level' },
      { columnId: 'classSection', label: 'Section' },
    ],
    []
  );

  const modeToggle = isOfficer ? (
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
  ) : null;

  if (mode === 'triage' && isOfficer) {
    return (
      <TriagePane
        rows={rows}
        actingKey={actingKey}
        onApprove={(row) => patchStatus(row, { status: 'Valid' })}
        onReject={(row, reason) =>
          patchStatus(row, { status: 'Rejected', rejectionReason: reason })
        }
        onExit={() => setMode('table')}
        headerToggle={modeToggle}
      />
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={rows}
        getRowId={rowKey}
        // Student number included so every student on the page can be found
        // by any of the three things anyone actually knows them by.
        searchKeys={['fullName', 'studentNumber', 'enroleeNumber', 'slotLabel']}
        searchPlaceholder="Search student or document…"
        facets={facets}
        toolbarTrailing={modeToggle ?? undefined}
        // Namespaced so this queue's filters persist and are shareable without
        // colliding with the Applicants queue's (KD #84). Kept after the
        // Expiring queue was removed — the namespace is what makes the URL
        // state unambiguous, not how many tables happen to exist today.
        url={{ enabled: true, namespace: 'awaiting' }}
        pageSize={25}
        // Level + section render once in the group header (keyed by enroleeNumber); hide the redundant per-row
        // cells while keeping both columns filterable via their facets.
        initialColumnVisibility={{ levelApplied: false, classSection: false }}
        expandable={{
          enabled: true,
          groupBy: (row) => row.enroleeNumber,
          renderGroupHeader: ({ rows, isExpanded, toggle }) => (
            <AwaitingGroupHeader
              rows={rows}
              isExpanded={isExpanded}
              toggle={toggle}
            />
          ),
        }}
      />
      {isOfficer && (
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
