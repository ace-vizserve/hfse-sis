'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { GalleryHorizontalEndIcon, ListIcon } from 'lucide-react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { FacetConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Toggle } from '@/components/ui/toggle';
import type { PFileValidationRow } from '@/lib/p-files/document-validation';

import { RejectDialog } from './reject-dialog';
import { TriagePane } from './triage-pane';

type Props = {
  rows: PFileValidationRow[];
  ayCode: string;
  isOfficer: boolean;
};

export function AwaitingQueue({ rows: initialRows, ayCode, isOfficer }: Props) {
  const router = useRouter();
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
  // onSuccess router.refresh()es so the SSR badge count updates (Model A).
  // The route's bespoke `body.error` message is preserved via ApiError.message.
  // Per-row `actingKey` keeps the existing per-row disable.
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
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) setRows(ctx.prev); // rollback the optimistic removal
      toast.error(
        e instanceof Error ? e.message : 'Could not save the change.'
      );
    },
    onSuccess: (_data, { row, body }) => {
      const verb = body.status === 'Valid' ? 'approved' : 'rejected';
      toast.success(`${row.slotLabel} ${verb}.`);
      router.refresh();
    },
    onSettled: () => setActingKey(null),
  });

  // Keeps the `Promise<boolean>` contract TriagePane + RejectDialog depend on
  // (true → advance / close). Resolves false on error (rollback already done).
  const patchStatus = React.useCallback(
    async (row: PFileValidationRow, body: PatchBody): Promise<boolean> => {
      try {
        await statusMutation.mutateAsync({ row, body });
        return true;
      } catch {
        return false;
      }
    },
    [statusMutation]
  );

  const columns = React.useMemo<ColumnDef<PFileValidationRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <IdentifierLink
              href={`/p-files/${encodeURIComponent(row.original.enroleeNumber)}`}
            >
              {row.original.fullName}
            </IdentifierLink>
            <div className="font-mono text-[10px] text-muted-foreground">
              {row.original.enroleeNumber}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'slotLabel',
        header: ({ column }) => (
          <SortableHeader column={column}>Document</SortableHeader>
        ),
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
        accessorKey: 'levelApplied',
        header: ({ column }) => (
          <SortableHeader column={column}>Level</SortableHeader>
        ),
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
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.classSection ?? '—'}
          </span>
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
      ...(isOfficer
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: PFileValidationRow } }) => {
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
            } satisfies ColumnDef<PFileValidationRow>,
          ]
        : []),
    ],
    [actingKey, isOfficer, patchStatus, rowKey]
  );

  const facets: FacetConfig[] = React.useMemo(
    () => [
      { columnId: 'slotLabel', label: 'Document' },
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
        searchKeys={['fullName', 'enroleeNumber', 'slotLabel']}
        searchPlaceholder="Search student or document…"
        facets={facets}
        toolbarTrailing={modeToggle ?? undefined}
        // Distinct namespace from the sibling Expiring queue on this same page
        // so the two tables' filters don't collide in the URL (KD #84).
        url={{ enabled: true, namespace: 'awaiting' }}
        initialSort={[{ id: 'fullName', desc: false }]}
        pageSize={25}
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
