'use client';

// MonthView — the everyday Mon–Fri month grid for the operational school
// calendar, scoped to a single selected term. Navigation is clamped to the
// term's month span; days outside the term window (or out-of-month) render
// faded + non-interactive via the shared CalendarCell.
//
// Design system: §5 step 5 custom markup — the 5-column event-calendar grid
// has no shadcn primitive analogue. Tokens only (§3 / Hard Rule #7). Borders
// owned by the parent grid container, not by CalendarCell (per its contract).
//
// Data contract: receives the pre-built CalendarIndex as a prop (caller runs
// useCalendarIndex on the term-scoped slices). No data fetching here.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import {
  CalendarCell,
  type CalendarCellProps,
} from '@/components/attendance/calendar/calendar-cell';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { Button } from '@/components/ui/button';
import { sgToday } from '@/lib/dates';

// ─── Helpers (local-date safe, no tz shift) ───────────────────────────────────

/** yyyy-MM-dd → local Date */
function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`MonthView: malformed ISO date: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** local Date → yyyy-MM-dd (avoids UTC/toISOString tz shift) */
function formatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** first-of-month Date for a given Date */
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** first-of-month Date from a yyyy-MM-dd ISO (local-date safe) */
function firstOfMonthFromIso(iso: string): Date {
  return firstOfMonth(parseIso(iso));
}

// ─── MonthCell shape ──────────────────────────────────────────────────────────

type MonthCell = {
  iso: string;
  date: Date;
  dayNumber: number;
  outOfMonth: boolean;
};

// Build Mon–Fri weekday rows for the month containing `cursor`.
// Out-of-month leading / trailing weekdays are included so the grid is a full
// rectangle (Google-Calendar-style); they render faded via CalendarCell's
// outOfMonth prop.
function buildMonthWeekdayRows(cursor: Date): MonthCell[][] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfCurMonth = new Date(year, month, 1);
  const lastOfCurMonth = new Date(year, month + 1, 0);

  // Align to the Monday of the week containing the 1st.
  const firstDow = firstOfCurMonth.getDay(); // 0 = Sun
  const mondayShift = firstDow === 0 ? -6 : 1 - firstDow;
  const weekStart = new Date(firstOfCurMonth);
  weekStart.setDate(firstOfCurMonth.getDate() + mondayShift);

  const rows: MonthCell[][] = [];

  while (weekStart.getTime() <= lastOfCurMonth.getTime()) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      week.push({
        iso: formatIso(d),
        date: new Date(d),
        dayNumber: d.getDate(),
        outOfMonth: d.getMonth() !== month,
      });
    }
    rows.push(week);
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return rows;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type MonthViewProps = {
  /** The selected term's window — used to decide which days are in-term. */
  term: { startDate: string; endDate: string };
  /** Pre-built calendar index — do NOT call useCalendarIndex here. */
  index: CalendarIndex;
  /** first-of-visible-month Date controlled by the parent */
  cursor: Date;
  onCursor: (d: Date) => void;
  /** ISO dates currently selected (multi-select mode) */
  selectedIsos: Set<string>;
  /** Fired when a clickable (in-term, in-month) day cell is clicked */
  onDayClick: (iso: string) => void;
};

// ─── MonthView ────────────────────────────────────────────────────────────────

export function MonthView({
  term,
  index,
  cursor,
  onCursor,
  selectedIsos,
  onDayClick,
}: MonthViewProps) {
  // ── Term month span ──────────────────────────────────────────────────────────
  // Nav is clamped to the months containing the term's start / end dates.
  const { termStartMonth, termEndMonth } = useMemo(
    () => ({
      termStartMonth: firstOfMonthFromIso(term.startDate),
      termEndMonth: firstOfMonthFromIso(term.endDate),
    }),
    [term.startDate, term.endDate]
  );

  // ── "Today" in SGT — school-calendar dates must be Singapore-local (KD #32) ──
  const todayIso = useMemo(() => sgToday(), []);
  const todayMonth = useMemo(() => firstOfMonth(parseIso(sgToday())), []);

  // ── Grid rows ────────────────────────────────────────────────────────────────
  const rows = useMemo(() => buildMonthWeekdayRows(cursor), [cursor]);

  // ── Per-cell helper ──────────────────────────────────────────────────────────

  /** Returns true iff `iso` falls within the selected term window. */
  function inTerm(iso: string): boolean {
    return term.startDate <= iso && iso <= term.endDate;
  }

  // ── Nav ───────────────────────────────────────────────────────────────────────
  // Clamp to the term's start month → end month.
  const canPrev = cursor.getTime() > termStartMonth.getTime();
  const canNext = cursor.getTime() < termEndMonth.getTime();

  // "Today" button: always enabled — even when today is outside the term. The
  // grid will then show an all-faded month; that's an honest representation.
  const todayInTerm = inTerm(todayIso);

  function goPrev() {
    onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  }
  function goNext() {
    onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  }
  function goToday() {
    onCursor(todayMonth);
  }

  // ── Meta strip stats ──────────────────────────────────────────────────────────
  // Count rows in the index that fall within the visible month to give the
  // registrar a quick "N days classified" figure.
  const classifiedThisMonth = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    let count = 0;
    for (const [iso] of index.byDate) {
      const d = parseIso(iso);
      if (d.getFullYear() === year && d.getMonth() === month) count++;
    }
    return count;
  }, [cursor, index.byDate]);

  // ── Month caption ─────────────────────────────────────────────────────────────
  const monthLabel = cursor.toLocaleString('en-SG', {
    month: 'long',
    year: 'numeric',
  });

  // ── Does the visible month overlap the selected term? ─────────────────────────
  const monthInTerm = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return term.startDate <= monthEnd && term.endDate >= monthStart;
  }, [cursor, term.startDate, term.endDate]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <div className="flex flex-wrap items-center gap-2">
          {monthInTerm ? (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              In term
            </span>
          ) : (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Outside term
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="tabular-nums">{classifiedThisMonth}</span> days
          classified this month
        </p>
      </div>

      {/* Month caption + prev / next / Today nav */}
      <div className="flex items-end justify-between gap-3 border-b border-hairline px-6 pb-3 pt-5">
        <h2 className="font-serif text-[30px] font-semibold leading-none tracking-tight text-foreground">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="Previous month"
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
            aria-label="Next month"
            className="size-8"
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={goToday}
            title={
              todayInTerm
                ? 'Jump to today'
                : 'Today is outside the selected term — the grid will show faded cells; switch terms or navigate to a term month to manage days'
            }
            className="h-8 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Today
          </Button>
        </div>
      </div>

      {/* 5-col Mon–Fri grid — flush table-style, hairlines between cells.
          Parent grid owns the borders; CalendarCell renders none of its own. */}
      <div className="border-t border-hairline">
        {/* Weekday header row */}
        <div className="grid grid-cols-5 bg-muted/30">
          {(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const).map((day, idx) => (
            <div
              key={day}
              className={[
                'px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4',
                'border-b border-hairline',
                idx < 4 && 'border-r border-hairline',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day rows */}
        {rows.map((row, rowIdx) => {
          const isLastRow = rowIdx === rows.length - 1;
          return (
            <div key={rowIdx} className="grid grid-cols-5">
              {row.map((cell, colIdx) => {
                const isLastCol = colIdx === 4;

                // Resolve data from the index
                const dayRow = index.byDate.get(cell.iso) ?? null;
                const events = index.eventsByIso.get(cell.iso) ?? [];
                const audienceBadges =
                  index.audienceBadgeByIso.get(cell.iso) ?? [];

                const cellInTerm = inTerm(cell.iso);

                // A cell is clickable iff it is in-term AND in-month. Days
                // outside the selected term render faded (same as out-of-month)
                // and are non-interactive.
                const clickable = cellInTerm && !cell.outOfMonth;

                // Props compatible with CalendarCellProps. Out-of-term days get
                // the same faded treatment as out-of-month days.
                const cellProps: CalendarCellProps = {
                  iso: cell.iso,
                  dayNumber: cell.dayNumber,
                  row: dayRow,
                  events,
                  audienceBadges,
                  isToday: cell.iso === todayIso,
                  outOfMonth: cell.outOfMonth || !cellInTerm,
                  selected: selectedIsos.has(cell.iso),
                  clickable,
                  maxVisibleEvents: 3,
                  onClick: () => onDayClick(cell.iso),
                };

                // Border classes: hairlines BETWEEN cells. The parent grid
                // owns borders so CalendarCell doesn't add its own.
                const borderClasses = [
                  !isLastCol && 'border-r border-hairline',
                  !isLastRow && 'border-b border-hairline',
                ]
                  .filter(Boolean)
                  .join(' ');

                // Leading/trailing days from an adjacent month are rendered as
                // a blank placeholder (keeps the 5-col grid aligned) rather than
                // a faded, dead-looking date cell.
                if (cell.outOfMonth) {
                  return (
                    <div
                      key={cell.iso}
                      aria-hidden="true"
                      className={['min-h-[120px] bg-muted/20', borderClasses]
                        .filter(Boolean)
                        .join(' ')}
                    />
                  );
                }

                return (
                  <div key={cell.iso} className={borderClasses}>
                    <CalendarCell {...cellProps} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
