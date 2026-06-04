'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { ExternalLink, X } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';

// Map the humanizer's tone bucket → an existing Badge variant.
function actionBadgeVariant(
  action: string
): 'default' | 'secondary' | 'destructive' | 'warning' {
  switch (auditActionTone(action)) {
    case 'destructive':
      return 'destructive';
    case 'warning':
      return 'warning';
    case 'info':
      return 'default';
    default:
      return 'secondary';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttendanceAuditRow = {
  id: string;
  at: string;
  actor_email: string;
  actor_display: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  context: Record<string, unknown>;
};

type PaginationInfo = {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
};

type Props = {
  rows: AttendanceAuditRow[];
  pagination?: PaginationInfo;
  actionOptions: string[];
  actorOptions: string[];
  currentAction: string | null;
  currentActor: string | null;
  currentFrom: string | null;
  currentTo: string | null;
};

// ---------------------------------------------------------------------------
// Helper: derive a section link from a row
// ---------------------------------------------------------------------------

function getSectionLink(row: AttendanceAuditRow): string | null {
  const ctx = row.context;

  if (
    row.action === 'attendance.daily.update' ||
    row.action === 'attendance.daily.correct'
  ) {
    // entity_type === 'section'; entity_id is the section ID
    const sectionId =
      row.entity_id ?? (ctx['section_id'] as string | undefined);
    if (!sectionId) return null;
    const date = ctx['date'] as string | undefined;
    return date
      ? `/attendance/${sectionId}?date=${date}`
      : `/attendance/${sectionId}`;
  }

  if (row.action === 'attendance.import.bulk') {
    const sectionId =
      row.entity_id ??
      (ctx['section_id'] as string | undefined) ??
      (ctx['sectionId'] as string | undefined);
    if (!sectionId) return null;
    return `/attendance/${sectionId}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Columns — no client-side facet filtering (server already filtered)
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<AttendanceAuditRow>[] = [
  {
    accessorKey: 'at',
    header: ({ column }) => (
      <SortableHeader column={column}>When</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
        {new Date(row.original.at).toLocaleString('en-SG', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    ),
  },
  {
    accessorKey: 'actor_display',
    header: ({ column }) => (
      <SortableHeader column={column}>Who</SortableHeader>
    ),
    cell: ({ row }) => (
      <div>
        <span className="text-sm text-foreground">
          {row.original.actor_display}
        </span>
        {row.original.actor_display !== row.original.actor_email && (
          <p className="font-mono text-[10px] text-muted-foreground">
            {row.original.actor_email}
          </p>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'action',
    header: ({ column }) => (
      <SortableHeader column={column}>Action</SortableHeader>
    ),
    cell: ({ row }) => (
      <Badge variant={actionBadgeVariant(row.original.action)}>
        {auditActionLabel(row.original.action)}
      </Badge>
    ),
  },
  {
    id: 'details',
    header: 'Details',
    cell: ({ row }) => (
      <span className="text-muted-foreground text-xs">
        {auditContextSummary(row.original.action, row.original.context)}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'open',
    header: () => <span className="sr-only">Open section</span>,
    cell: ({ row }) => {
      const href = getSectionLink(row.original);
      if (!href) return null;
      return (
        <RowActionsMenu>
          <DropdownMenuItem asChild>
            <Link href={href}>
              <ExternalLink className="size-3.5" />
              Open section
            </Link>
          </DropdownMenuItem>
        </RowActionsMenu>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];

// ---------------------------------------------------------------------------
// Server-filter toolbar
// ---------------------------------------------------------------------------

function AuditFilterToolbar({
  actionOptions,
  actorOptions,
  currentAction,
  currentActor,
  currentFrom,
  currentTo,
}: {
  actionOptions: string[];
  actorOptions: string[];
  currentAction: string | null;
  currentActor: string | null;
  currentFrom: string | null;
  currentTo: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const pushFilter = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      // Reset page to 1 whenever a filter changes
      params.delete('page');
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const hasAnyFilter = !!(
    currentAction ||
    currentActor ||
    currentFrom ||
    currentTo
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Action filter */}
      <Select
        value={currentAction ?? '__all__'}
        onValueChange={(v) =>
          pushFilter({ action: v === '__all__' ? null : v })
        }
      >
        <SelectTrigger className="h-8 w-[200px] text-xs">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All actions</SelectItem>
          {actionOptions.map((a) => (
            <SelectItem key={a} value={a} className="text-xs">
              {auditActionLabel(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Actor filter */}
      <Select
        value={currentActor ?? '__all__'}
        onValueChange={(v) => pushFilter({ actor: v === '__all__' ? null : v })}
      >
        <SelectTrigger className="h-8 w-[200px] text-xs">
          <SelectValue placeholder="All staff" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All staff</SelectItem>
          {actorOptions.map((email) => (
            <SelectItem
              key={email}
              value={email}
              className="font-mono text-[11px]"
            >
              {email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date from */}
      <div className="flex items-center gap-1">
        <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          From
        </label>
        <DatePicker
          value={currentFrom ?? ''}
          onChange={(v) => pushFilter({ from: v || null })}
          placeholder="From date"
          className="h-8 w-[140px] text-xs"
        />
      </div>

      {/* Date to */}
      <div className="flex items-center gap-1">
        <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          To
        </label>
        <DatePicker
          value={currentTo ?? ''}
          onChange={(v) => pushFilter({ to: v || null })}
          placeholder="To date"
          className="h-8 w-[140px] text-xs"
        />
      </div>

      {/* Clear all filters */}
      {hasAnyFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() =>
            pushFilter({ action: null, actor: null, from: null, to: null })
          }
        >
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function AttendanceAuditLogDataTable({
  rows,
  pagination,
  actionOptions,
  actorOptions,
  currentAction,
  currentActor,
  currentFrom,
  currentTo,
}: Props) {
  const router = useRouter();

  const handlePageChange = React.useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set('page', String(newPage));
      router.push(`?${params.toString()}`);
    },
    [router]
  );

  const toolbarLeading = (
    <AuditFilterToolbar
      actionOptions={actionOptions}
      actorOptions={actorOptions}
      currentAction={currentAction}
      currentActor={currentActor}
      currentFrom={currentFrom}
      currentTo={currentTo}
    />
  );

  return (
    <>
      <DataTable<AttendanceAuditRow>
        data={rows}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        searchKeys={['actor_display', 'actor_email', 'action', 'entity_type']}
        searchPlaceholder="Search actor, action, details…"
        toolbarLeading={toolbarLeading}
        initialSort={[{ id: 'at', desc: true }]}
        pageSize={pagination ? Math.max(rows.length, 1) : 25}
        url={{ enabled: false }}
        csv={{ filename: 'attendance-audit-log.csv' }}
        emptyState={{
          title: 'No audit entries yet.',
          body: 'Once daily attendance is recorded, entries appear here.',
        }}
        emptyFilteredState={{
          title: 'No entries match the current filters.',
          body: 'Try clearing the action, actor, or date filters.',
        }}
      />
      {pagination && (
        <div className="flex items-center justify-between rounded-b-xl border border-t-0 border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="text-muted-foreground tabular-nums">
            {pagination.total === 0
              ? 'No entries'
              : `Showing ${((pagination.page - 1) * pagination.pageSize + 1).toLocaleString('en-SG')}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                ).toLocaleString(
                  'en-SG'
                )} of ${pagination.total.toLocaleString('en-SG')}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              ← Prev
            </Button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {pagination.page.toLocaleString('en-SG')} /{' '}
              {pagination.totalPages.toLocaleString('en-SG')}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
