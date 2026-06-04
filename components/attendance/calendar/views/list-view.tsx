'use client';

// ListView — chronological table of the term's exceptions (closures + events).
// Open (school_day / hbl) days are NOT listed — only non-encodable closures
// and calendar events are noteworthy. Pairs naturally with the date-range
// filter the caller already applies before passing `days` and `events`.
//
// Design system: §5 pattern = data table (DataTable shell + TanStack).
// §10.2 single-source legend: ChartLegendChip color comes from the same
// DAY_TYPE_LEGEND_COLOR / EVENT_CATEGORY_LEGEND_COLOR maps as the Month/Term
// grid chips, so List and Grid cells are pixel-identical.
// Tokens only — no raw hex / slate / zinc (Hard Rule #7).
//
// Row click: the DataTable shell has no onRowClick prop. We implement it with a
// delegated-click div. Each <tr> body row contains an invisible sentinel <span
// data-row-key="…" /> stamped via a leading hidden column. The wrapper's click
// handler walks up/down the DOM to find that span and parses the iso date.

import { useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { CalendarX } from 'lucide-react';

import {
  DAY_TYPE_LEGEND_COLOR,
  EVENT_CATEGORY_LEGEND_COLOR,
} from '@/components/attendance/calendar/calendar-cell';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  CLOSED_REASON_LABELS,
  storageToDayStatus,
} from '@/lib/attendance/calendar-operational';
import {
  AUDIENCE_LABELS,
  EVENT_CATEGORY_LABELS,
  isEncodableDayType,
  type Audience,
} from '@/lib/schemas/attendance';

// ─── Unified row model ────────────────────────────────────────────────────────

type ListRow = {
  /** yyyy-MM-dd — primary sort key. Events use startDate. */
  iso: string;
  /** Human-readable date, e.g. "Mon, 15 Jan 2026" */
  dateLabel: string;
  kind: 'closure' | 'event';
  typeLabel: string;
  /** Gradient color keyed from the same map the calendar grid cells use (§10.2). */
  typeColor: ChartLegendChipColor;
  /** Closure label (null → '—') or event.label. */
  label: string;
  /** Audience value for the Level column. */
  level: Audience;
  /** Events only; closures are always false. */
  tentative: boolean;
};

// ─── Row key helpers ──────────────────────────────────────────────────────────
// Format: "kind|iso|typeLabel". "|" is safe — type labels are plain English.

const KEY_SEP = '|';

function rowKey(row: ListRow): string {
  return `${row.kind}${KEY_SEP}${row.iso}${KEY_SEP}${row.typeLabel}`;
}

function isoFromKey(key: string): string | null {
  const parts = key.split(KEY_SEP);
  return parts.length >= 2 ? (parts[1] ?? null) : null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type ListViewProps = {
  /** Already date/level filtered by the caller. */
  days: SchoolCalendarRow[];
  /** Already date/level/category/tentative filtered by the caller. */
  events: CalendarEventRow[];
  /** Called with the yyyy-MM-dd string when a row is clicked. */
  onRowClick: (iso: string) => void;
};

// ─── Date formatting ──────────────────────────────────────────────────────────

/** yyyy-MM-dd → "Mon, 15 Jan 2026" (local, tz-safe — no UTC shift). */
function formatReadableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3])
  ).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Row builders ─────────────────────────────────────────────────────────────

function buildClosureRows(days: SchoolCalendarRow[]): ListRow[] {
  return days
    .filter((d) => !isEncodableDayType(d.dayType, d.hblOverlay))
    .map((d): ListRow => {
      const status = storageToDayStatus({
        dayType: d.dayType,
        hblOverlay: d.hblOverlay,
      });
      // storageToDayStatus maps every non-encodable DayType to kind='closed'.
      // The 'no_class' fallback satisfies TS narrowing — it is unreachable
      // because isEncodableDayType already excluded 'school_day' and 'hbl'.
      const reason =
        status.kind === 'closed' ? status.reason : ('no_class' as const);
      return {
        iso: d.date,
        dateLabel: formatReadableDate(d.date),
        kind: 'closure',
        typeLabel: CLOSED_REASON_LABELS[reason],
        typeColor: DAY_TYPE_LEGEND_COLOR[d.dayType],
        label: d.label ?? '—',
        level: d.audience,
        tentative: false,
      };
    });
}

