'use client';

// CalendarCell — shared presentational day-cell used by every calendar view
// (MonthView, TermStripView, etc.). Lifted from calendar-admin-client.tsx
// §MonthView cell so all views render identically.
//
// Design system: §5 step 5 — custom markup per §10 legend pattern (identical
// paint in cell AND in the Legend strip; ChartLegendChip is the single
// rendering surface for day-type chips). Tokens only; no raw hex.

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { Badge } from '@/components/ui/badge';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  AUDIENCE_LABELS,
  type Audience,
  type DayType,
  type EventCategory,
} from '@/lib/schemas/attendance';

// ─── Color maps (lifted from calendar-admin-client.tsx) ──────────────────────
//
// These are the single sources of truth. The Legend strip reads from the same
// maps so cell chips and legend chips are always pixel-identical (§10.2).

// Short banner labels printed inside each cell. Keep terse — cell is ~80px wide.
export const DAY_TYPE_SHORT_LABEL: Record<DayType, string> = {
  school_day: 'School',
  public_holiday: 'Public',
  school_holiday: 'School hol.',
  hbl: 'HBL',
  no_class: 'No class',
};

// Maps each day-type to its ChartLegendChip gradient color. The Legend strip
// uses this same map so both render the same gradient (§10.2 single source).
export const DAY_TYPE_LEGEND_COLOR: Record<DayType, ChartLegendChipColor> = {
  school_day: 'fresh',
  public_holiday: 'very-stale',
  school_holiday: 'stale',
  hbl: 'primary',
  no_class: 'neutral',
};

// Color tone per event category for EventChip + Legend. Mapping rationale
// (KD #50 + §9.3 status palette):
//   term_exam        → very-stale (destructive red — high stakes)
//   term_break       → stale (amber — time-bounded window)
//   start_of_term    → fresh (mint — positive milestone)
//   parents_dialogue → primary (indigo — relational/informational)
//   subject_week     → chart-3 (themed/programmatic)
//   school_event     → chart-4 (event tone)
//   pfe              → chart-2 (partnership tone)
//   ptc              → chart-5 (parent-touchpoint, sky)
//   other            → neutral
export const EVENT_CATEGORY_LEGEND_COLOR: Record<
  EventCategory,
  ChartLegendChipColor
> = {
  term_exam: 'very-stale',
  term_break: 'stale',
  start_of_term: 'fresh',
  parents_dialogue: 'primary',
  subject_week: 'chart-3',
  school_event: 'chart-4',
  pfe: 'chart-2',
  ptc: 'chart-5',
  other: 'neutral',
};

// Readable date for the cell's hover/accessible label, e.g.
// "Monday, 15 Jan 2026" (lifted from the monolith's formatHumanDate). The cell
// button has no visible text, so this title is its only accessible name.
function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── EventChip ───────────────────────────────────────────────────────────────
//
// Gradient chip for informational events (calendar_events rows).

export function EventChip({ event }: { event: CalendarEventRow }) {
  return (
    <ChartLegendChip
      color={EVENT_CATEGORY_LEGEND_COLOR[event.category]}
      label={event.label}
      className="flex w-full justify-center"
    />
  );
}

// ─── CalendarCell ─────────────────────────────────────────────────────────────

export type CalendarCellProps = {
  /** ISO date string yyyy-MM-dd */
  iso: string;
  /** Day-of-month number to display */
  dayNumber: number;
  /** School-calendar row for this date, or null when no row exists */
  row: SchoolCalendarRow | null;
  /** Event rows whose span includes this date */
  events: CalendarEventRow[];
  /**
   * Audience badges to render in the top-right corner.
   * Populated only when the active audience filter is 'all' and there are
   * audience-specific overrides for this date.
   */
  audienceBadges: Audience[];
  /** Whether this date is today — renders the indigo gradient circle */
  isToday: boolean;
  /** Out-of-month cell — faded bg + muted date number */
  outOfMonth?: boolean;
  /**
   * Between-term gap day — renders a muted "Term break" band; button is
   * non-interactive (cursor-not-allowed, onClick guarded).
   */
  isBreak?: boolean;
  /** Highlighted selection state → `bg-accent` */
  selected?: boolean;
  /**
   * Whether this cell accepts clicks. When false the button is rendered
   * (to avoid disabled-state gradient suppression in some browsers — see
   * monolith comment) but onClick is guarded + cursor-not-allowed applied.
   */
  clickable: boolean;
  /**
   * Max event chips to render before collapsing to "+N more". Defaults to 3
   * (MonthView density); the tighter TermStripView passes 2.
   */
  maxVisibleEvents?: number;
  onClick: () => void;
};

