'use client';

// DayView — focused single-day view scoped to the selected term. Shows the
// day's status (derived via storageToDayStatus from the calendar row) and all
// events on that day. "Edit this day" opens the day-action sheet via onDayClick.
// Prev/next day navigation is clamped to the term window.
//
// Design system: §5 step 4 — composed from Card primitives (no equivalent
// shadcn day-focused view exists, but the layout is Card + status panel, not
// a calendar grid). §9.3 status badges for the day status. §9.4 status panel
// only for closed days with a distinct semantic tone. Tokens only (Hard Rule #7).
//
// Data contract: receives the pre-built CalendarIndex as a prop. No fetching.

import {
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  CalendarX,
} from 'lucide-react';
import { useMemo } from 'react';

import { EventChip } from '@/components/attendance/calendar/calendar-cell';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  CLOSED_REASON_LABELS,
  storageToDayStatus,
} from '@/lib/attendance/calendar-operational';
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
  /** The selected term's window — used to determine in-term bounds. */
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

  // ── In-term predicate ─────────────────────────────────────────────────────────
  const inTerm = iso >= term.startDate && iso <= term.endDate;

  // ── Nav clamp: stay within the term window ───────────────────────────────────
  const canPrev = useMemo(
    () => formatIso(addDays(cursor, -1)) >= term.startDate,
    [cursor, term.startDate]
  );
  const canNext = useMemo(
    () => formatIso(addDays(cursor, 1)) <= term.endDate,
    [cursor, term.endDate]
  );

  function goPrev() {
    onCursor(addDays(cursor, -1));
  }
  function goNext() {
    onCursor(addDays(cursor, 1));
  }
  function goToday() {
    // Clamp today to term bounds so the cursor always stays within the term.
    const today = sgToday();
    if (today < term.startDate) {
      onCursor(parseIso(term.startDate));
    } else if (today > term.endDate) {
      onCursor(parseIso(term.endDate));
    } else {
      onCursor(parseIso(today));
    }
  }

  // ── Resolve data for the focused day ─────────────────────────────────────────
  const dayRow = index.byDate.get(iso) ?? null;
  const events = index.eventsByIso.get(iso) ?? [];

  // ── Derive the day status (§9.3 semantic colours) ────────────────────────────
  // Derive from the stored row; fall back to "Open (default)" when no row.
  type ResolvedStatus =
    | { kind: 'open'; label: string; hbl: boolean }
    | { kind: 'closed'; label: string };

  const resolvedStatus = useMemo<ResolvedStatus | null>(() => {
    if (!dayRow) return null;
    const status = storageToDayStatus({
      dayType: dayRow.dayType,
      hblOverlay: dayRow.hblOverlay,
    });
    if (status.kind === 'open') {
      const hbl = status.hbl;
      const hblOverlay =
        dayRow.hblOverlay === true && dayRow.dayType === 'school_holiday';
      return {
        kind: 'open',
        label: hblOverlay
          ? 'Open · School holiday (HBL)'
          : hbl
            ? 'Open · HBL'
            : 'Open',
        hbl: hbl || hblOverlay,
      };
    }
    return {
      kind: 'closed',
      label: `Closed · ${CLOSED_REASON_LABELS[status.reason]}`,
    };
  }, [dayRow]);

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
              In term
            </span>
          ) : (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Outside term
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
            title="Jump to today (clamped to term bounds)"
            className="h-8 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Day body — status + events */}
      <div className="space-y-5 p-6">
        {/* ── Day status card ──────────────────────────────────────────────────── */}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Day status
            </p>
          </CardHeader>
          <CardContent className="flex items-start gap-4 px-5 py-5">
            {/* Status icon tile — §9.3 / §8 gradient icon tile */}
            <div
              className={[
                'flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-brand-tile',
                resolvedStatus?.kind === 'closed'
                  ? 'bg-gradient-to-br from-destructive to-destructive/70'
                  : 'bg-gradient-to-br from-brand-indigo to-brand-navy',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            >
              {resolvedStatus?.kind === 'closed' ? (
                <CalendarX className="size-4" />
              ) : (
                <CalendarCheck className="size-4" />
              )}
            </div>

            <div className="flex-1 space-y-2">
              {/* Status label + badge */}
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-serif text-base font-semibold text-foreground">
                  {resolvedStatus ? resolvedStatus.label : 'Open (default)'}
                </p>
                {/* §9.3 status badge */}
                {resolvedStatus?.kind === 'closed' ? (
                  <Badge className="h-5 border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
                    Closed
                  </Badge>
                ) : (
                  <Badge className="h-5 border-brand-mint bg-brand-mint/30 text-[10px] text-ink">
                    Open
                  </Badge>
                )}
              </div>

              {/* Optional label from the row */}
              {dayRow?.label && (
                <p className="text-[13px] text-muted-foreground">
                  {dayRow.label}
                </p>
              )}

              {/* No row = unclassified day */}
              {!dayRow && (
                <p className="text-[13px] text-muted-foreground">
                  No classification set — treated as an open school day.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Events card ──────────────────────────────────────────────────────── */}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Events
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            {events.length > 0 ? (
              <div className="flex flex-col gap-2">
                {events.map((evt) => (
                  <div key={evt.id} className="flex items-start gap-3">
                    {/* Gradient chip — pixel-identical to cell chip (§10.2). */}
                    <div className="w-36 shrink-0">
                      <EventChip event={evt} />
                    </div>
                    <div className="flex-1 space-y-0.5">
                      <p className="text-[13px] font-medium text-foreground">
                        {evt.label}
                      </p>
                      {evt.startDate !== evt.endDate && (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {evt.startDate} → {evt.endDate}
                        </p>
                      )}
                      {evt.tentative && (
                        <Badge className="h-4 border-brand-amber/40 bg-brand-amber/15 font-mono text-[9px] uppercase tracking-wider text-foreground">
                          Tentative
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                No events on this day.
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
          // Out-of-term: informational note instead of a disabled CTA.
          <p className="text-[13px] text-muted-foreground">
            This day is outside the selected term — use the term picker to
            navigate to the correct term, then edit from there.
          </p>
        )}
      </div>
    </div>
  );
}
