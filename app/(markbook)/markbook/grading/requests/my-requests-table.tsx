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
import { MyRequestsCancelButton } from './my-requests-cancel-button';

export type MyRequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  /** Human-readable label derived from field_changed + slot_index, e.g. "W2", "QA". */
  field_label: string;
  /** Raw field_changed value — used as facet key. */
  field_changed: string;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: ChangeRequestStatus;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  decision_note: string | null;
  applied_at: string | null;
  approved_at: string | null;
  rejection_undone_at: string | null;
  // Per-designee reviewer columns (migration 044). When both are set the
  // request was co-signed; the teacher sees both names in the Reason cell.
  primary_reviewed_by_email: string | null;
  secondary_reviewed_by_email: string | null;
  // Context fields populated by the loader join.
  sectionName?: string | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  termLabel?: string | null;
};

// TODO(loader-join): surface section/subject/term/student per spec §5.8
// so the identifier link can deep-link to the student or grading sheet.
// Deferred until the loader join lands.

const FIELD_LABELS: Record<string, string> = {
  ww_scores: 'Written work',
  pt_scores: 'Performance task',
  qa_score: 'Quarterly assessment',
  letter_grade: 'Letter grade',
  is_na: 'N/A flag',
};

function statusLabel(s: ChangeRequestStatus): string {
  return CHANGE_REQUEST_STATUS_CONFIG[s].label;
}

const COLUMNS: ColumnDef<MyRequestRow>[] = [
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
  },
  {
    accessorKey: 'field_changed',
    header: 'Field',
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {row.original.field_label}
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
    accessorKey: 'sectionName',
    header: ({ column }) => (
      <SortableHeader column={column}>Section</SortableHeader>
    ),
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
  },
  {
    accessorKey: 'reason_category',
    header: 'Reason',
    cell: ({ row }) => (
      <div className="text-xs text-muted-foreground">
        {row.original.reason_category.replace(/_/g, ' ')}
        {row.original.decision_note && (
          <div className="mt-0.5 line-clamp-1 text-[11px]">
            Note: {row.original.decision_note}
          </div>
        )}
        <ReviewerLine row={row.original} />
      </div>
    ),
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
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2">
        {row.original.status === 'approved' ? (
          // Approved-but-not-yet-applied: promote the deep-link to a filled
          // CTA so the teacher can jump straight to the locked sheet and
          // see the approved change ready to be applied. The registrar
          // does the actual apply (Hard Rule #5 + #6); teacher's CTA is
          // labelled "View" to reflect their read-only role.
          <Button asChild size="sm" className="h-8">
            <Link href={`/markbook/grading/${row.original.grading_sheet_id}`}>
              View approved sheet
            </Link>
          </Button>
        ) : (
          <Link
            href={`/markbook/grading/${row.original.grading_sheet_id}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-4"
          >
            Sheet
            <ArrowUpRight className="size-3" />
          </Link>
        )}
        {row.original.status === 'pending' && (
          <MyRequestsCancelButton requestId={row.original.id} />
        )}
      </div>
    ),
  },
];

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

const CSV_CONFIG: CsvConfig<MyRequestRow> = {
  filename: 'my-change-requests.csv',
  columns: [
    {
      header: 'Filed',
      accessor: (r) =>
        new Date(r.requested_at).toLocaleString('en-SG', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
    },
    { header: 'Field', accessor: (r) => r.field_label },
    { header: 'From', accessor: (r) => r.current_value ?? '(blank)' },
    { header: 'To', accessor: (r) => r.proposed_value },
    { header: 'Reason', accessor: (r) => r.reason_category.replace(/_/g, ' ') },
    { header: 'Status', accessor: (r) => statusLabel(r.status) },
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

export function MyRequestsTable({ data }: { data: MyRequestRow[] }) {
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
      columns={COLUMNS}
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
