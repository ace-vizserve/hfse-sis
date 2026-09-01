'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  type FacetConfig,
  type StatusTabConfig,
  type CsvConfig,
} from '@/components/ui/data-table/types';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  CHANGE_REQUEST_STATUS_CONFIG,
  type ChangeRequestStatus,
} from '@/lib/markbook/change-request-status';
import { ApprovalHistoryDialog } from '@/components/approvals/approval-history-dialog';
import { toPlainText } from '@/lib/rich-text';
import {
  buildGradeChangeEvents,
  markChangeFieldLabel,
  markChangeHistorySubtitle,
} from '@/lib/activity/events';
import { MyRequestsCancelButton } from './my-requests-cancel-button';

export type MyRequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  /** Human-readable label derived from field_changed + slot_index, e.g. "W2", "QA". */
  field_label: string;
  /** Raw field_changed value — used as facet key. */
  field_changed: string;
  /** Only set for ww_scores/pt_scores — feeds the History dialog's title
   *  via `markChangeFieldLabel`, which needs it to say "Written Work 2"
   *  rather than just "Written Work". */
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: ChangeRequestStatus;
  requested_by: string;
  requested_by_email: string;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  decision_note: string | null;
  applied_by: string | null;
  applied_at: string | null;
  approved_at: string | null;
  rejection_undone_at: string | null;
  // Per-designee reviewer columns (migration 044). When both are set the
  // request was co-signed; the teacher sees both names in the Reason cell.
  // `primary_reviewed_by` is the id half — used by the History dialog to
  // resolve a name via nameById rather than showing the reviewer's email.
  primary_reviewed_by: string | null;
  primary_reviewed_by_email: string | null;
  // Co-sign trail (migration 044) — `secondary_reviewed_by_email` alone
  // already fed `ReviewerLine`'s "Co-signed by A and B"; the id + timestamp
  // are new here so the History dialog can emit the co-sign as its own
  // event instead of showing only the first signature.
  secondary_reviewed_by: string | null;
  secondary_reviewed_by_email: string | null;
  secondary_reviewed_at: string | null;
  // ⚠ F1 — what the second reviewer decided. Distinct from `status`: a
  // secondary DECLINE after a primary APPROVE leaves `status` at 'approved'
  // (`decide.ts`), so the History dialog must read this column, not status,
  // to tell a co-sign from a co-decline.
  secondary_decision: 'approved' | 'rejected' | null;
  // The child this mark change is about — resolved server-side via a left
  // embed through grade_entries → section_students → students (never
  // `!inner`: a student the join can't resolve must still show up in the
  // queue, just with the 'a student' fallback baked in at the source).
  studentLabel: string;
  // Context fields populated by the loader join.
  sectionName?: string | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  termLabel?: string | null;
};

function statusLabel(s: ChangeRequestStatus): string {
  return CHANGE_REQUEST_STATUS_CONFIG[s].label;
}

