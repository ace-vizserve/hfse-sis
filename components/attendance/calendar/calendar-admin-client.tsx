'use client';

// CalendarAdminClient (operational orchestrator) — composes the already-built
// calendar pieces into a working surface: a view switcher + filters + add
// action (CalendarToolbar), a legend, the active view (Month / List functional;
// Term / Week / Day are placeholders until Tasks 12–13), a day-action sheet,
// and the event editor dialog.
//
// AY-wide: receives the whole AY's dated terms + calendar rows + events, so the
// Month view can navigate continuously across terms and the List view shows the
// full year's exceptions. Day editability is per-day — a day in a between-terms
// break has no term to write to, so its sheet is read-only.
//
// Design system §5/§6: this is a composition page. It owns no bespoke grid
// markup — the views/toolbar/legend/sheet carry their own design-compliant
// JSX. The only local markup is a centered muted placeholder card for the
// not-yet-built views and the page stack spacing. Tokens only (Hard Rule #7).

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';

import {
  CalendarToolbar,
  type CalendarView,
} from '@/components/attendance/calendar/calendar-toolbar';
import { DayActionSheet } from '@/components/attendance/calendar/day-action-sheet';
import { EventEditorDialog } from '@/components/attendance/calendar/event-editor-dialog';
import { Legend } from '@/components/attendance/calendar/legend';
import { MonthView } from '@/components/attendance/calendar/views/month-view';
import { ListView } from '@/components/attendance/calendar/views/list-view';
import { useCalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { useCalendarViewState } from '@/components/attendance/calendar/hooks/use-calendar-view-state';
import {
  CopyFromPriorAyDialog,
  type CopyFromPriorAyProps,
} from '@/components/attendance/copy-from-prior-ay-dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { filterDays, filterEvents } from '@/lib/attendance/calendar-filters';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { Audience } from '@/lib/schemas/attendance';

// ─── Types ──────────────────────────────────────────────────────────────────

type DatedTerm = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type CalendarAdminClientProps = {
  ayId: string;
  /** AY-wide dated terms (already filtered to those with start + end). */
  terms: DatedTerm[];
  /** Active audience filter from the ?audience param (default 'all'). */
  level: Audience;
  /** AY-wide school_calendar rows. */
  calendar: SchoolCalendarRow[];
  /** AY-wide calendar_events rows. */
  events: CalendarEventRow[];
  /** Optional carry-forward props for the prior-AY copy dialog. */
  copyFromPriorAyProps?: CopyFromPriorAyProps | null;
};

const EMPTY_SET: Set<string> = new Set();

// ─── Cursor seed ──────────────────────────────────────────────────────────────
// first-of-month of the term containing today, else the AY's first term's start
// month. Local-date safe (no UTC shift).

function sgTodayIso(): string {
  // SGT (UTC+8) calendar date — matches the page's term-resolution convention.
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function firstOfMonthFromIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

function computeInitialCursor(terms: DatedTerm[]): Date {
  if (terms.length === 0) {
    return firstOfMonthFromIso(sgTodayIso());
  }
  const today = sgTodayIso();
  const containing = terms.find(
    (t) => today >= t.startDate && today <= t.endDate
  );
  const anchor = containing ?? terms[0];
  // For the containing term, open on today's month; otherwise on the term start.
  return firstOfMonthFromIso(containing ? today : anchor.startDate);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export function CalendarAdminClient({
  terms,
  level,
  calendar,
  events,
  copyFromPriorAyProps,
}: CalendarAdminClientProps) {
  const router = useRouter();

  const initialCursor = useMemo(() => computeInitialCursor(terms), [terms]);
  const { view, setView, cursor, setCursor, filterState, setFilterState } =
    useCalendarViewState(initialCursor);

  // Filtered slices feed the views + the index. The day sheet deliberately
  // reads UNFILTERED events so it always shows every event on the clicked day.
  const filteredCalendar = useMemo(
    () => filterDays(calendar, filterState),
    [calendar, filterState]
  );
  const filteredEvents = useMemo(
    () => filterEvents(events, filterState),
    [events, filterState]
  );
  const index = useCalendarIndex(filteredCalendar, filteredEvents, level);

  // Resolve the term that owns a given iso date (null when in a break).
  const termForIso = useCallback(
    (iso: string): DatedTerm | null =>
      terms.find((t) => iso >= t.startDate && iso <= t.endDate) ?? null,
    [terms]
  );

  // ── Day-action sheet state ──────────────────────────────────────────────────
  const [daySheetIso, setDaySheetIso] = useState<string | null>(null);

  const openDay = useCallback((iso: string) => {
    setDaySheetIso(iso);
  }, []);

  const daySheetTerm = daySheetIso ? termForIso(daySheetIso) : null;
  // Edit the row for the audience currently being managed; fall back to the
  // precedence-resolved row so the sheet still reflects the day's state.
  const daySheetRow: SchoolCalendarRow | null = daySheetIso
    ? (calendar.find((c) => c.date === daySheetIso && c.audience === level) ??
      index.byDate.get(daySheetIso) ??
      null)
    : null;
  // Unfiltered events on the day, so the sheet lists everything.
  const daySheetEvents = daySheetIso
    ? events.filter(
        (e) => daySheetIso >= e.startDate && daySheetIso <= e.endDate
      )
    : [];

  // ── Event editor state ──────────────────────────────────────────────────────
  // `editorOpen` drives create; `editorEditing` drives edit. The dialog needs
  // term bounds — resolved from the editing event's term, the clicked day's
  // term, or (toolbar add) the term containing the cursor month → first term.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEditing, setEditorEditing] = useState<CalendarEventRow | null>(
    null
  );
  const [editorIso, setEditorIso] = useState<string | null>(null);

  const openEventEditor = useCallback(
    (editing: CalendarEventRow | null, iso?: string) => {
      setEditorEditing(editing);
      setEditorIso(iso ?? null);
      setEditorOpen(true);
    },
    []
  );

  const closeEventEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorEditing(null);
    setEditorIso(null);
  }, []);

  // Which term bounds the editor uses.
  const editorTerm: DatedTerm | null = useMemo(() => {
    if (editorEditing) return termForIso(editorEditing.startDate);
    if (editorIso) return termForIso(editorIso);
    // Toolbar add: prefer the term overlapping the visible month, else first.
    const monthStartIso = `${cursor.getFullYear()}-${String(
      cursor.getMonth() + 1
    ).padStart(2, '0')}-01`;
    const lastDay = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0
    ).getDate();
    const monthEndIso = `${cursor.getFullYear()}-${String(
      cursor.getMonth() + 1
    ).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const overlapping = terms.find(
      (t) => t.startDate <= monthEndIso && t.endDate >= monthStartIso
    );
    return overlapping ?? terms[0] ?? null;
  }, [editorEditing, editorIso, cursor, terms, termForIso]);

  // For a single-day add (from the sheet), seed both bounds to that day so the
  // event defaults to that date rather than the whole term span.
  const editorStart =
    !editorEditing && editorIso ? editorIso : (editorTerm?.startDate ?? '');
  const editorEnd =
    !editorEditing && editorIso ? editorIso : (editorTerm?.endDate ?? '');

  // ── Delete an event ─────────────────────────────────────────────────────────
  const deleteEvent = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/attendance/calendar/events?id=${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            (body as { error?: string }).error ?? 'Failed to delete event'
          );
        toast.success('Event deleted');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to delete event');
      }
    },
    [router]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <CalendarToolbar
        view={view}
        onView={setView}
        filterState={filterState}
        onFilter={setFilterState}
        onAddEvent={() => openEventEditor(null)}
        copyFromPriorAy={
          copyFromPriorAyProps ? (
            // Rendered inside the Add dropdown; onSelect-prevented so the
            // dialog's own trigger handles open/close without the menu
            // swallowing the click.
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="p-0 focus:bg-transparent"
            >
              <CopyFromPriorAyDialog {...copyFromPriorAyProps} />
            </DropdownMenuItem>
          ) : undefined
        }
      />

      <Legend />

      {view === 'month' && (
        <MonthView
          terms={terms}
          index={index}
          cursor={cursor}
          onCursor={setCursor}
          selectedIsos={EMPTY_SET}
          onDayClick={openDay}
        />
      )}

      {view === 'list' && (
        <ListView
          days={filteredCalendar}
          events={filteredEvents}
          onRowClick={openDay}
        />
      )}

      {(view === 'term' || view === 'week' || view === 'day') && (
        <ComingSoonView />
      )}

      <DayActionSheet
        iso={daySheetIso}
        termId={daySheetTerm?.id ?? ''}
        audience={level}
        row={daySheetRow}
        events={daySheetEvents}
        editable={!!daySheetTerm}
        onClose={() => setDaySheetIso(null)}
        onSaved={() => router.refresh()}
        onAddEvent={(iso) => openEventEditor(null, iso)}
        onEditEvent={(e) => openEventEditor(e)}
        onDeleteEvent={deleteEvent}
      />

      <EventEditorDialog
        open={editorOpen}
        termId={editorTerm?.id ?? ''}
        termStart={editorStart}
        termEnd={editorEnd}
        defaultAudience={level}
        editing={editorEditing}
        onClose={closeEventEditor}
        onCreated={() => {
          closeEventEditor();
          router.refresh();
        }}
      />
    </div>
  );
}

// ─── Placeholder for not-yet-built views (Term / Week / Day) ────────────────────

function ComingSoonView() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-muted/25 px-6 py-16 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
      <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <CalendarClock className="size-5" />
      </div>
      <p className="font-serif text-lg font-semibold tracking-tight text-foreground">
        This view is coming in this release
      </p>
      <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        Use <span className="font-medium text-foreground">Month</span> or{' '}
        <span className="font-medium text-foreground">List</span> for now.
      </p>
    </div>
  );
}
