'use client';

import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { EventType } from '@/lib/house-points/compute';
import type { EventSummary } from '@/lib/house-points/queries';
import { houseTileClass, type HouseRow } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// The year's events, one row each, with the points every house took from it.
//
// ⚠ Each row's highest house value is bold in that house's `-deep` ink. The
// classes come from the literal map below — never `text-${token}-deep`:
// Tailwind emits no class it cannot read in the source, so an interpolated
// name compiles to nothing, silently.

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  internal: 'Internal',
  external: 'External',
  major: 'Major event',
  attendance: 'Attendance',
};

const HOUSE_LEAD_INK: Record<string, string> = {
  'house-1': 'font-semibold text-house-1-deep',
  'house-2': 'font-semibold text-house-2-deep',
  'house-3': 'font-semibold text-house-3-deep',
  'house-4': 'font-semibold text-house-4-deep',
};

function houseLeadInk(colourToken: string): string {
  return HOUSE_LEAD_INK[colourToken] ?? 'font-semibold text-foreground';
}

function formatPoints(value: number): string {
  return value.toLocaleString('en-SG', { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  // Slash form parses as local time; a bare yyyy-mm-dd is UTC midnight and
  // can shift a day outside SGT.
  return new Date(iso.replace(/-/g, '/')).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** A house's colour at chip scale, always followed by its name (§9.3). */
function HouseSwatch({ colourToken }: { colourToken: string }) {
  return (
    <span
      className={cn(
        'size-3 shrink-0 rounded-full shadow-brand-tile',
        houseTileClass(colourToken)
      )}
      aria-hidden
    />
  );
}

function buildColumns(houses: HouseRow[]): ColumnDef<EventSummary, unknown>[] {
  const houseColumns: ColumnDef<EventSummary, unknown>[] = houses.map(
    (house) => ({
      id: `house-${house.code}`,
      accessorFn: (r) => r.totals[house.id] ?? 0,
      header: ({ column }) => (
        <div className="flex justify-end">
          <SortableHeader column={column} align="right">
            <span className="inline-flex items-center gap-1.5">
              <HouseSwatch colourToken={house.colourToken} />
              {house.name}
            </span>
          </SortableHeader>
        </div>
      ),
      meta: { label: house.name },
      cell: ({ row }) => {
        const value = row.original.totals[house.id] ?? 0;
        const values = houses.map((h) => row.original.totals[h.id] ?? 0);
        const top = Math.max(...values);
        const leads = top > 0 && value === top;
        return (
          <div
            className={cn(
              'text-right tabular-nums',
              leads ? houseLeadInk(house.colourToken) : 'text-muted-foreground'
            )}
          >
            {formatPoints(value)}
          </div>
        );
      },
      enableSorting: true,
    })
  );

  return [
    {
      id: 'event',
      accessorFn: (r) => r.name,
      header: ({ column }) => (
        <SortableHeader column={column}>Event</SortableHeader>
      ),
      meta: { label: 'Event' },
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <IdentifierLink
            href={`/records/house-points/${encodeURIComponent(row.original.id)}`}
          >
            {row.original.name}
          </IdentifierLink>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {row.original.heldOn ? formatDate(row.original.heldOn) : 'No date'}
          </div>
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    },
    {
      id: 'type',
      accessorFn: (r) => EVENT_TYPE_LABELS[r.eventType],
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant="outline">
          {EVENT_TYPE_LABELS[row.original.eventType]}
        </Badge>
      ),
      enableSorting: false,
      filterFn: (row, _id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        const label = EVENT_TYPE_LABELS[row.original.eventType];
        return Array.isArray(value) ? value.includes(label) : label === value;
      },
    },
    {
      id: 'participants',
      accessorKey: 'entrantCount',
      header: ({ column }) => (
        <div className="flex justify-end">
          <SortableHeader column={column} align="right">
            Participants
          </SortableHeader>
        </div>
      ),
      meta: { label: 'Participants' },
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-foreground">
          {row.original.entrantCount.toLocaleString('en-SG')}
        </div>
      ),
      enableSorting: true,
    },
    ...houseColumns,
  ];
}

type Props = {
  events: EventSummary[];
  houses: HouseRow[];
  /** The year's totals per house id — the same figures as the stat cards. */
  totals: Record<string, number>;
  ayCode: string;
  canEdit: boolean;
  /** Writers only: the "New event" control, shown in the empty state. */
  emptyAction?: React.ReactNode;
};

export function EventsTable({
  events,
  houses,
  totals,
  ayCode,
  canEdit,
  emptyAction,
}: Props) {
  const columns = React.useMemo(() => buildColumns(houses), [houses]);

  const facets = React.useMemo(
    () => [
      {
        columnId: 'type',
        label: 'Type',
        valueOptions: Array.from(
          new Set(events.map((e) => EVENT_TYPE_LABELS[e.eventType]))
        ),
      },
    ],
    [events]
  );

  // No events at all: the empty state stands on its own (§7.6) rather than
  // inside an empty table, so the writer's "New event" can sit beneath it.
  if (events.length === 0) {
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Trophy}
          title="No events yet"
          body={
            canEdit
              ? 'Create an event for each competition, add who took part, and enter their scores. Every house total on this page adds up from there.'
              : 'Events appear here once they are created.'
          }
          className={canEdit && emptyAction ? 'pb-4' : undefined}
        />
        {canEdit && emptyAction ? (
          <div className="flex justify-center pb-12">{emptyAction}</div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <DataTable<EventSummary>
        data={events}
        columns={columns}
        getRowId={(row) => row.id}
        searchKeys={[(r) => r.name]}
        searchPlaceholder="Search events"
        facets={facets}
        url={{ enabled: true, namespace: 'house-points' }}
        pageSize={25}
        csv={{ filename: `house-points-${ayCode}.csv` }}
        emptyFilteredState={{
          title: 'No events match.',
          body: 'Clear the search or the Type filter.',
        }}
      />

      {/* Year totals. DataTable has no footer row, so the sum sits in its own
          card directly beneath. It is always the WHOLE year — the Type filter
          above narrows the rows, not these figures. */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Year totals
            </p>
            <p className="text-xs text-muted-foreground">
              All {events.length.toLocaleString('en-SG')} event
              {events.length === 1 ? '' : 's'} in {ayCode}
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {houses.map((house) => (
              <div key={house.id} className="flex items-center gap-2">
                <dt className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <HouseSwatch colourToken={house.colourToken} />
                  {house.name}
                </dt>
                <dd className="font-serif text-lg font-semibold tabular-nums text-foreground">
                  {formatPoints(totals[house.id] ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {ayCode} · {events.length} event{events.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