// CalendarCell uses a raw <button> per design system §5 step 5 — the monthly
// grid is custom markup because no shadcn primitive models a 5-col calendar
// cell with stacked gradient chips, audience corner badges, and today circle.
// Borders (right + bottom hairlines) are handled by the PARENT grid container,
// not the cell itself, so the grid controls visual density without coupling.
export function CalendarCell({
  iso,
  dayNumber,
  row,
  events,
  audienceBadges,
  isToday,
  outOfMonth = false,
  isBreak = false,
  selected = false,
  clickable,
  maxVisibleEvents = 3,
  onClick,
}: CalendarCellProps) {
  const dayType: DayType | null = row?.dayType ?? null;
  const shortLabel = dayType ? DAY_TYPE_SHORT_LABEL[dayType] : null;

  // HBL overlay: school_holiday row with hblOverlay=true gets a secondary HBL
  // chip (matches monolith's hblOverlayIsoSet pattern).
  const showHblOverlay =
    row?.hblOverlay === true && row?.dayType === 'school_holiday';

  // Limit event chips; "+N more" for the remainder.
  const visibleEvents = events.slice(0, maxVisibleEvents);
  const overflowCount = events.length - visibleEvents.length;

  const isInteractive = clickable && !isBreak;

  return (
    <button
      type="button"
      // Deliberately NOT using `disabled` — see monolith comment: some browsers
      // suppress ChartLegendChip's white text on disabled buttons via default
      // disabled-color overrides. We use onClick guards + cursor-not-allowed instead.
      onClick={() => {
        if (!isInteractive) return;
        onClick();
      }}
      title={formatHumanDate(iso)}
      className={[
        'relative flex min-h-[120px] flex-col gap-1.5 p-2 text-left align-top transition-colors',
        // Background
        outOfMonth ? 'bg-muted/20' : 'bg-background',
        selected && 'bg-accent',
        // Hover / cursor — only on interactive cells
        isInteractive && 'cursor-pointer hover:bg-muted/40',
        !isInteractive && 'cursor-not-allowed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Date number — sans, top-left. Today = filled indigo gradient circle. */}
      <span
        className={[
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums leading-none',
          isToday
            ? 'bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_1px_2px_rgba(15,23,42,0.1)]'
            : outOfMonth
              ? 'text-ink-5'
              : 'text-foreground',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {dayNumber}
      </span>

      {/* Audience corner badges — top-right, only when there are overrides. */}
      {audienceBadges.length > 0 && (
        <div className="absolute right-1.5 top-1.5 flex flex-wrap items-center gap-0.5">
          {audienceBadges.map((aud) => (
            <Badge
              key={aud}
              variant="warning"
              title={`${AUDIENCE_LABELS[aud]} override`}
            >
              {AUDIENCE_LABELS[aud]}
            </Badge>
          ))}
        </div>
      )}

      {/* Stacked chip column */}
      <div className="flex w-full flex-col gap-0.5">
        {isBreak ? (
          // Between-term gap — muted "Term break" chip. Uses ChartLegendChip
          // color="neutral" so the cell chip and Legend strip chip are
          // pixel-identical (§10.2 single source). The 'neutral' tone
          // (ink-4 → ink-3 gradient) reads clearly as "background /
          // deprioritized" per §9.1 semantic palette.
          <ChartLegendChip
            color="neutral"
            label="Term break"
            className="flex w-full justify-center"
          />
        ) : (
          <>
            {/* Day-type chip — same ChartLegendChip as in Legend strip (§10.2) */}
            {shortLabel && dayType && (
              <ChartLegendChip
                color={DAY_TYPE_LEGEND_COLOR[dayType]}
                label={shortLabel}
                className="flex w-full justify-center"
              />
            )}

            {/* HBL overlay secondary chip */}
            {showHblOverlay && (
              <ChartLegendChip
                color="primary"
                label="HBL"
                className="flex w-full justify-center"
              />
            )}

            {/* Event chips — up to 3 */}
            {visibleEvents.map((evt) => (
              <EventChip key={evt.id} event={evt} />
            ))}

            {/* "+N more" overflow indicator */}
            {overflowCount > 0 && (
              <span className="px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                +{overflowCount} more
              </span>
            )}
          </>
        )}
      </div>
    </button>
  );
}
