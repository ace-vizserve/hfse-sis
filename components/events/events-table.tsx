'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { closeRegistration, copyLink } from '@/components/events/event-actions';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { RowActionsMenu } from '@/components/ui/data-table/row-actions-menu';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  builderHref,
  formatClosesAt,
  formatEventDate,
  stripTrailingStop,
} from '@/lib/events/display';
import { EVENT_STATUS_LABELS, type EventStatus } from '@/lib/events/event';
import type { EventListRow } from '@/lib/events/staff';
import { cn } from '@/lib/utils';

// The Parent events list. Rows arrive newest first; the tabs are the
// lifecycle. "Opens soon" events sit under Open: they are published and
// waiting for their opening time.

export type EventsTableRow = EventListRow & { link: string };

const STATUS_CLASS: Record<EventStatus, string> = {
  open: 'border-brand-mint bg-brand-mint/30 text-ink',
  upcoming: 'border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  not_published: 'border-brand-amber bg-brand-amber/20 text-ink',
  closed: 'border-destructive/40 bg-destructive/10 text-destructive',
  past: 'border-border bg-card text-muted-foreground',
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-6 whitespace-nowrap px-2.5 text-xs font-medium',
        STATUS_CLASS[status]
      )}
    >
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  );
}

const isOpenTab = (r: EventListRow) =>
  r.status === 'open' || r.status === 'upcoming';

export function EventsTable({ rows }: { rows: EventsTableRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<EventsTableRow, unknown>[]>(
    () => [
      {
        id: 'event',
        accessorFn: (r) => r.title,
        header: ({ column }) => (
          <SortableHeader column={column}>Event</SortableHeader>
        ),
        meta: { label: 'Event' },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-56">
            <Link
              href={`/sis/admin/events/${row.original.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {row.original.title}
            </Link>
            {row.original.venue && (
              <div className="text-xs text-muted-foreground">
                {row.original.venue}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'date',
        accessorFn: (r) => r.startsOn,
        header: ({ column }) => (
          <SortableHeader column={column}>Date</SortableHeader>
        ),
        meta: { label: 'Date' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {formatEventDate(row.original.startsOn, row.original.endsOn)}
          </span>
        ),
      },
      {
        id: 'for',
        accessorFn: (r) => stripTrailingStop(r.scopeLabel),
        header: 'For',
        meta: { label: 'For' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {stripTrailingStop(row.original.scopeLabel)}
          </span>
        ),
      },
      {
        id: 'closes',
        accessorFn: (r) => r.closesAt,
        header: ({ column }) => (
          <SortableHeader column={column}>Registration closes</SortableHeader>
        ),
        meta: { label: 'Registration closes' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatClosesAt(row.original.closesAt)}
          </span>
        ),
      },
      {
        id: 'registered',
        accessorFn: (r) => `${r.registered} / ${r.eligible}`,
        sortingFn: (a, b) => a.original.registered - b.original.registered,
        header: ({ column }) => (
          <SortableHeader column={column}>Registered</SortableHeader>
        ),
        meta: { label: 'Registered' },
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === 'not_published') {
            return <span className="text-sm text-muted-foreground">—</span>;
          }
          const pct = r.eligible
            ? Math.round((r.registered / r.eligible) * 100)
            : 0;
          return (
            <div className="whitespace-nowrap">
              <div className="flex items-center gap-2.5">
                <span className="text-sm tabular-nums">
                  <span className="font-semibold">{r.registered}</span> /{' '}
                  {r.eligible}
                </span>
                <div
                  role="progressbar"
                  aria-label={`${r.title} registered`}
                  aria-valuemin={0}
                  aria-valuemax={r.eligible}
                  aria-valuenow={r.registered}
                  className="h-1.5 w-14 overflow-hidden rounded-full bg-hairline"
                >
                  <div
                    className="h-full rounded-full bg-brand-mint"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {r.notJoining > 0 && (
                <div className="text-xs text-muted-foreground">
                  {r.notJoining} not joining
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'status',
        accessorFn: (r) => EVENT_STATUS_LABELS[r.status],
        header: 'Status',
        meta: { label: 'Status' },
        enableSorting: false,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const canClose = r.status === 'open' || r.status === 'upcoming';
          return (
            <RowActionsMenu>
              <DropdownMenuItem asChild>
                <Link href={`/sis/admin/events/${r.id}`}>
                  View registrations
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={builderHref(r.id)}>Edit event</Link>
              </DropdownMenuItem>
              {r.status !== 'not_published' && (
                <DropdownMenuItem onSelect={() => copyLink(r.link)}>
                  Copy link
                </DropdownMenuItem>
              )}
              {canClose && (
                <DropdownMenuItem
                  onSelect={() =>
                    closeRegistration(r.id, () => router.refresh())
                  }
                >
                  Close registration
                </DropdownMenuItem>
              )}
            </RowActionsMenu>
          );
        },
      },
    ],
    [router]
  );

  return (
    <DataTable<EventsTableRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={[(r) => r.title, (r) => r.venue]}
      searchPlaceholder="Search by event or venue"
      statusTabs={[
        {
          value: 'not-published',
          label: 'Not published',
          predicate: (r) => r.status === 'not_published',
          emptyState: {
            icon: CalendarDays,
            title: 'No drafts.',
            body: 'New event starts one.',
          },
        },
        {
          value: 'open',
          label: 'Open',
          predicate: isOpenTab,
          isDefault: true,
          emptyState: {
            icon: CalendarDays,
            title: 'Nothing is open for registration.',
            body: 'Publish an event from its builder and it shows here.',
          },
        },
        {
          value: 'closed',
          label: 'Closed',
          predicate: (r) => r.status === 'closed',
        },
        { value: 'past', label: 'Past', predicate: (r) => r.status === 'past' },
        { value: 'all', label: 'All', predicate: () => true },
      ]}
      url={{ enabled: true, namespace: 'events' }}
      pageSize={50}
      csv={{ filename: 'parent-events.csv' }}
      emptyState={{
        icon: CalendarDays,
        title: 'No events yet.',
        body: 'Use New event to set up the first one.',
      }}
      emptyFilteredState={{
        title: 'Nothing matches.',
        body: 'Pick another tab or clear the search.',
      }}
    />
  );
}

/** One line above the table, so unfinished events are not forgotten; the
 *  events themselves are on the Not published tab. */
export function NotPublishedStrip({ rows }: { rows: EventsTableRow[] }) {
  const count = rows.filter((r) => r.status === 'not_published').length;
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-card px-4 py-2.5">
      <StatusBadge status="not_published" />
      <span className="text-sm text-foreground">
        {count === 1
          ? "1 event isn't published yet. Parents can't see it."
          : `${count} events aren't published yet. Parents can't see them.`}
      </span>
      <Link
        href="?events.status=not-published"
        scroll={false}
        className="ml-auto text-sm font-medium text-primary hover:underline"
      >
        {count === 1 ? 'Show it' : 'Show them'}
      </Link>
    </div>
  );
}
