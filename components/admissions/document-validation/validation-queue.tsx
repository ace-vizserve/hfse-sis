'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarClock,
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
import type { ValidationQueueRow } from '@/lib/admissions/document-validation';

import { RejectDialog } from './reject-dialog';
import { TriagePane } from './triage-pane';

type Props = {
  rows: ValidationQueueRow[];
  ayCode: string;
};

export function ValidationQueue({ rows: initialRows, ayCode }: Props) {
  const router = useRouter();
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

  const patchStatus = React.useCallback(
    async (
      row: ValidationQueueRow,
      body:
        | { status: 'Valid' }
        | { status: 'Rejected'; rejectionReason: string }
    ): Promise<boolean> => {
      const key = rowKey(row);
      setActingKey(key);
      try {
        const res = await fetch(
          `/api/sis/students/${encodeURIComponent(row.enroleeNumber)}/document/${encodeURIComponent(row.slotKey)}?ay=${encodeURIComponent(ayCode)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(err.error ?? 'Could not save the change.');
          return false;
        }
        // Optimistic removal — drop the row from local state.
        setRows((prev) => prev.filter((r) => rowKey(r) !== key));
        const verb = body.status === 'Valid' ? 'approved' : 'rejected';
        toast.success(`${row.slotLabel} ${verb}.`);
        // Trigger SSR refresh so the badge count updates.
        router.refresh();
        return true;
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Could not save the change.'
        );
        return false;
      } finally {
        setActingKey(null);
      }
    },
    [ayCode, router, rowKey]
  );

  const columns = React.useMemo<ColumnDef<ValidationQueueRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <IdentifierLink
              href={`/admissions/applications/${encodeURIComponent(row.original.enroleeNumber)}?ay=${encodeURIComponent(ayCode)}`}
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
      {
        id: 'actions',
        header: '',
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
      },
    ],
    [actingKey, ayCode, patchStatus, rowKey]
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

  // Toolbar: mode toggle.
  const modeToggle = (
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

  if (mode === 'triage') {
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
        initialSort={[{ id: 'fullName', desc: false }]}
        pageSize={25}
      />
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
    </div>
  );
}
