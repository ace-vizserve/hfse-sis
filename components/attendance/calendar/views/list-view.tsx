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
// Opening a day: an explicit "Open" action button per row (last column) calls
// onRowClick(iso) — clearer than a whole-row click in a table.

import { type ColumnDef } from '@tanstack/react-table';
import { CalendarX, PanelRightOpen } from 'lucide-react';

import {
  DAY_TYPE_LEGEND_COLOR,
  EVENT_CATEGORY_LEGEND_COLOR,
} from '@/components/attendance/calendar/calendar-cell';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
// Reused verbatim from the SIS Admin hub's "Coming up" card — same date-box
// anatomy (serif day / mono month) for every calendar surface, per the
// module vocabulary in docs/superpowers/specs/2026-07-11-sis-admin-visual-
// redesign.html. Single source: change the box once, both surfaces update.
import { DateBox } from '@/components/sis/hub-upcoming-events-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  /** Short weekday, e.g. "Mon" — paired with the DateBox in the Date cell. */
  weekday: string;
  kind: 'closure' | 'event';
  typeLabel: string;
  /** Gradient color keyed from the same map the calendar grid cells use (§10.2). */
  typeColor: ChartLegendChipColor;
  /** Closure label (null → '—') or event.label. */
  label: string;
  /** Audience value for the Level column. */
  level: Audience;
};

// ─── Row key helper ───────────────────────────────────────────────────────────

const KEY_SEP = '|';

function rowKey(row: ListRow): string {
  return `${row.kind}${KEY_SEP}${row.iso}${KEY_SEP}${row.typeLabel}`;
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

/** yyyy-MM-dd → "Mon" (local, tz-safe — no UTC shift). Pairs with DateBox,
 *  which already carries the day number + month. */
function formatWeekday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3])
  ).toLocaleDateString('en-SG', { weekday: 'short' });
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
        weekday: formatWeekday(d.date),
        kind: 'closure',
        typeLabel: CLOSED_REASON_LABELS[reason],
        typeColor: DAY_TYPE_LEGEND_COLOR[d.dayType],
        label: d.label ?? '—',
        level: d.audience,
      };
    });
}

function buildEventRows(events: CalendarEventRow[]): ListRow[] {
  return events.map(
    (e): ListRow => ({
      iso: e.startDate,
      dateLabel: formatReadableDate(e.startDate),
      weekday: formatWeekday(e.startDate),
      kind: 'event',
      typeLabel: EVENT_CATEGORY_LABELS[e.category],
      typeColor: EVENT_CATEGORY_LEGEND_COLOR[e.category],
      label: e.label,
      level: e.audience,
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
    // Date-box anatomy (serif day / mono month) — same component as the SIS
    // Admin hub's "Coming up" card, so a date reads identically everywhere
    // in the calendar module (§10.2-style single source for the box itself).
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <DateBox iso={row.original.iso} />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {row.original.weekday}
        </span>
      </div>
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
    // Audience chip — plain neutral Badge (§9.3 "informational/neutral"
    // recipe), pairing with the Type column's colored ChartLegendChip so a
    // row reads as two distinct affordances rather than a pill next to
    // plain text.
    cell: ({ row }) => (
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        {AUDIENCE_LABELS[row.original.level]}
      </Badge>
    ),
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ListView({ days, events, onRowClick }: ListViewProps) {
  const rows: ListRow[] = [
    ...buildClosureRows(days),
    ...buildEventRows(events),
  ].sort((a, b) => a.iso.localeCompare(b.iso));

  // Explicit action column — an "Open" button per row opens that day's sheet
  // (clearer than a whole-row click in a table).
  const columns: ColumnDef<ListRow>[] = [
    ...DATA_COLUMNS,
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[12px]"
            onClick={() => onRowClick(row.original.iso)}
          >
            <PanelRightOpen className="size-3.5" />
            Open
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];

  return (
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
  );
}
