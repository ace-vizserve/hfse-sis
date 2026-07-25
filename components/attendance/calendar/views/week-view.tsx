'use client';

// WeekView — Mon–Fri week grid over the whole-AY calendar. Navigation moves
// cursor ±7 days, clamped to the AY span. A day is editable iff it belongs to
// a term; days in between-term gaps render faded + inert.
// Renders taller CalendarCell columns (maxVisibleEvents=6) since each column
// has more vertical space than a month grid cell.
//
// Design system: §5 step 5 — custom 5-column grid (same rationale as MonthView;
// no shadcn primitive models a week calendar). Mirrors MonthView container +
// eyebrow-strip structure. Tokens only (Hard Rule #7).
//
// Data contract: receives the pre-built CalendarIndex as a prop. No fetching.

import { CalendarX, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import {
  CalendarCell,
  type CalendarCellProps,
  type CalendarChip,
} from '@/components/attendance/calendar/calendar-cell';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { Button } from '@/components/ui/button';
import { sgToday } from '@/lib/dates';

const EMPTY_CHIPS: CalendarChip[] = [];

// ─── Helpers (copied from month-view.tsx — local-date safe, no tz shift) ──────

/** yyyy-MM-dd → local Date */
function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`WeekView: malformed ISO date: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** local Date → yyyy-MM-dd (avoids UTC/toISOString tz shift) */
function formatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the week containing d (locale-safe, Mon-first). */
function mondayOf(d: Date): Date {
  const dow = d.getDay(); // 0=Sun
  const shift = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + shift);
  return mon;
}

/** Add n days to a Date, returning a new Date. */
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type WeekViewProps = {
  /** The selected term — the view is scoped to it (nav + editability). */
  term: { startDate: string; endDate: string };
  /** Pre-built calendar index. */
  index: CalendarIndex;
  /**
   * Any date within the visible week — WeekView derives the Mon–Fri span from
   * the Monday of this date's week.
   */
  cursor: Date;
  onCursor: (d: Date) => void;
  /** Fired when a clickable (in-term) day cell is clicked. */
  onDayClick: (iso: string) => void;
  /** See MonthViewProps.filtersActive — same empty-filtered-state contract. */
  filtersActive?: boolean;
};

// ─── WeekView ─────────────────────────────────────────────────────────────────

export function WeekView({
  term,
  index,
  cursor,
  onCursor,
  onDayClick,
  filtersActive = false,
}: WeekViewProps) {
  // Selected term window for nav clamping.
  const ayStart = term.startDate;
  const ayEnd = term.endDate;
  // ── Compute the Mon–Sun span of the cursor's week (weekends included — HFSE
  //    schedules weekend events) ──────────────────────────────────────────────
  const weekDays = useMemo<
    Array<{ iso: string; dayNumber: number; longLabel: string }>
  >(() => {
    const mon = mondayOf(cursor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      return {
        iso: formatIso(d),
        dayNumber: d.getDate(),
        longLabel: d.toLocaleDateString('en-SG', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
      };
    });
  }, [cursor]);

  // ── "Today" in SGT (KD #32) ──────────────────────────────────────────────────
  const todayIso = useMemo(() => sgToday(), []);

  // ── In-term predicate (editable iff the date belongs to ANY term) ─────────────
  function inTerm(iso: string): boolean {
    return term.startDate <= iso && iso <= term.endDate;
  }

  // ── Week caption, e.g. "Week of 12 May 2025" ────────────────────────────────
  const weekCaptionDate = weekDays[0]
    ? parseIso(weekDays[0].iso)
    : new Date(cursor);
  const weekCaption = `Week of ${weekCaptionDate.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;

  // ── Nav clamp: the adjacent week must still intersect the selected term ──────
  const weekMonIso = weekDays[0]?.iso ?? '';

  const canPrev = useMemo(() => {
    // Previous week's last day (Sunday) = the day before this Monday.
    const prevSun = formatIso(addDays(parseIso(weekMonIso), -1));
    return prevSun >= ayStart;
  }, [weekMonIso, ayStart]);

  const canNext = useMemo(() => {
    // Next week's first day (Monday) = this Monday + 7.
    const nextMon = formatIso(addDays(parseIso(weekMonIso), 7));
    return nextMon <= ayEnd;
  }, [weekMonIso, ayEnd]);

  function goPrev() {
    onCursor(addDays(cursor, -7));
  }
  function goNext() {
    onCursor(addDays(cursor, 7));
  }
  function goToday() {
    // SGT-correct "today" (KD #32), clamped into the AY span.
    const t = sgToday();
    const clamped = t < ayStart ? ayStart : t > ayEnd ? ayEnd : t;
    onCursor(parseIso(clamped));
  }

  // ── Does any day in the visible week fall inside the selected term? ──────────
  const weekInTerm = weekDays.some((d) => inTerm(d.iso));

  // ── Filtered-to-empty detection (see MonthView for the same contract) ────────
  const hasAnyChipsInView = weekDays.some(
    (d) => (index.entriesByIso.get(d.iso)?.length ?? 0) > 0
  );
  const showEmptyFilteredState = filtersActive && !hasAnyChipsInView;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <div className="flex flex-wrap items-center gap-2">
          {weekInTerm ? (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              In session
            </span>
          ) : (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Break
            </span>
          )}
        </div>
      </div>

      {/* Week caption + prev / next / Today nav */}
      <div className="flex items-end justify-between gap-3 border-b border-hairline px-6 pb-3 pt-5">
        <h2 className="font-serif text-[26px] font-semibold leading-none tracking-tight text-foreground">
          {weekCaption}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="Previous week"
            className="size-8"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goNext}
            disabled={!canNext}
            aria-label="Next week"
            className="size-8"
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={goToday}
            title="Jump to the week containing today"
            className="h-8 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Today
          </Button>
        </div>
      </div>

      {/* 7-col Mon–Sun grid — same container / hairline pattern as MonthView. */}
      <div className="border-t border-hairline">
        {/* Weekday header row — shows short weekday + date, e.g. "Mon 12 May" */}
        <div className="grid grid-cols-7 bg-muted/30">
          {weekDays.map((d, idx) => {
            const isLastCol = idx === 6;
            const isToday = d.iso === todayIso;
            return (
              <div
                key={d.iso}
                className={[
                  'px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
                  'border-b border-hairline',
                  !isLastCol && 'border-r border-hairline',
                  isToday ? 'text-primary' : 'text-ink-4',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {d.longLabel}
              </div>
            );
          })}
        </div>

        {/* Single row of taller cells — replaced by an empty-filtered state
            when the sidebar's filters are active and hide every chip in
            the visible week (same contract as MonthView). */}
        {showEmptyFilteredState ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CalendarX className="size-[18px]" />
            </div>
            <p className="font-serif text-[15px] font-semibold text-foreground">
              No days or events match the current filters.
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Try clearing a filter in the sidebar, or check a different week.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {weekDays.map((d, colIdx) => {
              const isLastCol = colIdx === 6;
              const chips = index.entriesByIso.get(d.iso) ?? EMPTY_CHIPS;
              const cellInTerm = inTerm(d.iso);

              // Weekday-only, mirroring MonthView: weekends structurally never
              // carry a school_calendar row (ensureTermSeeded/weekdaysBetween
              // only ever auto-seed weekdays), so flagging every Sat/Sun as
              // "Unmarked" would be permanent noise, not a real gap. weekDays
              // is built Mon-first, so colIdx 0-4 are the weekdays.
              const isWeekday = colIdx < 5;
              const missingRow =
                cellInTerm && isWeekday && !index.hasRowByIso.has(d.iso);

              const cellProps: CalendarCellProps = {
                iso: d.iso,
                dayNumber: d.dayNumber,
                chips,
                isToday: d.iso === todayIso,
                // Out-of-term days get the faded treatment — consistent with
                // MonthView's outOfMonth rendering (same §10.2 semantics).
                outOfMonth: !cellInTerm,
                clickable: cellInTerm,
                missingRow,
                // Taller cells: show up to 6 chips before collapsing.
                maxVisibleChips: 6,
                onClick: () => onDayClick(d.iso),
              };

              return (
                <div
                  key={d.iso}
                  className={[
                    // Taller min-height than MonthView (≥200px) to fill the
                    // week grid comfortably with the same border-ownership
                    // pattern.
                    'min-h-[200px]',
                    !isLastCol && 'border-r border-hairline',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <CalendarCell {...cellProps} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