function buildEventRows(events: CalendarEventRow[]): ListRow[] {
  return events.map(
    (e): ListRow => ({
      iso: e.startDate,
      dateLabel: formatReadableDate(e.startDate),
      kind: 'event',
      typeLabel: EVENT_CATEGORY_LABELS[e.category],
      typeColor: EVENT_CATEGORY_LEGEND_COLOR[e.category],
      label: e.label,
      level: e.audience,
      tentative: e.tentative,
    })
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────
//
// The leading '_key' column renders an invisible sentinel <span data-row-key>
// that the delegated click handler uses to read the row's iso date. It is
// never visible in the UI (sr-only + aria-hidden) and non-sortable/hideable.

const DATA_COLUMNS: ColumnDef<ListRow>[] = [
  {
    accessorKey: 'iso',
    header: ({ column }) => (
      <SortableHeader column={column}>Date</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-[12px] tabular-nums text-foreground">
        {row.original.dateLabel}
      </span>
    ),
    // iso yyyy-MM-dd strings sort lexicographically == chronologically.
    sortingFn: 'alphanumeric',
  },
  {
    accessorKey: 'typeLabel',
    header: 'Type',
    cell: ({ row }) => (
      <ChartLegendChip
        color={row.original.typeColor}
        label={row.original.typeLabel}
      />
    ),
  },
  {
    accessorKey: 'label',
    header: 'Label',
    cell: ({ row }) => (
      <span className="text-[13px] text-foreground">{row.original.label}</span>
    ),
  },
  {
    // accessor returns the LABEL so the Level facet (whose valueOptions are
    // AUDIENCE_LABELS) compares like-for-like — a raw 'primary' accessor would
    // never match the 'Primary' facet option.
    id: 'level',
    accessorFn: (row) => AUDIENCE_LABELS[row.level],
    header: 'Level',
    cell: ({ row }) => (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {AUDIENCE_LABELS[row.original.level]}
      </span>
    ),
  },
  {
    id: 'tentative',
    accessorFn: (row) => row.tentative,
    header: 'Tentative',
    cell: ({ row }) =>
      row.original.tentative ? (
        // §9.3 informational/unconfirmed tone: amber wash.
        <Badge className="h-5 border-brand-amber/40 bg-brand-amber/15 font-mono text-[10px] uppercase tracking-wider text-foreground">
          Tentative
        </Badge>
      ) : null,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ListView({ days, events, onRowClick }: ListViewProps) {
  const rows: ListRow[] = [
    ...buildClosureRows(days),
    ...buildEventRows(events),
  ].sort((a, b) => a.iso.localeCompare(b.iso));

  // Leading hidden column — stamps data-row-key on every body row via the
  // sentinel span so the delegated click handler can read the iso.
  const columns: ColumnDef<ListRow>[] = [
    {
      id: '_key',
      header: () => null,
      cell: ({ row }) => (
        <span
          data-row-key={rowKey(row.original)}
          className="sr-only"
          aria-hidden="true"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    ...DATA_COLUMNS,
  ];

  // Delegated click: find the nearest sentinel span and parse the iso date.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Fast path: clicked directly on or inside the sentinel span.
      const directHit = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-row-key]'
      );
      if (directHit) {
        const iso = isoFromKey(directHit.getAttribute('data-row-key') ?? '');
        if (iso) {
          onRowClick(iso);
          return;
        }
      }
      // Fallback: walk up to the <tr>, then query its sentinel span.
      const tr = (e.target as HTMLElement).closest('tr');
      if (!tr) return;
      const sentinel = tr.querySelector<HTMLElement>('[data-row-key]');
      if (!sentinel) return;
      const iso = isoFromKey(sentinel.getAttribute('data-row-key') ?? '');
      if (iso) onRowClick(iso);
    },
    [onRowClick]
  );

  return (
    // cursor-pointer + hover tint on body rows only (thead rows have no sentinel).
    <div
      onClick={handleClick}
      className="[&_tbody_tr]:cursor-pointer [&_tbody_tr:hover]:bg-accent/40"
    >
      <DataTable<ListRow>
        data={rows}
        columns={columns}
        getRowId={rowKey}
        searchKeys={['label', 'typeLabel']}
        searchPlaceholder="Search label or type…"
        facets={[
          { columnId: 'typeLabel', label: 'Type' },
          {
            columnId: 'level',
            label: 'Level',
            valueOptions: Object.values(AUDIENCE_LABELS),
          },
        ]}
        initialSort={[{ id: 'iso', desc: false }]}
        pageSize={25}
        // KD #84: namespace prevents the table's own URL params from colliding
        // with the page-level query params (date range, term, audience filter).
        url={{ enabled: true, namespace: 'cal' }}
        emptyState={{
          icon: CalendarX,
          title: 'No closures or events in this range.',
          body: 'Only non-school days and calendar events appear here. Open school days are not listed.',
        }}
        emptyFilteredState={{
          title: 'No entries match the current filters.',
          body: 'Try clearing the type or level filter.',
        }}
      />
    </div>
  );
}
