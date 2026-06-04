'use client';

// CalendarAdminClient (operational orchestrator) — composes the already-built
// calendar pieces into a working surface: a Term selector + view switcher +
// filters + add action (CalendarToolbar), a legend, the active view (Month /
// List functional; Week / Day are placeholders until a later task), a day-action
// sheet, and the event editor dialog.
//
// Term-scoped: receives the whole AY's dated terms + calendar rows + events, but
// scopes everything to the selected term before filtering / indexing. The Term
// selector chooses the term (defaults to the current active term); the view tabs
// (Month / Week / Day / List) are all scoped to it. Between-term break days are
// simply outside every term window, so they never appear. Every visible in-term
// day is editable (it has a term to write to).
//
// Design system §5/§6: this is a composition page. It owns no bespoke grid
// markup — the views/toolbar/legend/sheet carry their own design-compliant
// JSX. The only local markup is a centered muted placeholder card for the
// not-yet-built views and the page stack spacing. Tokens only (Hard Rule #7).

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  CalendarToolbar,
  type CalendarView,
} from '@/components/attendance/calendar/calendar-toolbar';
import { DayActionSheet } from '@/components/attendance/calendar/day-action-sheet';
import { EventEditorDialog } from '@/components/attendance/calendar/event-editor-dialog';
import { Legend } from '@/components/attendance/calendar/legend';
import { MonthView } from '@/components/attendance/calendar/views/month-view';
import { WeekView } from '@/components/attendance/calendar/views/week-view';
import { DayView } from '@/components/attendance/calendar/views/day-view';
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
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';

// ─── Types ──────────────────────────────────────────────────────────────────

