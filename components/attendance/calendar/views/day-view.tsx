'use client';

// DayView — focused single-day view over the whole-AY calendar. Shows the
// day's status (derived via storageToDayStatus from the calendar row) and all
// events on that day. "Edit this day" opens the day-action sheet via onDayClick.
// A day is editable iff it belongs to a term; break days show a note instead.
// Prev/next day navigation is clamped to the AY span.
//
// Design system: §5 step 4 — composed from Card primitives (no equivalent
// shadcn day-focused view exists, but the layout is Card + status panel, not
// a calendar grid). §9.3 status badges for the day status. §9.4 status panel
// only for closed days with a distinct semantic tone. Tokens only (Hard Rule #7).
//
// Data contract: receives the pre-built CalendarIndex as a prop. No fetching.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { sgToday } from '@/lib/dates';

// ─── Helpers (local-date safe, no tz shift) ───────────────────────────────────

/** yyyy-MM-dd → local Date */
function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`DayView: malformed ISO date: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** local Date → yyyy-MM-dd (avoids UTC/toISOString tz shift) */
function formatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add n days to a Date, returning a new Date. */
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}

/** "Monday, 12 May 2025" — long readable date heading. */
function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3])
  ).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type DayViewProps = {
  /** The selected term — the view is scoped to it (nav + editability). */
  term: { startDate: string; endDate: string };
  /** Pre-built calendar index. */
  index: CalendarIndex;
  /** The focused day — DayView renders exactly this date. */
  cursor: Date;
  onCursor: (d: Date) => void;
  /** Fired when "Edit this day" is clicked — opens the day-action sheet. */
  onDayClick: (iso: string) => void;
};

// ─── DayView ──────────────────────────────────────────────────────────────────

export function DayView({
  term,
  index,
  cursor,
  onCursor,
  onDayClick,
}: DayViewProps) {
  // ── Focused date ──────────────────────────────────────────────────────────────
  const iso = formatIso(cursor);

  // ── "Today" in SGT (KD #32) ──────────────────────────────────────────────────
  const todayIso = useMemo(() => sgToday(), []);

  // Selected term window for nav clamping.
  const ayStart = term.startDate;
  const ayEnd = term.endDate;

  // ── In-term predicate (editable iff the date is in the selected term) ──────────
  const inTerm = iso >= term.startDate && iso <= term.endDate;

  // ── Nav clamp: stay within the selected term ──────────────────────────────────
  const canPrev = useMemo(
    () => formatIso(addDays(cursor, -1)) >= ayStart,
    [cursor, ayStart]
  );
  const canNext = useMemo(
    () => formatIso(addDays(cursor, 1)) <= ayEnd,
    [cursor, ayEnd]
  );

  function goPrev() {
    onCursor(addDays(cursor, -1));
  }
  function goNext() {
    onCursor(addDays(cursor, 1));
  }
  function goToday() {
    // Clamp today to the AY span so the cursor always stays within the year.
    const today = sgToday();
    const clamped = today < ayStart ? ayStart : today > ayEnd ? ayEnd : today;
    onCursor(parseIso(clamped));
  }

  // ── Readable chips for the focused day (overrides + events) ───────────────────
  const chips = index.entriesByIso.get(iso) ?? [];
  const events = index.eventsByIso.get(iso) ?? [];
  const weekend = [0, 6].includes(parseIso(iso).getDay());

  // ── Long-form heading ─────────────────────────────────────────────────────────
  const heading = formatLongDate(iso);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <div className="flex flex-wrap items-center gap-2">
          {inTerm ? (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              In session
            </span>
          ) : (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Break
            </span>
          )}
          {iso === todayIso && (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              · Today
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="tabular-nums">{events.length}</span>{' '}
          {events.length === 1 ? 'event' : 'events'} this day
        </p>
      </div>

      {/* Day heading + prev / next / Today nav */}
      <div className="flex items-end justify-between gap-3 border-b border-hairline px-6 pb-3 pt-5">
        <h2 className="font-serif text-[26px] font-semibold leading-none tracking-tight text-foreground">
          {heading}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="Previous day"
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
            aria-label="Next day"
            className="size-8"
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={goToday}
            title="Jump to today (clamped to the academic year)"
            className="h-8 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Day body — what's on this day */}
      <div className="space-y-5 p-6">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              On this day
            </p>
          </CardHeader>
          <CardContent className="px-5 py-4">
            {chips.length > 0 ? (
              <div className="flex flex-col items-start gap-2">
                {chips.map((c) => (
                  <ChartLegendChip
                    key={c.key}
                    color={c.color}
                    label={c.label}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {weekend
                  ? 'Weekend — no school.'
                  : 'School day — nothing scheduled.'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Edit action ──────────────────────────────────────────────────────── */}
        <Separator />
        {inTerm ? (
          // One primary Button per view (§9.2 — §7 craft standard #2).
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => onDayClick(iso)}
              className="h-9"
            >
              Edit this day
            </Button>
            <p className="text-[13px] text-muted-foreground">
              Set the day type, add or edit calendar events.
            </p>
          </div>
        ) : (
          // Between-term break: no term to attach a day/event to, so it can't
          // be configured here.
          <p className="text-[13px] text-muted-foreground">
            This day falls in a break between terms, so there&apos;s no school
            day to configure.
          </p>
        )}
      </div>
    </div>
  );
}
