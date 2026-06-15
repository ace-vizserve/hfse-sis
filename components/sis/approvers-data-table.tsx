'use client';

import { Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { ApproverAssignDialog } from '@/components/sis/approver-assign-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/ui/status-badge';
import { TABLE_COPY } from '@/lib/copy/data-table';
import {
  APPROVER_FLOW_LABELS,
  type ApproverFlow,
} from '@/lib/schemas/approvers';
import type {
  AllApproversByFlow,
  ApproverUser,
} from '@/lib/sis/approvers/queries';

// ─── Per-row actions (revoke via overflow menu) ───────────────────────────────

function ApproverRowActions({
  assignmentId,
  email,
  flowLabel,
}: {
  assignmentId: string;
  email: string;
  flowLabel: string;
}) {
  const router = useRouter();
  const [revokeOpen, setRevokeOpen] = useState(false);

  const revokeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/admin/approvers/${assignmentId}`, jsonInit('DELETE')),
    onSuccess: () => {
      toast.success(`${email} removed from ${flowLabel}`);
      setRevokeOpen(false);
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    },
  });
  const submitting = revokeMutation.isPending;

  function onConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    revokeMutation.mutate();
  }

  return (
    <>
      <RowActionsMenu>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setRevokeOpen(true);
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Remove
        </DropdownMenuItem>
      </RowActionsMenu>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {email} as an approver?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll stop receiving new requests for {flowLabel} and
              won&apos;t see new ones in their inbox. Pending requests that
              already designated them as primary or secondary stay in their
              inbox until resolved — revocation only affects future teacher
              submissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              disabled={submitting}
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Flat row type ────────────────────────────────────────────────────────────

export type ApproverRow = ApproverUser & {
  flow: ApproverFlow;
  flowLabel: string;
};

// ─── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<ApproverRow>[] = [
  {
    id: 'user',
    accessorFn: (row) => row.display_name ?? row.email,
    header: 'Approver',
    cell: ({ row }) => (
      <div>
        <div className="font-medium text-foreground">
          {row.original.display_name ?? row.original.email}
        </div>
        {row.original.display_name && (
          <div className="font-mono text-[11px] text-muted-foreground">
            {row.original.email}
          </div>
        )}
      </div>
    ),
    enableHiding: false,
  },
  {
    id: 'flow',
    accessorFn: (row) => row.flowLabel,
    header: 'Flow',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">{row.original.flowLabel}</span>
    ),
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return value.includes(row.original.flowLabel);
    },
  },
  {
    id: 'role',
    accessorFn: (row) => row.role ?? 'unknown',
    header: 'Role',
    cell: ({ row }) => {
      const raw = row.original.role ?? 'unknown';
      const label = raw === 'school_admin' ? TABLE_COPY.schoolAdmin : raw;
      return <StatusBadge tone="info">{label}</StatusBadge>;
    },
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const raw = row.original.role ?? 'unknown';
      const label = raw === 'school_admin' ? TABLE_COPY.schoolAdmin : raw;
      return value.includes(label);
    },
  },
  {
    id: 'assigned_at',
    accessorKey: 'assigned_at',
    header: 'Assigned',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {new Date(row.original.assigned_at).toLocaleDateString('en-SG', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <ApproverRowActions
        assignmentId={row.original.assignment_id}
        email={row.original.email}
        flowLabel={row.original.flowLabel}
      />
    ),
  },
];

// ─── Main exported client component ──────────────────────────────────────────

type ApproversDataTableProps = {
  byFlow: AllApproversByFlow;
  candidatesByFlow: Record<
    ApproverFlow,
    Array<{ user_id: string; email: string; role: string }>
  >;
};

export function ApproversDataTable({
  byFlow,
  candidatesByFlow,
}: ApproversDataTableProps) {
  // Flatten all flow-approver pairs into a single row array.
  const rows: ApproverRow[] = (
    Object.entries(byFlow) as [ApproverFlow, ApproverUser[]][]
  ).flatMap(([flow, users]) =>
    users.map((u) => ({
      ...u,
      flow,
      flowLabel: APPROVER_FLOW_LABELS[flow],
    }))
  );

  // Build flow-label options for the Flow facet.
  const flowOptions = (Object.keys(APPROVER_FLOW_LABELS) as ApproverFlow[]).map(
    (f) => APPROVER_FLOW_LABELS[f]
  );

  // Role label options.
  const roleOptions = [TABLE_COPY.schoolAdmin];

  // Assign button in toolbar — one per flow (only one flow currently).
  const assignButtons = (
    Object.keys(APPROVER_FLOW_LABELS) as ApproverFlow[]
  ).map((flow) => (
    <ApproverAssignDialog
      key={flow}
      flow={flow}
      flowLabel={APPROVER_FLOW_LABELS[flow]}
      candidates={candidatesByFlow[flow] ?? []}
    />
  ));

  return (
    <DataTable<ApproverRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.assignment_id}
      searchKeys={[(row) => row.display_name ?? '', 'email', 'flowLabel']}
      searchPlaceholder="Search approver name, email, or flow…"
      facets={[
        {
          columnId: 'flow',
          label: 'Flow',
          valueOptions: flowOptions,
        },
        {
          columnId: 'role',
          label: 'Role',
          valueOptions: roleOptions,
        },
      ]}
      toolbarTrailing={<>{assignButtons}</>}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'approvers' }}
      initialSort={[{ id: 'flow', desc: false }]}
      pageSize={25}
      emptyState={{
        icon: Users,
        title: 'No approvers assigned yet.',
        body: "Teachers can't file requests until at least two approvers are configured.",
      }}
      emptyFilteredState={{
        title: 'No approvers match.',
        body: 'Try clearing filters.',
      }}
    />
  );
}
