'use client';

import * as React from 'react';
import { Trophy } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { EventTypePill } from '@/components/house-points/event-type-pill';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { EventSummary } from '@/lib/house-points/queries';
import {
  ENTRANT_KIND_FILTER_LABELS,
  NO_POINTS_YET,
  eventWinnerIds,
  matchesAny,
} from '@/lib/house-points/sheet-filters';
import {
  EVENT_TYPE_SHORT_LABELS,
  formatEventDate,
  formatPoints,
} from '@/lib/house-points/standings';
import { houseTileClass, type HouseRow } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// The year's events, one row each, with the points every house took from it.
//
// ⚠ Each row's highest house value is bold in that house's `-deep` ink. The
// classes come from the literal map below — never `text-${token}-deep`:
// Tailwind emits no class it cannot read in the source, so an interpolated
// name compiles to nothing, silently.

const EVENT_TYPE_LABELS = EVENT_TYPE_SHORT_LABELS;

const HOUSE_LEAD_INK: Record<string, string> = {
  'house-1': 'font-semibold text-house-1-deep',
  'house-2': 'font-semibold text-house-2-deep',
  'house-3': 'font-semibold text-house-3-deep',
  'house-4': 'font-semibold text-house-4-deep',
};

function houseLeadInk(colourToken: string): string {
  return HOUSE_LEAD_INK[colourToken] ?? 'font-semibold text-foreground';
}

const formatDate = formatEventDate;

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
      header: ({ column }) => (
        <SortableHeader column={column}>Type</SortableHeader>
      ),
      meta: { label: 'Type' },
      cell: ({ row }) => <EventTypePill type={row.original.eventType} />,
      enableSorting: true,
      filterFn: (row, _id, value) =>
        matchesAny(value, [EVENT_TYPE_LABELS[row.original.eventType]]),
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
    // The three below exist to be filtered on. They start hidden — the row
    // already shows its type, and the leading house is already in bold — but
    // each can be switched on from Columns, and exports as plain words when
    // it is.
    {
      id: 'enteredAs',
      accessorFn: (r) => ENTRANT_KIND_FILTER_LABELS[r.entrantKind],
      header: 'Entered as',
      meta: { label: 'Entered as' },
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {ENTRANT_KIND_FILTER_LABELS[row.original.entrantKind]}
        </span>
      ),
      enableSorting: false,
      filterFn: (row, _id, value) =>
        matchesAny(value, [
          ENTRANT_KIND_FILTER_LABELS[row.original.entrantKind],
        ]),
    },
    {
      id: 'wonBy',
      accessorFn: (r) => winnerNames(r, houses).join(', '),
      header: 'Won by',
      meta: { label: 'Won by' },
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {winnerNames(row.original, houses).join(', ')}
        </span>
      ),
      enableSorting: false,
      // A tie lists every house on it, so the event is found under each.
      filterFn: (row, _id, value) =>
        matchesAny(value, winnerNames(row.original, houses)),
    },
  ];
}

/** The house(s) that took the most points from an event, or "No points yet". */
function winnerNames(event: EventSummary, houses: HouseRow[]): string[] {
  const nameById = new Map(houses.map((h) => [h.id, h.name]));
  const ids = eventWinnerIds(
    event.totals,
    houses.map((h) => h.id)
  );
  return ids.length > 0
    ? ids.map((id) => nameById.get(id) ?? '')
    : [NO_POINTS_YET];
}

/** Helper columns hidden until switched on from Columns. */
const HIDDEN_HELPER_COLUMNS = {
  enteredAs: false,
  wonBy: false,
};

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
      {
        columnId: 'enteredAs',
        label: 'Entered as',
        valueOptions: (['student', 'team', 'house'] as const)
          .filter((k) => events.some((e) => e.entrantKind === k))
          .map((k) => ENTRANT_KIND_FILTER_LABELS[k]),
      },
      {
        columnId: 'wonBy',
        label: 'Won by',
        valueOptions: [...houses.map((h) => h.name), NO_POINTS_YET],
      },
    ],
    [events, houses]
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
              ? 'Create an event for each competition, add who took part, and pick the award each one won. Every house total on this page adds up from there.'
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
        initialColumnVisibility={HIDDEN_HELPER_COLUMNS}
        url={{ enabled: true, namespace: 'house-points' }}
        initialSort={[{ id: 'event', desc: false }]}
        pageSize={25}
        csv={{ filename: `house-points-${ayCode}.csv` }}
        emptyFilteredState={{
          title: 'No events match.',
          body: 'Clear the search or a filter to see more events.',
        }}
      />

      {/* Year totals. DataTable has no footer row, so the sum sits in its own
          card directly beneath. It is always the WHOLE year — the search and filters
          above narrow the rows, not these figures. */}
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
