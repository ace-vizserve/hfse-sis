'use client';

import {
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import {
  computeSubmitEntries,
  encodableDates,
  loadedMarksForDate,
  tally,
  type DailyMark,
} from '@/lib/attendance/daily-entry';
import {
  DAY_TYPE_LABELS,
  EVENT_CATEGORY_LABELS,
  EX_REASON_LABELS,
  EX_NOTE_MAX_LENGTH,
  isEncodableDayType,
  type ExReason,
} from '@/lib/schemas/attendance';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// Selected-mark fills for the P/L/A/EX segmented control — HFSE paper-sheet
// palette (KD A3), the SAME washes as the wide-grid cells (P light blue, L
// pink, A yellow, EX cyan) with dark mark-ink so the letter stays legible
// (≥4.5:1). This is the marking surface, so it carries the local paper-sheet
// colour language; the day-summary stat cards below keep the semantic palette.
// The LETTER on each button is always the signal; colour is secondary.
const STATUS_BTN: Record<
  'P' | 'L' | 'A' | 'EX',
  { label: string; on: string }
> = {
  P: {
    label: 'P',
    on: 'bg-attendance-present text-attendance-mark-ink shadow-xs',
  },
  L: {
    label: 'L',
    on: 'bg-attendance-late text-attendance-mark-ink shadow-xs',
  },
  A: {
    label: 'A',
    on: 'bg-attendance-absent text-attendance-mark-ink shadow-xs',
  },
  EX: {
    label: 'EX',
    on: 'bg-attendance-excused text-attendance-mark-ink shadow-xs',
  },
};
const EX_REASONS: ExReason[] = ['mc', 'compassionate', 'vacation'];

// Day-summary stat cards — status gradient tiles (§9.3 palette). The number
// is `text-foreground`; the tile carries the colour (matches the page's
// term-level StatCard treatment).
const DAY_STAT: Array<{
  key: 'P' | 'L' | 'A' | 'EX';
  label: string;
  icon: LucideIcon;
  tile: string;
}> = [
  {
    key: 'P',
    label: 'Present',
    icon: CircleCheck,
    tile: 'from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  },
  {
    key: 'L',
    label: 'Late',
    icon: Clock,
    tile: 'from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  },
  {
    key: 'A',
    label: 'Absent',
    icon: CircleX,
    tile: 'from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  },
  {
    key: 'EX',
    label: 'Excused',
    icon: FileText,
    tile: 'from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  },
];

// ── Parent: opens on the real calendar date (today). Renders the marking
//    panel on school days, or a "no classes" state on holidays / between-terms
//    days (surfacing any calendar event for that date). The stepper moves
//    across school days for back-filling a missed one.
export function DailyEntry({
  sectionId,
  termId,
  enrolments,
  calendar,
  events,
  initialDaily,
  today,
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  today: string;
}) {
  void sectionId; // not needed for the write (the bulk endpoint keys on sectionStudentId)

  // School (encodable) days in this term, ascending — used by the stepper.
  const dates = useMemo(() => encodableDates(calendar), [calendar]);
  // The view opens on the real calendar date; the stepper moves across school days.
  const [date, setDate] = useState<string>(today);

  // Roster shown for marking: active + late-enrollees (withdrawn excluded).
  const roster = useMemo(
    () => enrolments.filter((e) => !e.withdrawn),
    [enrolments]
  );

  // Calendar status + events for the selected date.
  const calRow = useMemo(
    () => calendar.find((c) => c.date === date) ?? null,
    [calendar, date]
  );
  const isSchoolDay = calRow
    ? isEncodableDayType(calRow.dayType, calRow.hblOverlay)
    : false;
  const dayEvents = useMemo(
    () => events.filter((e) => e.startDate <= date && date <= e.endDate),
    [events, date]
  );

  // Stepper targets the nearest school day before / after the selected date
  // (works even when the selected date itself is not a school day).
  const prevDate = useMemo(() => {
    for (let i = dates.length - 1; i >= 0; i--)
      if (dates[i] < date) return dates[i];
    return null;
  }, [dates, date]);
  const nextDate = useMemo(
    () => dates.find((d) => d > date) ?? null,
    [dates, date]
  );

  const isToday = date === today;

  return (
    <div className="space-y-4">
      {/* Date strip */}
      <div className="flex items-center justify-center gap-2 sm:justify-start">
        <Button
          variant="outline"
          size="icon"
          disabled={!prevDate}
          onClick={() => prevDate && setDate(prevDate)}
          aria-label="Previous school day"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-[220px] text-center">
          <p className="font-serif text-lg font-semibold leading-tight text-foreground">
            {formatLongDate(date)}
            {isToday && (
              <span className="ml-2 align-middle font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                Today
              </span>
            )}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {date}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={!nextDate}
          onClick={() => nextDate && setDate(nextDate)}
          aria-label="Next school day"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {isSchoolDay ? (
        roster.length === 0 ? (
          <Card className="items-center gap-2 py-12 text-center">
            <p className="font-serif text-xl font-semibold text-foreground">
              No students to mark
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              This section has no active students enrolled.
            </p>
          </Card>
        ) : (
          // Keyed child — remounts on date change so `marks` re-seeds from the
          // new date's on-file marks.
          <DailyPanel
            key={date}
            date={date}
            termId={termId}
            roster={roster}
            initialDaily={initialDaily}
          />
        )
      ) : (
        <NoClasses
          isToday={isToday}
          calRow={calRow}
          events={dayEvents}
          prevDate={prevDate}
          onGoToPrev={() => prevDate && setDate(prevDate)}
        />
      )}
    </div>
  );
}

// ── Shown when the selected date is not a school day (holiday, break, or a
//    date outside the loaded term). Surfaces any calendar event on that date.
function NoClasses({
  isToday,
  calRow,
  events,
  prevDate,
  onGoToPrev,
}: {
  isToday: boolean;
  calRow: SchoolCalendarRow | null;
  events: CalendarEventRow[];
  prevDate: string | null;
  onGoToPrev: () => void;
}) {
  const reason = calRow
    ? `${DAY_TYPE_LABELS[calRow.dayType]}${calRow.label ? ` — ${calRow.label}` : ''}`
    : 'This date is outside the school term.';

  return (
    <Card className="items-center gap-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CalendarOff className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="font-serif text-xl font-semibold text-foreground">
          No classes {isToday ? 'today' : 'on this day'}
        </p>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>

      {events.length > 0 && (
        <div className="w-full max-w-sm space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            On the calendar
          </p>
          {events.map((ev) => (
            <div
              key={ev.id}
              className="rounded-xl border border-border bg-card p-3 text-left shadow-xs"
            >
              <p className="text-sm font-medium text-foreground">{ev.label}</p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {EVENT_CATEGORY_LABELS[ev.category]}
                {ev.startDate !== ev.endDate
                  ? ` · ${ev.startDate} → ${ev.endDate}`
                  : ''}
                {ev.tentative ? ' · tentative' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {prevDate && (
        <Button variant="outline" size="sm" onClick={onGoToPrev}>
          Mark the last school day ({formatLongDate(prevDate)})
        </Button>
      )}
    </Card>
  );
}

// ── Child: owns the per-date mark state, tally, and submit. Mounted with
//    key={date} by the parent, so useState re-seeds whenever the date changes.
function DailyPanel({
  date,
  termId,
  roster,
  initialDaily,
}: {
  date: string;
  termId: string;
  roster: WideGridEnrolment[];
  initialDaily: DailyEntryRow[];
}) {
  const router = useRouter();

  const loaded = useMemo(
    () => loadedMarksForDate(initialDaily, date),
    [initialDaily, date]
  );
  const [marks, setMarks] = useState<Map<string, DailyMark>>(
    () => new Map(loaded)
  );

  // Tier-3 autosave surface: the per-date `marks` stay in local state
  // (unchanged optimistic UX). The ONLY change is that the bulk PATCH now runs
  // through useMutation for the shared retry: 0 + apiFetch error handling; on
  // success we router.refresh() so `initialDaily` re-pulls (the saved stat
  // cards reflect the new record). The route-specific error copy is preserved
  // via ApiError.message (body.error).
  const submitMutation = useMutation({
    mutationFn: (entries: ReturnType<typeof computeSubmitEntries>) =>
      apiFetch('/api/attendance/daily', jsonInit('PATCH', { entries })),
    onSuccess: (_data, entries) => {
      toast.success(
        `Saved attendance for ${formatLongDate(date)} (${entries.length} updated).`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    },
  });
  const saving = submitMutation.isPending;

  function setMark(enrolmentId: string, m: DailyMark | null) {
    setMarks((cur) => {
      const next = new Map(cur);
      if (m) next.set(enrolmentId, m);
      else next.delete(enrolmentId);
      return next;
    });
  }

  // Live counts of the working draft — drives the submit-bar summary.
  const counts = tally({ roster, marks, date });
  // Saved counts (what's on record for this day) — drives the stat cards.
  // Only changes after Submit → router.refresh() re-fetches `initialDaily`.
  const saved = tally({ roster, marks: loaded, date });
  const exMissingReason = [...marks.values()].some(
    (m) => m.status === 'EX' && !m.exReason
  );

  function submit() {
    const entries = computeSubmitEntries({
      roster,
      marks,
      loaded,
      termId,
      date,
    });
    if (entries.length === 0) {
      toast.info('No changes to submit.');
      return;
    }
    submitMutation.mutate(entries);
  }

  return (
    <div className="space-y-4">
      {/* Day summary cards — reflect what's SAVED for this day (not the
          in-progress marks); they refresh after Submit. */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          On record for this day
        </p>
        <div className="@container/day">
          <div className="grid grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @lg/day:grid-cols-4">
            {DAY_STAT.map((s) => {
              const Icon = s.icon;
              return (
                <Card key={s.key}>
                  <CardHeader>
                    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      {s.label}
                    </CardDescription>
                    <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
                      {saved[s.key]}
                    </CardTitle>
                    <CardAction>
                      <div
                        className={`flex size-9 items-center justify-center rounded-xl bg-gradient-to-br ${s.tile}`}
                      >
                        <Icon className="size-4" />
                      </div>
                    </CardAction>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {/* Roster */}
      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {roster.map((e) => {
            const beforeJoin = !!e.enrollmentDate && e.enrollmentDate > date;
            const m = marks.get(e.enrolmentId);
            const active: 'P' | 'L' | 'A' | 'EX' = m
              ? m.status === 'NC'
                ? 'P'
                : m.status
              : 'P';
            return (
              <li
                key={e.enrolmentId}
                className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  beforeJoin ? 'bg-muted/40 opacity-40' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                    {e.indexNumber}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {e.studentName}
                  </span>
                </div>

                {beforeJoin ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Before enrolment date
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="inline-flex overflow-hidden rounded-lg border border-border">
                      {(['P', 'L', 'A', 'EX'] as const).map((s) => {
                        const isOn = active === s && (m != null || s === 'P');
                        const explicit =
                          m != null &&
                          (m.status === s || (s === 'P' && m.status === 'P'));
                        return (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={isOn}
                            onClick={() =>
                              setMark(
                                e.enrolmentId,
                                s === 'EX'
                                  ? {
                                      status: 'EX',
                                      exReason: m?.exReason ?? null,
                                      exNote: m?.exNote ?? null,
                                    }
                                  : // Leaving EX drops the note with the
                                    // reason — a "why they were excused" note
                                    // is meaningless on a Present.
                                    { status: s, exReason: null, exNote: null }
                              )
                            }
                            className={`w-11 py-1.5 text-center font-mono text-xs font-semibold transition-colors ${
                              isOn && explicit
                                ? STATUS_BTN[s].on
                                : 'text-muted-foreground hover:bg-muted/60'
                            } ${active === s && !explicit ? 'text-foreground' : ''}`}
                          >
                            {STATUS_BTN[s].label}
                          </button>
                        );
                      })}
                    </div>
                    {m?.status === 'EX' && (
                      <>
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          {EX_REASONS.map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() =>
                                setMark(e.enrolmentId, {
                                  status: 'EX',
                                  exReason: r,
                                  exNote: m.exNote ?? null,
                                })
                              }
                              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                m.exReason === r
                                  ? 'bg-brand-indigo text-white'
                                  : 'border border-border text-muted-foreground hover:bg-muted/60'
                              }`}
                            >
                              {EX_REASON_LABELS[r]}
                            </button>
                          ))}
                        </div>
                        {/* Melissa's ask: somewhere to say WHY, since the MC
                            document itself can't be uploaded yet. Updates on
                            change rather than on blur — this view already
                            batches everything behind an explicit Submit, so
                            there is no per-keystroke write to worry about. */}
                        <input
                          type="text"
                          value={m.exNote ?? ''}
                          maxLength={EX_NOTE_MAX_LENGTH}
                          onChange={(ev) =>
                            setMark(e.enrolmentId, {
                              status: 'EX',
                              exReason: m.exReason ?? null,
                              exNote: ev.target.value,
                            })
                          }
                          placeholder="Add a note (optional)"
                          aria-label={`Note for ${e.studentName}`}
                          className="w-56 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Submit bar */}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {exMissingReason
            ? 'Choose a reason for each Excused student to submit.'
            : `${counts.P + counts.unmarked} present · ${counts.L + counts.A + counts.EX} exceptions`}
        </p>
        <Button onClick={submit} disabled={saving || exMissingReason}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Submit attendance
        </Button>
      </div>
    </div>
  );
}
