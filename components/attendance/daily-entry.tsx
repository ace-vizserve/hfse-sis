'use client';

// `FileText` / `Plane` / `ArrowUpRight` are the same three the marking palette
// puts on a filing (cell-mark-dialog.tsx), and `Plane` is what the declarations
// queue puts on a travel row — so one filing wears one symbol wherever a person
// meets it.
import {
  ArrowUpRight,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Eraser,
  FileText,
  Plane,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
// ⚠ The SAME type the marking palette takes, imported from where it is
// declared rather than re-shaped here. The filing is one fact appearing in two
// places; giving the daily register its own copy of the shape is the first step
// towards giving it its own copy of the words.
import type { CellFiling } from '@/components/attendance/cell-mark-dialog';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import { MedicalCertificateField } from '@/components/attendance/medical-certificate-field';
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
  EX_NOTE_PLACEHOLDER,
  isEncodableDayType,
  type ExReason,
} from '@/lib/schemas/attendance';
import { STATUS_TOGGLE_WASH } from '@/components/attendance/status-wash';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// The P/L/A/EX segmented control — HFSE paper-sheet palette (KD A3), the SAME
// washes as the wide-grid cells and the term-view marking palette (P light
// blue, L pink, A yellow, EX cyan) with dark mark-ink so the letter stays
// legible (≥4.5:1). This is a marking surface, so it carries the local
// paper-sheet colour language; the day-summary stat cards below keep the
// semantic palette. The LETTER is always the signal; colour is secondary.
//
// Shape only — the colours come from STATUS_TOGGLE_WASH, which restates each
// wash under `hover:` and `data-[state=on]:` because `toggleVariants` sets its
// own under both and a plain `bg-*` class does not outrank them.
const MARK_BUTTON =
  'h-auto w-11 rounded-none px-0 py-1.5 text-center font-mono text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[state=on]:text-attendance-mark-ink data-[state=on]:shadow-xs';

// The buttons show a letter, so each needs a spoken name. Deliberately NOT
// ATTENDANCE_STATUS_LABELS: its EX entry reads "Excused (MC / Excuse leave)",
// which names one of the three reasons the button reveals.
const MARKS: Array<{ status: 'P' | 'L' | 'A' | 'EX'; word: string }> = [
  { status: 'P', word: 'Present' },
  { status: 'L', word: 'Late' },
  { status: 'A', word: 'Absent' },
  { status: 'EX', word: 'Excused' },
];
const EX_REASONS: ExReason[] = ['mc', 'compassionate', 'vacation'];

