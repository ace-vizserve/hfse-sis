'use client';

// MonthView — the everyday Mon–Fri month grid for the operational school
// calendar. Navigates AY-wide (all terms); detects between-term break days
// and marks them non-interactive via the shared CalendarCell.
//
// Design system: §5 step 5 custom markup — the 5-column event-calendar grid
// has no shadcn primitive analogue. Tokens only (§3 / Hard Rule #7). Borders
// owned by the parent grid container, not by CalendarCell (per its contract).
//
// Data contract: receives the pre-built CalendarIndex as a prop (caller runs
// useCalendarIndex). No data fetching here.

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
  /**
   * AY-wide dated terms (already filtered to those with start + end), used to
   * detect between-term break gaps and decide which days are in-term (editable).
   */
  terms: Array<{
    id: string;
    label: string;
    startDate: string;
    endDate: string;
  }>;
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
  terms,
  index,
  cursor,
  onCursor,
  selectedIsos,
  onDayClick,
}: MonthViewProps) {
  // ── Derived AY span ──────────────────────────────────────────────────────────
  // AY start = earliest term start; AY end = latest term end. Used for:
  //   1. Nav clamp (can't navigate before AY-start month or after AY-end month).
  //   2. Break detection (day is inside AY but outside every term window).
  const { ayStart, ayEnd, ayStartMonth, ayEndMonth } = useMemo(() => {
    if (terms.length === 0) {
      const now = firstOfMonth(new Date());
      return { ayStart: '', ayEnd: '', ayStartMonth: now, ayEndMonth: now };
    }
    const starts = terms.map((t) => t.startDate).sort();
    const ends = terms.map((t) => t.endDate).sort();
    const start = starts[0];
    const end = ends[ends.length - 1];
    const startDate = parseIso(start);
    const endDate = parseIso(end);
    return {
      ayStart: start,
      ayEnd: end,
      ayStartMonth: firstOfMonth(startDate),
      ayEndMonth: firstOfMonth(endDate),
    };
  }, [terms]);

  // ── "Today" in SGT — school-calendar dates must be Singapore-local (KD #32) ──
  const todayIso = useMemo(() => sgToday(), []);
  // Parse the SGT iso back through the local-date-safe parseIso so we get a
  // local Date (not shifted by UTC offset) and derive the first-of-month from it.
  const todayMonth = useMemo(() => firstOfMonth(parseIso(sgToday())), []);

  // ── Grid rows ────────────────────────────────────────────────────────────────
  const rows = useMemo(() => buildMonthWeekdayRows(cursor), [cursor]);

  // ── Per-cell helpers ─────────────────────────────────────────────────────────

  /** Returns true iff `iso` falls within at least one term window. */
  function isInTerm(iso: string): boolean {
    return terms.some((t) => iso >= t.startDate && iso <= t.endDate);
  }

  /**
   * A weekday is a "break" cell when it is inside the AY span
   * (`ayStart <= iso <= ayEnd`) but not inside any term window. Out-of-month
   * cells are excluded — they render as faded leading/trailing, not break.
   */
  function isBreak(iso: string, outOfMonth: boolean): boolean {
    if (outOfMonth) return false;
    if (!ayStart || !ayEnd) return false;
    return iso >= ayStart && iso <= ayEnd && !isInTerm(iso);
  }

  // ── Nav ───────────────────────────────────────────────────────────────────────
  // Clamp to AY-start month → AY-end month (AY-wide, not per-term).
  const canPrev = cursor.getTime() > ayStartMonth.getTime();
  const canNext = cursor.getTime() < ayEndMonth.getTime();

  // "Today" button: always enabled — even when today is outside the AY. The
  // grid will show day numbers + headers with empty/break cells for non-term
  // months; that's an honest representation. Tooltip clarifies when applicable.
  const todayInAy =
    ayStart && ayEnd && todayIso >= ayStart && todayIso <= ayEnd;

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
  // registrar a quick "N days classified" figure. Only counts in-term days
  // (break days have no calendar rows).
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

  // ── Which term label(s) overlap this month? ───────────────────────────────────
  const overlappingTerms = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return terms.filter(
      (t) => t.startDate <= monthEnd && t.endDate >= monthStart
    );
  }, [cursor, terms]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <div className="flex flex-wrap items-center gap-2">
          {overlappingTerms.length > 0 ? (
            overlappingTerms.map((t) => (
              <span
                key={t.id}
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary"
              >
                {t.label}
              </span>
            ))
          ) : (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Between terms
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
              todayInAy
                ? 'Jump to today'
                : 'Today is outside this academic year — the grid will show empty / break cells; navigate to a term month to see day-type badges'
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
                const row = index.byDate.get(cell.iso) ?? null;
                const events = index.eventsByIso.get(cell.iso) ?? [];
                const audienceBadges =
                  index.audienceBadgeByIso.get(cell.iso) ?? [];

                const inTerm = isInTerm(cell.iso);
                const breakCell = isBreak(cell.iso, cell.outOfMonth);

                // A cell is clickable iff it is in-term AND in-month.
                // Out-of-month cells are faded but never editable.
                // Break cells within the AY are also non-interactive.
                const clickable = inTerm && !cell.outOfMonth;

                // Props compatible with CalendarCellProps
                const cellProps: CalendarCellProps = {
                  iso: cell.iso,
                  dayNumber: cell.dayNumber,
                  row,
                  events,
                  audienceBadges,
                  isToday: cell.iso === todayIso,
                  outOfMonth: cell.outOfMonth,
                  isBreak: breakCell,
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