type DatedTerm = {
  id: string;
  label: string;
  termNumber: number;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function firstOfMonthFromIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
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

  // ── Selected term ─────────────────────────────────────────────────────────────
  // Default to the current active term (date-resolved, with the layered fallback
  // in resolveCurrentTermId), else the first term.
  const [selectedTermId, setSelectedTermId] = useState<string>(() => {
    const resolved = resolveCurrentTermId(
      terms.map((t) => ({
        id: t.id,
        term_number: t.termNumber,
        start_date: t.startDate,
        end_date: t.endDate,
      })),
      sgToday()
    );
    return resolved ?? terms[0]?.id ?? '';
  });

  const selectedTerm = useMemo(
    () => terms.find((t) => t.id === selectedTermId) ?? terms[0],
    [terms, selectedTermId]
  );

  // Cursor seeds to the selected term's start month.
  const initialCursor = useMemo(
    () =>
      selectedTerm
        ? firstOfMonthFromIso(selectedTerm.startDate)
        : firstOfMonthFromIso(sgToday()),
    [selectedTerm]
  );

  const { view, setView, cursor, setCursor, filterState, setFilterState } =
    useCalendarViewState(initialCursor);

  // ── Term-change cursor reset (render-time sync, no useEffect) ──────────────────
  // When the selected term changes, reset the Month cursor to that term's start
  // month. Mirrors the day-sheet lastIso render-time-sync pattern: track the
  // last-applied term id in state and reconcile during render. Setting state in
  // render is safe (React bails out and re-renders synchronously before paint).
  const [lastTermId, setLastTermId] = useState<string>(selectedTermId);
  if (lastTermId !== selectedTermId) {
    setLastTermId(selectedTermId);
    setCursor(initialCursor);
  }

  // ── Term-scope the data BEFORE filtering / indexing ───────────────────────────
  const scopedCalendar = useMemo(
    () => calendar.filter((c) => c.termId === selectedTermId),
    [calendar, selectedTermId]
  );
  const scopedEvents = useMemo(
    () => events.filter((e) => e.termId === selectedTermId),
    [events, selectedTermId]
  );

  // Filtered slices feed the views + the index. The day sheet deliberately
  // reads the term-scoped UNFILTERED events so it always shows every event on
  // the clicked day regardless of the active filters.
  const filteredCalendar = useMemo(
    () => filterDays(scopedCalendar, filterState),
    [scopedCalendar, filterState]
  );
  const filteredEvents = useMemo(
    () => filterEvents(scopedEvents, filterState),
    [scopedEvents, filterState]
  );
  const index = useCalendarIndex(filteredCalendar, filteredEvents, level);

  // Resolve the term that owns a given iso date (null when in a break / outside).
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

  // Views only show in-term days, so the clicked day always belongs to the
  // selected term and is editable.
  const daySheetRow: SchoolCalendarRow | null = daySheetIso
    ? (scopedCalendar.find(
        (c) => c.date === daySheetIso && c.audience === level
      ) ??
      index.byDate.get(daySheetIso) ??
      null)
    : null;
  // Term-scoped, unfiltered events on the day, so the sheet lists everything.
  const daySheetEvents = daySheetIso
    ? scopedEvents.filter(
        (e) => daySheetIso >= e.startDate && daySheetIso <= e.endDate
      )
    : [];

  // ── Event editor state ──────────────────────────────────────────────────────
  // `editorOpen` drives create; `editorEditing` drives edit. The dialog needs
  // term bounds — resolved ONCE at open time and frozen in state so that
  // navigating the month while the dialog is open does NOT reset the form.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEditing, setEditorEditing] = useState<CalendarEventRow | null>(
    null
  );
  // Frozen snapshot of the term resolved at dialog-open time. Lives in state so
  // month navigation (cursor changes) never mutates it while the dialog is open.
  const [frozenTerm, setFrozenTerm] = useState<DatedTerm | null>(null);
  // When adding from a specific day, we also freeze the seed iso so the date
  // fields default to that day (not the whole term span).
  const [frozenIso, setFrozenIso] = useState<string | null>(null);

  const openEventEditor = useCallback(
    (editing: CalendarEventRow | null, iso?: string) => {
      setEditorEditing(editing);
      if (editing) {
        // Edit path: freeze to the term containing the event's own start date,
        // falling back to the selected term.
        setFrozenTerm(termForIso(editing.startDate) ?? selectedTerm ?? null);
        setFrozenIso(null);
      } else if (iso) {
        // Add-from-day path: the clicked day is always in the selected term.
        setFrozenTerm(selectedTerm ?? null);
        setFrozenIso(iso);
      } else {
        // Toolbar add (no iso): freeze to the selected term — the surface is
        // term-scoped, so the selected term is the unambiguous target.
        setFrozenTerm(selectedTerm ?? null);
        setFrozenIso(null);
      }
      setEditorOpen(true);
    },
    [termForIso, selectedTerm]
  );

  const closeEventEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorEditing(null);
    setFrozenTerm(null);
    setFrozenIso(null);
  }, []);

  // Use the frozen snapshot exclusively — never recompute from live cursor.
  const editorTerm = frozenTerm;

  // For a single-day add (from the sheet), seed both bounds to that day so the
  // event defaults to that date rather than the whole term span.
  const editorStart =
    !editorEditing && frozenIso ? frozenIso : (editorTerm?.startDate ?? '');
  const editorEnd =
    !editorEditing && frozenIso ? frozenIso : (editorTerm?.endDate ?? '');

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
        terms={terms.map((t) => ({ id: t.id, label: t.label }))}
        selectedTermId={selectedTermId}
        onSelectTerm={setSelectedTermId}
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

      {view === 'month' && selectedTerm && (
        <MonthView
          term={{
            startDate: selectedTerm.startDate,
            endDate: selectedTerm.endDate,
          }}
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

      {view === 'week' && selectedTerm && (
        <WeekView
          term={{
            startDate: selectedTerm.startDate,
            endDate: selectedTerm.endDate,
          }}
          index={index}
          cursor={cursor}
          onCursor={setCursor}
          onDayClick={openDay}
        />
      )}

      {view === 'day' && selectedTerm && (
        <DayView
          term={{
            startDate: selectedTerm.startDate,
            endDate: selectedTerm.endDate,
          }}
          index={index}
          cursor={cursor}
          onCursor={setCursor}
          onDayClick={openDay}
        />
      )}

      <DayActionSheet
        iso={daySheetIso}
        termId={selectedTermId}
        audience={level}
        row={daySheetRow}
        events={daySheetEvents}
        editable={true}
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