// A function, not a module-level constant, because the "actions" column's
// History dialog needs `nameById` and `viewerId` — both only known once the
// component has its props. Built inside a `useMemo` below so identity stays
// stable across renders that don't change either input.
function buildColumns(
  nameById: ReadonlyMap<string, string>,
  viewerId: string,
  /**
   * Request id → the approver's decision note with the formatting taken off.
   *
   * ⚠ A MAP AND NOT A CALL IN THE CELL. The note is written in the formatting
   * editor, so `decision_note` holds HTML; the Reason cell shows it under
   * `line-clamp-1` as a one-line "Note: …" trailer, which must be plain. But
   * stripping means parsing, and a cell renderer runs per row on every sort,
   * filter, page and tab change — so it is done once, over `data`, in the
   * component below.
   */
  plainDecisionNoteById: ReadonlyMap<string, string>
): ColumnDef<MyRequestRow>[] {
  return [
    {
      accessorKey: 'requested_at',
      header: ({ column }) => (
        <SortableHeader column={column}>Filed</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {new Date(row.original.requested_at).toLocaleString('en-SG', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      ),
      // Raw ISO timestamp isn't presentable as-is in a CSV — CSV_CONFIG's
      // "Filed" extra column supplies the same formatting as the on-screen cell.
      meta: { excludeFromExport: true, label: 'Filed' },
    },
    {
      accessorKey: 'field_changed',
      header: 'Field',
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {row.original.field_label}
        </span>
      ),
      // Raw value (e.g. "ww_scores") isn't the friendly label shown on screen
      // — CSV_CONFIG's "Field" extra exports field_label instead.
      meta: { excludeFromExport: true },
      filterFn: (row, id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        return Array.isArray(value)
          ? value.includes(row.getValue(id))
          : row.getValue(id) === value;
      },
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
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
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
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
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
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
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
      // Composite cell with no accessor value to export — CSV_CONFIG's
      // "From"/"To" extras carry the two values as separate columns instead.
      meta: { excludeFromExport: true },
    },
    {
      accessorKey: 'reason_category',
      header: 'Reason',
      cell: ({ row }) => {
        const note = plainDecisionNoteById.get(row.original.id) ?? '';
        return (
          <div className="text-xs text-muted-foreground">
            {row.original.reason_category.replace(/_/g, ' ')}
            {note && (
              <div className="mt-0.5 line-clamp-1 text-[11px]">
                Note: {note}
              </div>
            )}
            <ReviewerLine row={row.original} />
          </div>
        );
      },
      // Raw snake_case value isn't presentable — CSV_CONFIG's "Reason" extra
      // exports the humanized version shown on screen.
      meta: { excludeFromExport: true },
    },
    {
      id: 'req_status',
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const cfg = CHANGE_REQUEST_STATUS_CONFIG[row.original.status];
        const Icon = cfg.icon;
        return (
          <Badge variant={cfg.variant}>
            <Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        );
      },
      // Raw enum value isn't the friendly label — CSV_CONFIG's "Status" extra
      // exports statusLabel() instead.
      meta: { excludeFromExport: true },
      filterFn: (row, id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        return Array.isArray(value)
          ? value.includes(row.getValue(id))
          : row.getValue(id) === value;
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <ApprovalHistoryDialog
              trigger={
                <Button variant="ghost" size="sm">
                  History
                </Button>
              }
              title={`${r.studentLabel} — ${markChangeFieldLabel(
                r.field_changed,
                r.slot_index ?? null
              )}`}
              subtitle={markChangeHistorySubtitle(r)}
              events={buildGradeChangeEvents({
                id: r.id,
                fieldChanged: r.field_changed,
                slotIndex: r.slot_index ?? null,
                currentValue: r.current_value ?? null,
                proposedValue: r.proposed_value,
                studentLabel: r.studentLabel,
                requestedById: r.requested_by,
                requestedByEmail: r.requested_by_email,
                requestedAt: r.requested_at,
                status: r.status,
                reviewedById: r.primary_reviewed_by,
                reviewedByEmail:
                  r.primary_reviewed_by_email ?? r.reviewed_by_email,
                reviewedAt: r.reviewed_at,
                decisionNote: r.decision_note ?? null,
                secondaryReviewedById: r.secondary_reviewed_by,
                secondaryReviewedByEmail: r.secondary_reviewed_by_email,
                secondaryReviewedAt: r.secondary_reviewed_at,
                secondaryDecision: r.secondary_decision,
                appliedById: r.applied_by,
                appliedAt: r.applied_at,
                viewerId,
                nameById,
                // ⚠ F8 — this page reads no `searchParams`, so a `?req=` here
                // is a deep link to nowhere. The panel's own teacher href
                // (feed.ts) already omits it for the same reason.
                href: '/markbook/grading/requests',
              })}
            />
            {r.status === 'approved' ? (
              // Approved-but-not-yet-applied: promote the deep-link to a
              // filled CTA so the teacher can jump straight to the locked
              // sheet and see the approved change ready to be applied. The
              // registrar does the actual apply (Hard Rule #5 + #6);
              // teacher's CTA is labelled "View" to reflect their
              // read-only role.
              <Button asChild size="sm" className="h-8">
                <Link href={`/markbook/grading/${r.grading_sheet_id}`}>
                  View approved sheet
                </Link>
              </Button>
            ) : (
              <Link
                href={`/markbook/grading/${r.grading_sheet_id}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-4"
              >
                Sheet
                <ArrowUpRight className="size-3" />
              </Link>
            )}
            {r.status === 'pending' && (
              <MyRequestsCancelButton requestId={r.id} />
            )}
          </div>
        );
      },
    },
  ];
}

const STATUS_TABS: StatusTabConfig<MyRequestRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
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

// These pair with the `meta: { excludeFromExport: true }` on-screen columns
// above (requested_at / field_changed / change / reason_category /
// req_status) — each humanizes a raw value that isn't presentable as-is,
// and defaults to checked so a same-day export looks the same as before
// this table had a picker at all.
const CSV_CONFIG: CsvConfig<MyRequestRow> = {
  filename: 'my-change-requests.csv',
  extraColumns: [
    {
      id: 'csv_filed',
      header: 'Filed',
      defaultChecked: true,
      accessor: (r) =>
        new Date(r.requested_at).toLocaleString('en-SG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
    },
    {
      id: 'csv_field',
      header: 'Field',
      defaultChecked: true,
      accessor: (r) => r.field_label,
    },
    {
      id: 'csv_from',
      header: 'From',
      defaultChecked: true,
      accessor: (r) => r.current_value ?? '(blank)',
    },
    {
      id: 'csv_to',
      header: 'To',
      defaultChecked: true,
      accessor: (r) => r.proposed_value,
    },
    {
      id: 'csv_reason',
      header: 'Reason',
      defaultChecked: true,
      accessor: (r) => r.reason_category.replace(/_/g, ' '),
    },
    {
      id: 'csv_status',
      header: 'Status',
      defaultChecked: true,
      accessor: (r) => statusLabel(r.status),
    },
  ],
};

// Reviewer attribution line — surfaces co-sign pairing to the teacher so
// they know who actually decided their request. Hidden while pending.
function ReviewerLine({ row }: { row: MyRequestRow }) {
  const primary = row.primary_reviewed_by_email ?? row.reviewed_by_email;
  const secondary = row.secondary_reviewed_by_email;
  if (!primary && !secondary) return null;
  if (primary && secondary) {
    return (
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        Co-signed by{' '}
        <span className="font-medium text-foreground">{primary}</span>
        {' and '}
        <span className="font-medium text-foreground">{secondary}</span>
      </div>
    );
  }
  return (
    <div className="mt-0.5 text-[11px] text-muted-foreground">
      Reviewed by{' '}
      <span className="font-medium text-foreground">
        {primary ?? secondary}
      </span>
    </div>
  );
}

export function MyRequestsTable({
  data,
  nameEntries,
  viewerId,
}: {
  data: MyRequestRow[];
  /** userId → display-name, from `getStaffDisplayNameById()` on the server.
   *  Resolves the History dialog's actors to real names instead of raw
   *  emails or uuids. */
  nameEntries: Array<[string, string]>;
  /** The signed-in viewer's id. On this page the viewer filed every row
   *  shown, so the History dialog's first row reads "You asked to
   *  change …" rather than the teacher's own name. */
  viewerId: string;
}) {
  const nameById = useMemo(() => new Map(nameEntries), [nameEntries]);
  // Once per data change, never per cell render — see the note on the
  // `plainDecisionNoteById` parameter above.
  const plainDecisionNoteById = useMemo(
    () =>
      new Map(
        data
          .filter((r) => r.decision_note)
          .map((r) => [r.id, toPlainText(r.decision_note)] as const)
      ),
    [data]
  );
  const columns = useMemo(
    () => buildColumns(nameById, viewerId, plainDecisionNoteById),
    [nameById, viewerId, plainDecisionNoteById]
  );

  // Status is the status-tab dimension (below) — not duplicated as a facet.
  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        columnId: 'field_changed',
        label: 'Field changed',
        valueOptions: Array.from(
          new Set(data.map((r) => r.field_changed))
        ).sort(),
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
    ],
    [data]
  );

  return (
    <DataTable<MyRequestRow>
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={['field_label', 'reason_category', 'proposed_value']}
      searchPlaceholder="Search field, reason, value…"
      facets={facets}
      statusTabs={STATUS_TABS}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'myreq' }}
      initialSort={[{ id: 'requested_at', desc: true }]}
      pageSize={25}
      pageSizeOptions={[10, 25, 50]}
      csv={CSV_CONFIG}
      emptyState={{ title: "You haven't filed any change requests yet." }}
      emptyFilteredState={{ title: 'No requests match the current filter.' }}
    />
  );
}
