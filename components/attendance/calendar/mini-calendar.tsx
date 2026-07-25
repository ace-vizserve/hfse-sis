'use client';

// MiniCalendar — sidebar month-jump widget. Shows the same month as the
// parent's `cursor` (no separate month state of its own — one source of
// truth, same as the request that drove KD-style single-source color maps
// elsewhere in this module) with small density dots under any date that has
// at least one chip in the pre-built CalendarIndex. Clicking a date moves the
// shared cursor there; the active view (Month/Week/Day) then renders it.
//
// Deliberately unclamped: unlike MonthView's own prev/next (clamped to the
// selected term's month span), this widget lets the registrar browse any
// month freely — MonthView already treats "cursor outside every term" as a
// legitimate state (its own "Today" button can land there too) and renders
// an honest all-faded grid rather than erroring.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { ChartLegendDot } from '@/components/dashboard/chart-legend-chip';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { cn } from '@/lib/utils';
import { sgToday } from '@/lib/dates';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type MiniDay = {
  iso: string;
  dayNumber: number;
  outOfMonth: boolean;
};

function buildMiniGrid(cursor: Date): MiniDay[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  // Align to the Sunday of the week containing the 1st (Sun-start, matching
  // the reference's Su Mo Tu We Th Fr Sa header — MonthView's big grid is
  // Mon-start, but this compact widget follows the more common mini-cal
  // convention rather than forcing the two to match).
  const firstDow = firstOfMonth.getDay(); // 0 = Sun
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstDow);

  const days: MiniDay[] = [];
  const cursorDate = new Date(start);
  // 6 rows × 7 cols covers every month layout.
  for (let i = 0; i < 42; i++) {
    days.push({
      iso: formatIso(cursorDate),
      dayNumber: cursorDate.getDate(),
      outOfMonth: cursorDate.getMonth() !== month,
    });
    cursorDate.setDate(cursorDate.getDate() + 1);
  }
  // Trim trailing out-of-month rows beyond the week containing the last day,
  // so a short month (e.g. Feb) doesn't render a mostly-empty 6th row.
  const lastNeededIndex = days.findIndex(
    (d) => d.iso === formatIso(lastOfMonth)
  );
  const rowsNeeded = Math.ceil((lastNeededIndex + 1) / 7);
  return days.slice(0, rowsNeeded * 7);
}

export function MiniCalendar({
  cursor,
  onCursor,
  index,
}: {
  cursor: Date;
  onCursor: (d: Date) => void;
  index: CalendarIndex;
}) {
  const todayIso = useMemo(() => sgToday(), []);
  const days = useMemo(() => buildMiniGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleString('en-SG', {
    month: 'long',
    year: 'numeric',
  });

  function goPrev() {
    onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  }
  function goNext() {
    onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  }
  function selectDay(day: MiniDay) {
    const [y, m, d] = day.iso.split('-').map(Number);
    onCursor(new Date(y, m - 1, d));
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-serif text-[13.5px] font-bold text-foreground">
          {monthLabel}
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous month"
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-brand-indigo"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next month"
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-brand-indigo"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_LETTERS.map((letter, i) => (
          <div
            key={i}
            className="pb-1 text-center font-mono text-[8.5px] text-muted-foreground"
          >
            {letter}
          </div>
        ))}
        {days.map((day) => {
          const chips = index.entriesByIso.get(day.iso) ?? [];
          const dotColors = Array.from(
            new Set(chips.slice(0, 2).map((c) => c.color))
          );
          const isToday = day.iso === todayIso;
          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => selectDay(day)}
              aria-label={day.iso}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-px rounded-md text-[11px]',
                day.outOfMonth ? 'text-muted-foreground/50' : 'text-foreground',
                isToday
                  ? 'bg-gradient-to-br from-brand-indigo to-brand-navy font-bold text-white'
                  : 'hover:bg-accent'
              )}
            >
              {day.dayNumber}
              {dotColors.length > 0 && (
                <span className="flex h-1 gap-0.5">
                  {dotColors.map((color, i) => (
                    <ChartLegendDot
                      key={i}
                      color={color}
                      className={cn('size-[3px]', isToday && 'opacity-90')}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