// The fifth segment on the track is NOT a mark — it is the removal of one, so
// it deliberately carries no paper-sheet colour. A wash would put it in the
// same family as P/L/A/EX and read as a fifth thing a student can be. It takes
// neutral chrome instead (§9.1 muted) with an inset ring so "chosen" still
// reads, and an eraser rather than a letter: on a paper register, taking a mark
// back off the day is what an eraser does.
const CLEARED = 'cleared';
const CLEAR_BUTTON =
  'data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-border';

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
  filingsByCell = {},
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  today: string;
  /**
   * `enrolmentId|yyyy-MM-dd` → the approved parent filing covering that day
   * (KD #195 / #197). The WHOLE TERM arrives, exactly as the term sheet gets
   * it, and is narrowed to the selected date below.
   *
   * ⚠ NARROWED HERE AND NOT ON THE SERVER, and that is not a preference. The
   * date is client state — the stepper walks it without a round trip — so a
   * map the server had already cut down to one day would freeze on whichever
   * day the page happened to render with, and the indicator would then be
   * right on arrival and wrong from the first click of the arrow. A term's
   * filings are a handful of rows, so carrying all of them costs nothing.
   */
  filingsByCell?: Record<string, CellFiling>;
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

  // The filings that land on the day being marked, keyed by student. Recomputed
  // whenever the stepper moves, which is the whole point — see the prop's note.
  const filingsForDate = useMemo(() => {
    const suffix = `|${date}`;
    const out = new Map<string, CellFiling>();
    for (const [key, filing] of Object.entries(filingsByCell)) {
      if (key.endsWith(suffix)) out.set(key.slice(0, -suffix.length), filing);
    }
    return out;
  }, [filingsByCell, date]);

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
            filings={filingsForDate}
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
  filings,
}: {
  date: string;
  termId: string;
  roster: WideGridEnrolment[];
  initialDaily: DailyEntryRow[];
  /** Student → the approved parent filing covering THIS date. */
  filings: Map<string, CellFiling>;
}) {
  const loaded = useMemo(
    () => loadedMarksForDate(initialDaily, date),
    [initialDaily, date]
  );
  const [marks, setMarks] = useState<Map<string, DailyMark>>(
    () => new Map(loaded)
  );

  // The per-date `marks` stay in local state, so the grid itself is instant.
  // Submit is the one real write, and it is the slowest in the app for a full
  // class — which is exactly why it holds a pending toast until the stat cards
  // behind it have actually re-pulled `initialDaily`. The route-specific error
  // copy is preserved via ApiError.message (body.error).
  const submitMutation = useMutation({
    mutationFn: (entries: ReturnType<typeof computeSubmitEntries>) =>
      apiFetch('/api/attendance/daily', jsonInit('PATCH', { entries })),
  });

  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  // Passing `null` here REMOVES the student from the working map, which is
  // state (a) — "not touched", and therefore Present on Submit. It is NOT how
  // a mark is taken off a day; that is an entry with no status, state (c).
  // The two are one keystroke apart and mean opposite things.
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
  // An excused absence with no reason is not a record of anything, so Submit
  // refuses the whole day until every one has one. Counting rather than
  // testing `.some()` lets the bar say how many are outstanding — with a
  // roster of thirty, "choose a reason" without a number is a hunt.
  const exMissingReasonCount = [...marks.values()].filter(
    (m) => m.status === 'EX' && !m.exReason
  ).length;
  const exMissingReason = exMissingReasonCount > 0;

  async function submit() {
    const entries = computeSubmitEntries({
      roster,
      marks,
      loaded,
      termId,
      date,
      // An approved filing can exist with nothing on the register behind it,
      // and this is what stops Submit writing Present over such a day. See the
      // guard in computeSubmitEntries for how that happens.
      excusedByFiling: new Set(filings.keys()),
    });
    if (entries.length === 0) {
      toast.info('No changes to submit.');
      return;
    }
    // A submission can carry marks, removals, or both, and "12 updated" would
    // be wrong about a removal — nothing was updated, a day was blanked. Say
    // which happened, in the same words the row and the header use.
    const removed = entries.filter((x) => x.status === null).length;
    const marked = entries.length - removed;
    const markWord = (n: number) => `${n} mark${n === 1 ? '' : 's'}`;
    const success =
      removed === 0
        ? `Saved attendance for ${formatLongDate(date)} (${entries.length} updated).`
        : marked === 0
          ? `Removed ${markWord(removed)} for ${formatLongDate(date)}.`
          : `Saved attendance for ${formatLongDate(date)} (${marked} updated, ${markWord(removed)} removed).`;

    setSaving(true);
    await run(() => submitMutation.mutateAsync(entries), {
      pending: `Saving attendance for ${entries.length} student${entries.length === 1 ? '' : 's'}…`,
      success,
      error: (e) => (e instanceof Error ? e.message : 'Save failed'),
    });
    setSaving(false);
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
            // State (c): the teacher took the mark back off this day. Note the
            // test is on the ENTRY existing with no status — `!m` is state (a),
            // "not touched yet", which means Present and is a different thing.
            const isCleared = !!m && m.status == null;
            // ⚠ Shown on a row NOBODY HAS TOUCHED, which is the point of it
            // being here at all. This register marks the exceptions, so the
            // moment a teacher has to decide between Absent and Excused is
            // before the first click — and until now the daily view was the
            // one marking path that never mentioned the filing.
            //
            // ⚠ Withheld from a "Before enrolment date" row on purpose. That
            // row carries no marking control, is excluded from the submit set
            // outright, and is dimmed — a link nobody can act on there is
            // noise, and it would be the only interactive thing inside a
            // deliberately inert row. Same gate the excused block uses.
            const filing = beforeJoin
              ? null
              : (filings.get(e.enrolmentId) ?? null);
            return (
              <li
                key={e.enrolmentId}
                className={`flex flex-col gap-2 px-4 py-3 ${
                  beforeJoin ? 'bg-muted/40 opacity-40' : ''
                }`}
              >
                {/* Name and marks share one line; the excused block below gets
                    the whole row. Boxing it into the right-hand column left a
                    narrow strip of cyan against a wide empty row. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                      {e.indexNumber}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {e.studentName}
                    </span>
                    {/* Said in words as well as in the control. A cleared row
                        and an untouched row both show four unchosen letters,
                        and they mean opposite things — this is the one that
                        records nothing for the day. */}
                    {isCleared && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Mark removed
                      </span>
                    )}
                  </div>

                  {beforeJoin ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Before enrolment date
                    </span>
                  ) : (
                    /* `spacing={0}` is the group's segmented-control branch —
                       one joined strip, corners on the ends only. */
                    <ToggleGroup
                      type="single"
                      value={m ? (m.status ?? CLEARED) : ''}
                      spacing={0}
                      aria-label={`Attendance mark for ${e.studentName}`}
                      onValueChange={(next) => {
                        // ⚠ THREE STATES HERE, and two of them show four
                        // unchosen letters:
                        //   (a) this student is NOT in `marks` — nobody has
                        //       touched them. This register marks the
                        //       EXCEPTIONS, so leaving the row alone is how
                        //       you say Present, and Submit writes P.
                        //   (b) a chosen letter — P / L / A / EX.
                        //   (c) the eraser — the mark comes OFF the day and
                        //       Submit records nothing for it.
                        // An empty `next` is Radix reporting that the teacher
                        // pressed the segment that was already on. It stays a
                        // no-op: every move between the three states is a
                        // press on the segment you want, never a side effect
                        // of pressing the one you already have.
                        if (!next) return;
                        if (next === CLEARED) {
                          // (c). No reason and no note travel with a removed
                          // mark — the day is blank, so "MC submitted" has
                          // nothing left to describe, and the database
                          // refuses the pair.
                          setMark(e.enrolmentId, {
                            status: null,
                            exReason: null,
                            exNote: null,
                          });
                          return;
                        }
                        setMark(
                          e.enrolmentId,
                          next === 'EX'
                            ? {
                                status: 'EX',
                                exReason: m?.exReason ?? null,
                                exNote: m?.exNote ?? null,
                              }
                            : // Leaving EX drops the note with the reason — a
                              // "why they were excused" note is meaningless on
                              // a Present.
                              {
                                status: next as 'P' | 'L' | 'A',
                                exReason: null,
                                exNote: null,
                              }
                        );
                      }}
                      className="overflow-hidden rounded-lg border border-border"
                    >
                      {MARKS.map(({ status: s, word }) => (
                        <ToggleGroupItem
                          key={s}
                          value={s}
                          aria-label={word}
                          className={cn(
                            MARK_BUTTON,
                            STATUS_TOGGLE_WASH[s],
                            // Unmarked rows submit as Present, so P is shown
                            // as the standing default — in ink, not in wash,
                            // because nobody has actually said so yet.
                            !m && s === 'P' && 'text-foreground',
                            // The wash is a SELECTED colour here, unlike the
                            // term-view tiles where every tile is always
                            // coloured. Off state stays chrome.
                            'bg-transparent hover:bg-muted/60'
                          )}
                        >
                          {s}
                        </ToggleGroupItem>
                      ))}
                      {/* Trailing, past the four marks, because it undoes
                          them rather than joining them. Always offered: for a
                          student with no mark on file the day is already
                          blank, so Submit simply has nothing to write for
                          them — the row still tells the truth. */}
                      <ToggleGroupItem
                        value={CLEARED}
                        aria-label={`Remove the mark for ${e.studentName}`}
                        className={cn(
                          MARK_BUTTON,
                          CLEAR_BUTTON,
                          'bg-transparent hover:bg-muted/60'
                        )}
                      >
                        <Eraser className="size-3.5" aria-hidden="true" />
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                </div>

                {/* What a parent already told the school about this day.
                    Its own full-width line, under the marks and above the
                    excused block: the row's first line is a name and a set of
                    letters, and squeezing a sentence into it would push the
                    control off the edge on a phone. The file already learned
                    this once — see the note above, on why the excused block
                    stopped being a narrow strip in the right-hand column.

                    ⚠ It does NOT replace the note field the way the term
                    sheet's palette does. There, the filing and the note
                    compete for one slot in a small dialog. Here they are in
                    different places — the filing on the row, the note inside
                    the excused block — and the note is where a teacher records
                    what the filing does not cover, such as a child coming back
                    early from a holiday their parent filed to the Friday. */}
                {/* ⚠ NOT for a certificate the office scanned in itself.
                    "Excused by a parent's filing" is false for one of those,
                    and the link goes to a queue that cannot show the row —
                    it goes in with no approval ladder. The certificate band
                    inside the excused block below says what there is to say. */}
                {filing && !filing.recordedBySchool && (
                  <FilingLine filing={filing} studentName={e.studentName} />
                )}

                {/* The excused block, on the cyan of the EX button that opened
                    it — the same "colour as parentage" the term view uses, so
                    the two surfaces read as one feature. Full row width: the
                    reasons and the note are the substance of an excused
                    absence, not an afterthought clinging to the right edge. */}
                {!beforeJoin && m?.status === 'EX' && (
                  <div className="flex animate-in flex-col gap-2 rounded-lg border border-attendance-excused bg-attendance-excused/25 p-2 fade-in-0 slide-in-from-top-1 duration-150">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Reason
                        </span>
                        <ToggleGroup
                          type="single"
                          value={m.exReason ?? ''}
                          spacing={1}
                          aria-label={`Reason for ${e.studentName}`}
                          onValueChange={(next) => {
                            if (!next) return;
                            setMark(e.enrolmentId, {
                              status: 'EX',
                              exReason: next as ExReason,
                              exNote: m.exNote ?? null,
                            });
                          }}
                          className="flex w-auto flex-wrap gap-1"
                        >
                          {EX_REASONS.map((r) => (
                            <ToggleGroupItem
                              key={r}
                              value={r}
                              className="h-auto rounded-md border border-foreground/10 bg-card/50 px-2 py-1 text-[11px] font-normal text-foreground hover:bg-card/80 hover:text-foreground data-[state=on]:bg-attendance-excused data-[state=on]:text-attendance-mark-ink data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-foreground/30 data-[state=on]:font-medium"
                            >
                              {EX_REASON_LABELS[r]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                      {!m.exReason && (
                        <p className="text-[11px] font-medium text-brand-amber">
                          Choose a reason to submit.
                        </p>
                      )}
                    </div>

                    {/* Christina's ask (2026-07-31, 31:07) and Melissa's
                        (32:44): somewhere to say WHY, since the MC document itself can't be
                        uploaded yet. Updates on
                        change rather than on blur — this view batches
                        everything behind an explicit Submit, so there is no
                        per-keystroke write to worry about.

                        Disabled until a reason is chosen, matching the term
                        view: an excused absence with no reason is not a record
                        of anything, and Submit already refuses one. Saying so
                        on the row names WHICH student, which the submit bar
                        cannot. */}
                    {/* ⚠ ONE EDITOR PER EXCUSED ROW, NOT PER ROW. This whole
                        block is behind `m?.status === 'EX'`, so a class of 30
                        mounts an editor only for the handful actually marked
                        excused. Do not lift the field out of that condition —
                        a rich-text field is a full editor instance, not a
                        `<textarea>`, and 30 of them on one screen is a
                        different page. */}
                    <RichTextEditor
                      rows={2}
                      value={m.exNote ?? ''}
                      disabled={!m.exReason}
                      maxLength={EX_NOTE_MAX_LENGTH}
                      onChange={(next) =>
                        setMark(e.enrolmentId, {
                          status: 'EX',
                          exReason: m.exReason ?? null,
                          exNote: next,
                        })
                      }
                      placeholder={EX_NOTE_PLACEHOLDER}
                      aria-label={`Note for ${e.studentName}`}
                    />

                    {/* The certificate for this day — the same control the
                        term sheet's marking dialog carries, imported rather
                        than rebuilt. Mr Ace: *"the simplest way is just allow
                        the SIS users to upload the MC."*

                        ⚠ NOT ON A FAMILY HOLIDAY. A travel filing carries no
                        certificate and the schema forbids it one, so the band
                        is absent rather than present-and-refusing — the same
                        absence-only rule `FilingLine` follows when it declines
                        to say "no certificate" on a holiday.

                        ⚠ It writes on its own, and does NOT wait for Submit.
                        The certificate is evidence about the day; the marks
                        below are the register. Holding proof hostage to a
                        batch the teacher may abandon is how it ends up back in
                        a drawer. */}
                    {filing?.kind !== 'travel' && (
                      <>
                        <div
                          className="h-px bg-foreground/10"
                          aria-hidden="true"
                        />
                        <MedicalCertificateField
                          sectionStudentId={e.enrolmentId}
                          date={date}
                          studentName={e.studentName}
                          hasCertificate={filing?.hasEvidence === true}
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
        <p
          className={cn(
            'text-xs',
            exMissingReason
              ? 'font-medium text-brand-amber'
              : 'text-muted-foreground'
          )}
        >
          {exMissingReason
            ? exMissingReasonCount === 1
              ? '1 excused student still needs a reason.'
              : `${exMissingReasonCount} excused students still need a reason.`
            : /* `unmarked` joins `present` because an untouched row submits
                 P — that is the register's convention. `cleared` must NOT:
                 those students end the day with nothing recorded, so
                 counting them present would be the header telling the
                 teacher the opposite of what Submit is about to write. */
              `${counts.P + counts.unmarked} present · ${counts.L + counts.A + counts.EX} exceptions${
                counts.cleared > 0
                  ? ` · ${counts.cleared} mark${counts.cleared === 1 ? '' : 's'} removed`
                  : ''
              }`}
        </p>
        <Button
          onClick={() => void submit()}
          loading={saving}
          loadingText="Submitting…"
          disabled={exMissingReason}
        >
          Submit attendance
        </Button>
      </div>
    </div>
  );
}

/**
 * What an approved parent filing put on this day — on the roster row.
 *
 * ⚠ THE SAME FACT AS THE TERM SHEET'S `FilingCard`, SO IT SAYS THE SAME WORDS.
 * The phrase, the two icons, the date range, the certificate clause and the
 * link out are lifted from `cell-mark-dialog.tsx` deliberately and must not be
 * reworded here: a filing wears one symbol wherever a person meets it, and a
 * teacher who reads "Excused by a parent's filing" on the term sheet and
 * something else on the daily register has met two features, not one.
 *
 * ⚠ IT IS A SEPARATE COMPONENT ONLY BECAUSE `FilingCard` IS PRIVATE. Nothing
 * about the two is meant to differ except the box: this one is tighter
 * (`rounded-lg`, less padding, smaller icons) because it repeats down a roster
 * of thirty rather than sitting alone in a dialog. Same paint, same tokens —
 * `bg-muted` at rest, the indigo hover wash, the icon in `brand-indigo`.
 *
 * ⚠ NOBODY IS NAMED. The palette drops the parent and the approver at rest for
 * a reason that holds twice as hard on a list: the question a teacher is
 * answering is "why is this day excused", not "who sent it", and the only
 * identifier held reliably is an email address, which answers neither. Both are
 * on the filing, behind the link, where the queue does its own scoping.
 */
function FilingLine({
  filing,
  studentName,
}: {
  filing: CellFiling;
  studentName: string;
}) {
  const isTravel = filing.kind === 'travel';
  const Icon = isTravel ? Plane : FileText;
  // ⚠ Built as a string, never as JSX text wrapped around an expression. The
  // dialog learned this the hard way — JSX drops the whitespace between an
  // expression and an adjacent newline, so a formatter wrapping the line runs
  // two words together on screen.
  const phrase = isTravel
    ? "Excused by a parent's travel filing"
    : "Excused by a parent's filing";
  return (
    <a
      href={filing.href}
      target="_blank"
      rel="noreferrer"
      // Thirty of these can sit on one page, so the link has to say WHOSE it
      // is. The visible sentence is the same on every row; a screen reader
      // listing the links would otherwise read thirty identical entries.
      aria-label={`${phrase} for ${studentName}`}
      className="group flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 transition-colors hover:bg-accent"
    >
      <Icon className="size-3.5 shrink-0 text-brand-indigo" aria-hidden />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        <span className="font-semibold">{phrase}</span>
        <span className="text-muted-foreground">
          {' · '}
          {filing.dateRange}
          {/* ⚠ The absence of proof is STATED. A parent may file without a
              certificate, and a teacher reading only "excused by a filing"
              would assume one exists.

              ⚠ ABSENCE ONLY. A holiday has no certificate to have or lack, so
              "no certificate" there would invent a missing document nobody
              ever asked the parent for. */}
          {isTravel
            ? ''
            : filing.hasEvidence
              ? ' · certificate'
              : ' · no certificate'}
        </span>
      </span>
      <ArrowUpRight
        className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        aria-hidden
      />
    </a>
  );
}
