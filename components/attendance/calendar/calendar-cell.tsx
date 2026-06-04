'use client';

// CalendarCell — shared presentational day cell used by every grid view.
// Renders the date number + a stack of plain-English, color-coded chips
// (school-status overrides + events), built once in useCalendarIndex.
//
// Design system: §10.2 single-source legend — chips use ChartLegendChip so the
// cell and the Legend strip paint identically. Tokens only; no raw hex.

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import type { DayType, EventCategory } from '@/lib/schemas/attendance';

// ─── Color maps (single source of truth; Legend + List read the same maps) ────

export const DAY_TYPE_LEGEND_COLOR: Record<DayType, ChartLegendChipColor> = {
  school_day: 'fresh',
  public_holiday: 'very-stale',
  school_holiday: 'stale',
  hbl: 'primary',
  no_class: 'neutral',
};

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

// ─── Chip model ───────────────────────────────────────────────────────────────
// A single readable thing shown on a day — a school-status override or an event.
// Built in useCalendarIndex so cells stay presentational.

export type CalendarChip = {
  key: string;
  /** Plain-English text, e.g. "Primary: HBL", "Public holiday", "P5 Mock Exam · Secondary". */
  label: string;
  color: ChartLegendChipColor;
};

// Readable date for the cell's hover/accessible label.
function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── CalendarCell ─────────────────────────────────────────────────────────────

export type CalendarCellProps = {
  /** ISO date string yyyy-MM-dd */
  iso: string;
  /** Day-of-month number to display */
  dayNumber: number;
  /** Readable chips for this date (overrides + events), pre-built. */
  chips: CalendarChip[];
  /** Whether this date is today — renders the indigo gradient circle */
  isToday: boolean;
  /** Out-of-month cell — faded bg + muted date number */
  outOfMonth?: boolean;
  /** Between-term gap day — muted "Term break" band, non-interactive. */
  isBreak?: boolean;
  /** Highlighted selection state → `bg-accent` */
  selected?: boolean;
  /** Whether this cell accepts clicks. */
  clickable: boolean;
  /** Max chips before collapsing to "+N more". Defaults to 3. */
  maxVisibleChips?: number;
  onClick: () => void;
};

export function CalendarCell({
  iso,
  dayNumber,
  chips,
  isToday,
  outOfMonth = false,
  isBreak = false,
  selected = false,
  clickable,
  maxVisibleChips = 3,
  onClick,
}: CalendarCellProps) {
  const visible = chips.slice(0, maxVisibleChips);
  const overflowCount = chips.length - visible.length;
  const isInteractive = clickable && !isBreak;

  return (
    <button
      type="button"
      onClick={() => {
        if (!isInteractive) return;
        onClick();
      }}
      title={formatHumanDate(iso)}
      className={[
        'relative flex min-h-[120px] flex-col gap-1.5 p-2 text-left align-top transition-colors',
        outOfMonth ? 'bg-muted/20' : 'bg-background',
        selected && 'bg-accent',
        isInteractive && 'cursor-pointer hover:bg-muted/40',
        !isInteractive && 'cursor-not-allowed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Date number — top-left. Today = filled indigo gradient circle. */}
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

      {/* Chip column — non-interactive so a click anywhere selects the CELL
          (the badges aren't separate click targets). */}
      <div className="pointer-events-none flex w-full flex-col gap-0.5">
        {isBreak ? (
          <ChartLegendChip
            color="neutral"
            label="Term break"
            className="flex w-full justify-center"
          />
        ) : (
          <>
            {visible.map((c) => (
              <ChartLegendChip
                key={c.key}
                color={c.color}
                label={c.label}
                className="flex w-full justify-center"
              />
            ))}
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
