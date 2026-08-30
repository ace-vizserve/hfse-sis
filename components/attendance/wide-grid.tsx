'use client';

import Link from 'next/link';

// Attendance wide grid. Rows = students (~30), columns = term school-days
// (~47). Cell count at HFSE scale: ~1,410 per render.
//
// Render-perf invariants — do not regress:
//   1. Each cell is a plain <button> (CellButton), NOT a per-cell Radix
//      Select/Dialog. There is exactly ONE shared marking dialog for the
//      whole grid, opened on the active cell (state: `activeCell`). 1,410
//      portals would be catastrophic — one is fine. Don't give cells their own
//      portal-mounting picker.
//   2. State lives in a single `cells` Map keyed by `${enrolmentId}|${date}`.
//      Avoid prop-drilling per-cell state — a parent re-render on unrelated
//      state (a new useState added to the parent page, say) cascades into
//      1,410 cell re-renders. The parent today is a pure server component
//      so there's no client state to leak. Keep it that way.
//   3. `columns` and `monthGroups` are `useMemo`'d on (calendar, events).
//      The calendar array identity comes from a server fetch — it only
//      changes on `router.refresh()`. Don't wrap the calendar prop in
//      something that changes reference per render.
//
// If 47 days grows to ~180 (period-level Phase 2), revisit: the grid would
// jump to ~5,400 cells and native selects start to feel sluggish on low-end
// Chromebooks. At that point look at column virtualization (react-window)
// or a paginated-by-week view.

import { Bus, CalendarDays, Star, Users } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Local-tz ISO for today. Inline helper — the file doesn't pull from
// lib/attendance/calendar.ts to stay a pure client leaf.
function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import { resolveColumnTag } from '@/lib/attendance/sheet-columns';
import { COLUMN_TAG_COLOR } from '@/components/attendance/column-tags';
import {
  CellMarkDialog,
  type CellFiling as WideGridCellFiling,
} from '@/components/attendance/cell-mark-dialog';
import { countVacationTrips } from '@/lib/attendance/vacation-trips';
// Re-exported so the page can build the map without reaching past the grid
// into the dialog it happens to render.
export type { CellFiling as WideGridCellFiling } from '@/components/attendance/cell-mark-dialog';
import { EnrolmentMetaEditor } from '@/components/attendance/enrolment-meta-editor';
import { statusCellWash } from '@/components/attendance/status-wash';
import { Sheet } from '@/components/ui/sheet';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import {
  ATTENDANCE_STATUS_LABELS,
  DAY_TYPE_LABELS,
  EX_REASON_LABELS,
  isEncodableDayType,
  type AttendanceStatus,
  type DayType,
  type ExReason,
} from '@/lib/schemas/attendance';

// COLUMN_TAG_COLOR (date-column tag → ChartLegendChip color) is shared with the
// sheet-context card's term-calendar key — see components/attendance/column-tags.ts (§10.2).

// STATUS_CELL_WASH (status → HFSE paper-palette wash) + statusCellWash now live
// in components/attendance/status-wash.ts — shared single source (§10.2) for the
// grid cells, the legend, AND the cell-mark dialog's segmented track. Its NC
// entry stays: the palette no longer OFFERS "no class", but stored NC rows are
// still real data and still have to paint.

// The sheet's legend (status swatches + day-type chips) lives in
// components/attendance/sheet-legend.tsx, mounted in the register card above
// this grid — it used to sit below the grid, out of reach of the person
// actually reading a cell.

// Faint per-day-type cell tint, kept under the gradient pill so non-
// school-day columns read as a vertical band even when no status is set.
const DAY_TYPE_CELL_BG: Record<DayType, string> = {
  school_day: '',
  public_holiday: 'bg-gradient-to-b from-destructive/8 to-destructive/0',
  school_holiday: 'bg-gradient-to-b from-brand-amber/8 to-brand-amber/0',
  hbl: 'bg-gradient-to-b from-primary/8 to-primary/0',
  no_class: 'bg-gradient-to-b from-muted/30 to-muted/10',
};

export type WideGridEnrolment = {
  enrolmentId: string;
  indexNumber: number;
  studentNumber: string;
  studentName: string;
  busNo: string | null;
  classroomOfficerRole: string | null;
  academicsNotes: string | null;
  adminNotes: string | null;
  withdrawn: boolean;
  compassionateUsed: number;
  compassionateAllowance: number;
  // KD #94 — vacation-leave quota (per-term scope). When marking an EX as
  // vacation, the grid checks `vlUsedThisTerm + 1 > vlAllowance` to fire a
  // soft warning (toast only — write still proceeds).
  vlUsedThisTerm: number;
  vlAllowance: number;
  // ISO date string (YYYY-MM-DD) when the student joined the section; null for
  // non-late-enrollees (enrolled from day 1). Used to dim cells before the
  // student was part of the class.
  enrollmentDate: string | null;
};

// The per-cell native <select> + <optgroup> was replaced by a single shared
// "marking palette" dialog (components/attendance/cell-mark-dialog.tsx) opened
// on the active cell — see the cell render + <CellMarkDialog> below.

// No per-cell `saving`/`savedAt` here. A cell used to carry its own spinner and
// then a tick for 1.5s, which put ~1,410 potential indicators on one screen and
// still left the teacher free to start a second edit on top of an unwritten
// one. The whole grid now reports the write instead — dimmed while it runs
// (`isSaving`), and a toast when it lands.
type CellState = {
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  /** Free-text "why" on an EX mark. Shown in the tooltip + a corner dot. */
  exNote: string | null;
};

type GridKey = string; // `${enrolmentId}|${date}`

function keyFor(enrolmentId: string, date: string): GridKey {
  return `${enrolmentId}|${date}`;
}

// "Monday, 14 July 2026" for the marking dialog's header (on-screen only —
// browser ICU).
//
// ⚠ THE LONG FORM, not the "14 Jul" the popover used. With the editor no
// longer floating beside the cell it came from, the header is what confirms
// which day is being marked — and a teacher scrolling a 47-column row needs
// the weekday to catch an off-by-one column before they save, not after.
function cellDateLabel(iso: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  ).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function AttendanceWideGrid({
  sectionId,
  termId,
  enrolments,
  calendar,
  events,
  initialDaily,
  canWriteNc,
  canEditBusCare,
  canEditAcademics,
  canEditAdmin,
  filingsByCell,
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  /**
   * Whether this user may write "no class" marks — registrar and above.
   *
   * ⚠ NOTHING IN THE GRID READS THIS ANY MORE, AND IT IS KEPT ON PURPOSE
   * (2026-08-31). "No class" left the marking palette because it is not a
   * mark a person picks — a day the class did not meet is set on the school
   * calendar, which the register card above links to. But the permission it
   * describes did NOT go away: `PATCH /api/attendance/daily` still refuses an
   * NC write from anyone below registrar, and that guard is what actually
   * enforces the rule, since the route is reachable from the daily register
   * and from imports without ever passing through this component.
   *
   * So the page keeps computing it, the route keeps checking it, and this prop
   * stays as the visible thread between them. Deleting it here would read to
   * the next person as though the restriction had been lifted.
   */
  canWriteNc: boolean;
  canEditBusCare: boolean;
  canEditAcademics: boolean;
  canEditAdmin: boolean;
  /**
   * `enrolmentId|yyyy-MM-dd` → the approved parent filing covering that day.
   *
   * Loaded for the whole term server-side rather than fetched per cell: the
   * marking popover has to open instantly, and a request on click would put a
   * spinner inside the one control that exists to make marking fast.
   */
  filingsByCell?: Record<string, WideGridCellFiling>;
}) {
  // Seed cell state map from the latest-per-(date) rows we already fetched.
  const seed = useMemo(() => {
    const m = new Map<GridKey, CellState>();
    for (const r of initialDaily) {
      const k = keyFor(r.sectionStudentId, r.date);
      // initialDaily is filtered to latest-per-key by the query already.
      m.set(k, {
        status: r.status,
        exReason: r.exReason,
        exNote: r.exNote,
      });
    }
    return m;
  }, [initialDaily]);

  const [cells, setCells] = useState<Map<GridKey, CellState>>(
    () => new Map(seed)
  );

  // See the prop's own doc comment: the grid no longer offers "no class", but
  // the permission behind it is still enforced server-side and the prop is the
  // thread that says so.
  void canWriteNc;

  const [showDetails, setShowDetails] = useState(false);
  // The one open cell-mark dialog (single portal — see the marking-palette note
  // above and the perf invariants in the file header). null = closed, and it is
  // ALSO what rings the cell being edited: with the editor no longer floating
  // beside its cell, that ring is the only thing telling a teacher which of
  // ~1,410 days they have open.
  const [activeCell, setActiveCell] = useState<{
    enrolmentId: string;
    iso: string;
  } | null>(null);

  // The one open roster-metadata editor sheet (single portal, mirrors the
  // cell-mark dialog's perf invariant above). null = closed.
  const [activeMetaEnrolmentId, setActiveMetaEnrolmentId] = useState<
    string | null
  >(null);

  // Sticky roster columns, left-to-right, with each one's cumulative
  // `left` offset — computed (not hardcoded) since which optional columns
  // render depends on `showDetails`/`canEditAcademics`/`canEditAdmin`.
  // Bus/Student Care is always the "+1" when Details is on (edit affordance
  // gated separately); Academics/Admin are entirely present-or-absent based
  // on their own capability flag — hidden, not shown-disabled. The colgroup
  // entry count, the "Roster" banner colSpan, the header cell count, and
  // each body row's cell count all derive from this single array so they
  // can never drift out of lockstep.
  const stickyCols = useMemo(() => {
    const cols: Array<{ key: string; width: number }> = [
      { key: 'index', width: 40 },
      { key: 'student', width: 180 },
    ];
    if (showDetails) cols.push({ key: 'busCare', width: 120 });
    if (showDetails && canEditAcademics) {
      cols.push({ key: 'academics', width: 90 });
    }
    if (showDetails && canEditAdmin) cols.push({ key: 'admin', width: 90 });
    let left = 0;
    return cols.map((c) => {
      const withLeft = { ...c, left };
      left += c.width;
      return withLeft;
    });
  }, [showDetails, canEditAcademics, canEditAdmin]);
  const stickyOf = (key: string) => {
    const col = stickyCols.find((c) => c.key === key);
    return col ?? { key, width: 0, left: 0 };
  };
  const isLastSticky = (key: string) =>
    stickyCols[stickyCols.length - 1]?.key === key;

  // Stable callback (identity never changes — `setActiveCell` is a useState
  // setter) so the memoized `CellButton` below can take `onOpen` as a prop
  // without invalidating its memo on every parent render. Cells pass their
  // own enrolmentId/iso as primitive props instead of baking them into a
  // fresh per-cell closure.
  const openCell = useCallback((enrolmentId: string, iso: string) => {
    setActiveCell({ enrolmentId, iso });
  }, []);

  function busCareLabel(e: WideGridEnrolment): string {
    return [e.busNo, e.classroomOfficerRole].filter(Boolean).join(' / ') || '—';
  }

  function updateCell(k: GridKey, patch: Partial<CellState>) {
    setCells((current) => {
      const next = new Map(current);
      const prev = next.get(k) ?? {
        status: null,
        exReason: null,
        exNote: null,
      };
      next.set(k, { ...prev, ...patch });
      return next;
    });
  }

  // Autosave grid: the cell state stays in the local `cells` Map with its own
  // optimistic write + revert-on-failure (unchanged). The per-cell PATCH goes
  // through useMutation so it gets the shared retry: 0 + apiFetch error
  // handling, and through `useWriteAction` so it reports itself the way every
  // other write in the app does — one pending/success/error toast lifecycle,
  // with the success held until the server re-render lands.
  const saveCellMutation = useMutation({
    mutationFn: (payload: {
      sectionStudentId: string;
      termId: string;
      date: string;
      // `null` CLEARS the day (migration 134) — the route appends a row with
      // no status, which supersedes the prior mark and falls out of every
      // rollup, so the cell reads as never marked.
      status: AttendanceStatus | null;
      exReason: ExReason | null;
      exNote?: string | null;
    }) => apiFetch('/api/attendance/daily', jsonInit('PATCH', payload)),
  });

  // The stat cards above this grid (average attendance, perfect attendance)
  // are rendered by the page's server component from the rollup that each
  // write recomputes, so they are stale the moment a mark lands. The refresh
  // that fixes them is no longer debounced here — `useWriteAction` awaits it
  // as part of the write, which is also what the grid's disabled state waits
  // on: one edit at a time, and the numbers above are right before the next
  // one can start.

  // Low-frequency roster-metadata edit (Bus/Care, Academics, Admin notes).
  const metaMutation = useMutation({
    mutationFn: (vars: {
      enrolmentId: string;
      patch: Record<string, string | null>;
    }) =>
      apiFetch(
        `/api/sections/${sectionId}/students/${vars.enrolmentId}`,
        jsonInit('PATCH', vars.patch)
      ),
  });

  const run = useWriteAction();
  // Not `metaMutation.isPending` — that goes false when the PATCH resolves,
  // which is before the roster pane behind the editor has re-rendered.
  const [metaSaving, setMetaSaving] = useState(false);

  // A cell save is in flight. The whole register is dimmed and made
  // non-interactive while it runs, so a second mark cannot be started on top
  // of one that has not been written yet. Not `saveCellMutation.isPending` —
  // that clears when the PATCH resolves, which is before the refreshed stat
  // cards above the grid have rendered.
  const [isSaving, setIsSaving] = useState(false);

  async function saveMeta(vars: {
    enrolmentId: string;
    patch: Record<string, string | null>;
  }) {
    setMetaSaving(true);
    await run(() => metaMutation.mutateAsync(vars), {
      pending: 'Saving…',
      success: 'Saved.',
      error: (e) => (e instanceof Error ? e.message : 'Could not save.'),
      onResolved: () => setActiveMetaEnrolmentId(null),
    });
    setMetaSaving(false);
  }

  async function writeCell(
    enrolmentId: string,
    date: string,
    // `null` CLEARS the cell — migration 134. It is a write like any other:
    // optimistic here, reverted the same way on failure, and reported through
    // the same `useWriteAction` lifecycle.
    status: AttendanceStatus | null,
    exReason: ExReason | null,
    // `undefined` means "leave the note as it is" (a status/reason change);
    // an explicit null clears it. The popover only passes this when the note
    // field itself was edited.
    exNote?: string | null
  ) {
    void sectionId; // reserved: future bulk endpoint may use it
    const k = keyFor(enrolmentId, date);
    const prev = cells.get(k) ?? {
      status: null,
      exReason: null,
      exNote: null,
    };

    // A note only belongs to an EX mark, so moving away from EX drops it —
    // and a clear is the furthest away from EX there is.
    const nextNote =
      status !== 'EX' ? null : exNote === undefined ? prev.exNote : exNote;

    // ⚠ A CLEARED CELL CARRIES NOTHING WITH IT. The database says the same
    // thing outright (`attendance_daily_cleared_has_no_reason_chk`): a row
    // with no status may hold neither a reason nor a note, or the day reads
    // as unmarked while still carrying "medical certificate submitted"
    // underneath. Normalised here rather than trusted from the caller, so a
    // future caller that forgets cannot turn it into a 500 in the grid.
    const nextReason = status === null ? null : exReason;

    // KD #94 — soft warning when a vacation-leave entry would push the
    // student over their per-term quota (HFSE policy: 1 per term). The
    // write proceeds either way — registrar can grant an exception, this
    // is just a heads-up. Count cells in the current grid (all in this
    // term) excluding the cell we're about to flip.
    //
    // ⚠ A CLEAR NEVER REACHES THIS BLOCK, and must not: it GIVES an allowance
    // back rather than spending one, so a quota warning on the way out would
    // be both wrong and alarming.
    if (status === 'EX' && exReason === 'vacation') {
      const wasAlreadyVacation =
        prev.status === 'EX' && prev.exReason === 'vacation';
      if (!wasAlreadyVacation) {
        const enr = enrolments.find((e) => e.enrolmentId === enrolmentId);
        if (enr) {
          // ⚠ TRIPS, NOT DAYS. This counted one per marked cell, so the
          // second day of a single holiday fired "over quota" — the warning
          // cried wolf on exactly the normal case. Vacation leave is one trip
          // however long (Mr Ace, 2026-08-27), and marking the day BESIDE an
          // existing vacation day extends that trip rather than starting one.
          //
          // Uses the same `countVacationTrips` the server does, so the toast
          // and the quota card can never disagree.
          const vacationDates = new Set<string>();
          for (const [key, c] of cells.entries()) {
            if (!key.startsWith(`${enrolmentId}|`)) continue;
            if (c.status === 'EX' && c.exReason === 'vacation') {
              vacationDates.add(key.slice(enrolmentId.length + 1));
            }
          }
          const schoolDays = columns
            .filter((c) => c.encodable)
            .map((c) => c.iso);
          const before = countVacationTrips(schoolDays, vacationDates, false);
          const after = countVacationTrips(
            schoolDays,
            new Set([...vacationDates, date]),
            false
          );
          // Only speak up when this click actually SPENDS an allowance and
          // takes them past it. Extending a trip changes nothing.
          if (after > before && after > enr.vlAllowance) {
            toast.warning(
              `${enr.studentName} has used ${before} of ${enr.vlAllowance} vacation leaves this term. Saving anyway — check with the registrar if this needs an exception.`
            );
          }
        }
      }
    }

    updateCell(k, { status, exReason: nextReason, exNote: nextNote });
    setIsSaving(true);
    const saved = await run(
      () =>
        saveCellMutation.mutateAsync({
          sectionStudentId: enrolmentId,
          termId,
          date,
          status,
          exReason: nextReason,
          exNote: nextNote,
        }),
      {
        pending: 'Saving…',
        // A clear says what it did. "Saved." over a cell that just went blank
        // reads as though something was written into it.
        success: status === null ? 'Mark cleared.' : 'Saved.',
        // Same wording the inline handler used. `run` hands over the thrown
        // error rather than a string so the server's own message survives.
        error: (e) =>
          `${status === null ? 'Could not clear the mark' : 'Could not save'}: ${
            e instanceof Error ? e.message : 'error'
          }`,
      }
    );
    setIsSaving(false);

    // `run` NEVER REJECTS — `undefined` is how it reports a failed write, so
    // that, not a catch, is what the optimistic revert hangs off.
    if (saved === undefined) {
      updateCell(k, {
        status: prev.status,
        exReason: prev.exReason,
        exNote: prev.exNote,
      });
    }
  }

  // Today's column — ref + ISO captured once at mount so the auto-scroll
  // effect fires exactly once. On a date change (registrar leaves the tab
  // open past midnight) the ref still points at yesterday's column; not
  // worth complicating for that edge case.
  const todayIso = useMemo(() => todayLocalIso(), []);
  const todayHeaderRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    todayHeaderRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  // Calendar columns in order; each flagged with day_type + event labels.
  // `drawMonthBoundary` is true for month-starts EXCEPT the first column —
  // the first column already has the roster pane's right border as its
  // visual boundary.
  const columns = useMemo(() => {
    const evBy = (iso: string) =>
      events.filter((e) => iso >= e.startDate && iso <= e.endDate);
    let prevMonth = '';
    return calendar.map((c, idx) => {
      const monthKey = c.date.slice(0, 7);
      const isMonthStart = monthKey !== prevMonth;
      prevMonth = monthKey;
      // Weekday label ("Mon"/"Tue"/…) — computed once per column here rather
      // than in the header's render body, since the header re-renders on
      // every cell mark (the whole grid re-renders on `cells` state changes)
      // while `calendar`/`events` only change on a server refetch.
      const weekday = new Date(
        Number(c.date.slice(0, 4)),
        Number(c.date.slice(5, 7)) - 1,
        Number(c.date.slice(8, 10))
      ).toLocaleDateString('en-SG', { weekday: 'short' });
      return {
        iso: c.date,
        dayType: c.dayType,
        encodable: isEncodableDayType(c.dayType),
        label: c.label,
        events: evBy(c.date),
        drawMonthBoundary: isMonthStart && idx > 0,
        tag: resolveColumnTag({ dayType: c.dayType, events: evBy(c.date) }),
        weekday,
      };
    });
  }, [calendar, events]);

  // Group by month for banner rows.
  const monthGroups = useMemo(() => {
    const groups: Array<{
      month: string;
      label: string;
      dates: typeof columns;
    }> = [];
    for (const col of columns) {
      const key = col.iso.slice(0, 7);
      let g = groups[groups.length - 1];
      if (!g || g.month !== key) {
        const [y, m] = key.split('-');
        const d = new Date(Number(y), Number(m) - 1, 1);
        g = {
          month: key,
          label: d.toLocaleDateString('en-SG', {
            month: 'short',
            year: 'numeric',
          }),
          dates: [],
        };
        groups.push(g);
      }
      g.dates.push(col);
    }
    return groups;
  }, [columns]);

  if (columns.length === 0) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" aria-hidden />
          </div>
          <CardTitle className="font-serif">No calendar configured</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Attendance can&apos;t be recorded until your school admin configures
            the school calendar for this term. Seed the weekdays to start
            encoding.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/sis/calendar">Open School Calendar</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Row heights locked so the roster pane and calendar pane stay aligned
  // vertically. Both panes use identical <tr style={{height}}> values — but
  // that alone only sets a MINIMUM: a <tr>'s height is the max of its
  // specified height and its tallest cell's natural content height. Since
  // the two panes are separate <table> elements, any cell whose content
  // outgrows the intended height (e.g. a date header carrying a
  // ChartLegendChip tag under the day-number + weekday lines, or a roster
  // row with several badges) silently stretches ONLY that table's row,
  // permanently offsetting every row below it from its counterpart in the
  // other pane. Every header/body cell below therefore ALSO gets this same
  // height applied inline (not just `h-auto`) plus `overflow-hidden`, so a
  // too-tall cell clips instead of growing — the ceiling matches the floor.
  const ROW_HEIGHT = { monthBanner: 28, dateRow: 56, body: 44 };
  const cellHeight = (px: number): CSSProperties => ({
    height: px,
    overflow: 'hidden',
  });

  // Resolve the active cell → its student + current mark, for the shared popover.
  const activeEnrolment = activeCell
    ? (enrolments.find((e) => e.enrolmentId === activeCell.enrolmentId) ?? null)
    : null;
  const activeCellState = activeCell
    ? (cells.get(keyFor(activeCell.enrolmentId, activeCell.iso)) ?? null)
    : null;

  // Resolve the active metadata-editor row, same defensive-lookup pattern as
  // activeEnrolment above (never a non-null assertion on a derived find()).
  const activeMetaEnrolment = activeMetaEnrolmentId
    ? (enrolments.find((e) => e.enrolmentId === activeMetaEnrolmentId) ?? null)
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={showDetails ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </Button>
      </div>
      {/* While a mark is being written the whole register goes dim, soft
            and non-interactive: one edit at a time, and the teacher can see
            that the sheet is busy rather than discovering it when a second
            click does nothing. `aria-busy` says the same thing to a screen
            reader, which the blur alone cannot. */}
      <Card
        aria-busy={isSaving}
        className={
          'p-0 overflow-hidden transition duration-200 ' +
          (isSaving
            ? 'pointer-events-none select-none blur-[1px] opacity-60'
            : '')
        }
      >
        {enrolments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-5" aria-hidden />
            </div>
            <p className="text-sm text-muted-foreground">
              No students enrolled in this section yet.
            </p>
          </div>
        ) : (
          // ONE real table — the roster columns (#, Student, and the
          // optional Details columns) are `position: sticky` cells pinned
          // to the left inside the SAME <tr> as that student's attendance
          // marks, so a name and its marks are structurally one row:
          // shared hover highlight, shared zebra striping, no possibility
          // of drifting out of sync (the previous two-independent-tables
          // design could only ever *approximate* alignment via matched
          // <tr> heights). `border-separate` (never `border-collapse`) is
          // what makes `position: sticky` cells safe in a table — the
          // same convention already proven by the single sticky column in
          // components/attendance/term-sheet-summary-table.tsx. A much
          // older attempt at this used `border-collapse` and hit the
          // known browser bug where scrolling content paints over sticky
          // cells (see git history) — avoided here by construction.
          <div className="overflow-x-auto">
            <Table
              noWrapper
              className="border-separate border-spacing-0 table-fixed text-[11px]"
            >
              <colgroup>
                {stickyCols.map((c) => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
                {columns.map((c) => (
                  <col key={c.iso} style={{ width: 36 }} />
                ))}
                <col style={{ width: 40 }} />
              </colgroup>
              <TableHeader>
                <TableRow
                  style={{ height: ROW_HEIGHT.monthBanner }}
                  className="hover:bg-transparent"
                >
                  <TableHead
                    colSpan={stickyCols.length}
                    style={{ ...cellHeight(ROW_HEIGHT.monthBanner), left: 0 }}
                    className="sticky z-20 overflow-hidden border-b border-border bg-muted/60 px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Roster
                  </TableHead>
                  {monthGroups.map((g) => (
                    <TableHead
                      key={g.month}
                      colSpan={g.dates.length}
                      style={cellHeight(ROW_HEIGHT.monthBanner)}
                      className="overflow-hidden border-b border-r border-border bg-muted/60 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {g.label}
                    </TableHead>
                  ))}
                  <TableHead
                    style={cellHeight(ROW_HEIGHT.monthBanner)}
                    className="overflow-hidden border-b border-border bg-muted/60 p-0"
                  />
                </TableRow>
                <TableRow
                  style={{ height: ROW_HEIGHT.dateRow }}
                  className="hover:bg-transparent"
                >
                  <TableHead
                    style={{
                      ...cellHeight(ROW_HEIGHT.dateRow),
                      left: stickyOf('index').left,
                    }}
                    className={
                      'sticky z-20 overflow-hidden border-b border-r border-border bg-muted/60 px-1 py-1 text-right font-mono text-[10px] font-semibold text-muted-foreground' +
                      (isLastSticky('index')
                        ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                        : '')
                    }
                  >
                    #
                  </TableHead>
                  <TableHead
                    style={{
                      ...cellHeight(ROW_HEIGHT.dateRow),
                      left: stickyOf('student').left,
                    }}
                    className={
                      'sticky z-20 overflow-hidden border-b border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground' +
                      (isLastSticky('student')
                        ? ' border-r-2 border-border shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                        : '')
                    }
                  >
                    Student
                  </TableHead>
                  {showDetails && (
                    <TableHead
                      style={{
                        ...cellHeight(ROW_HEIGHT.dateRow),
                        left: stickyOf('busCare').left,
                      }}
                      className={
                        'sticky z-20 overflow-hidden border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground' +
                        (isLastSticky('busCare')
                          ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                          : '')
                      }
                    >
                      Bus / Student Care
                    </TableHead>
                  )}
                  {showDetails && canEditAcademics && (
                    <TableHead
                      style={{
                        ...cellHeight(ROW_HEIGHT.dateRow),
                        left: stickyOf('academics').left,
                      }}
                      className={
                        'sticky z-20 overflow-hidden border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground' +
                        (isLastSticky('academics')
                          ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                          : '')
                      }
                    >
                      Academics
                    </TableHead>
                  )}
                  {showDetails && canEditAdmin && (
                    <TableHead
                      style={{
                        ...cellHeight(ROW_HEIGHT.dateRow),
                        left: stickyOf('admin').left,
                      }}
                      className={
                        'sticky z-20 overflow-hidden border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground' +
                        (isLastSticky('admin')
                          ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                          : '')
                      }
                    >
                      Admin
                    </TableHead>
                  )}
                  {columns.map((c) => {
                    const eventLabel = c.events.map((e) => e.label).join(' · ');
                    const dayTypeTitle = `${DAY_TYPE_LABELS[c.dayType]}${
                      c.label ? ` · ${c.label}` : ''
                    }${eventLabel ? ` · ${eventLabel}` : ''}`;
                    const isToday = c.iso === todayIso;
                    return (
                      <TableHead
                        key={c.iso}
                        ref={isToday ? todayHeaderRef : undefined}
                        title={
                          isToday ? `Today · ${dayTypeTitle}` : dayTypeTitle
                        }
                        style={cellHeight(ROW_HEIGHT.dateRow)}
                        className={
                          'overflow-hidden border-b border-border bg-muted/40 px-1 py-1 text-center font-mono text-[10px] font-semibold text-foreground ' +
                          (c.drawMonthBoundary
                            ? ' border-l-2 border-l-border'
                            : '') +
                          (isToday
                            ? ' relative ring-2 ring-inset ring-brand-indigo'
                            : '')
                        }
                      >
                        <div className="leading-tight">{c.iso.slice(-2)}</div>
                        <div className="text-[9px] font-normal opacity-70">
                          {c.weekday.slice(0, 3)}
                        </div>
                        {/* Column tag — resolveColumnTag picks the single
                            most-informative tag: PH/SH/NC from day_type,
                            EX for exam events, SE for other events, HBL
                            for HBL days; plain school days are untagged.
                            Same ChartLegendChip rendered in the register
                            card's legend above so the column header and legend
                            chip read as the same affordance per §10. */}
                        {c.tag && (
                          <div className="mt-0.5 flex justify-center">
                            <ChartLegendChip
                              color={COLUMN_TAG_COLOR[c.tag]}
                              label={c.tag}
                              className="px-1 py-px text-[9px] tracking-[0.1em]"
                            />
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
                  <TableHead
                    style={cellHeight(ROW_HEIGHT.dateRow)}
                    className="overflow-hidden border-b border-border bg-muted/60 p-0"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrolments.map((e) => {
                  // Explicit (not inherited), fully OPAQUE background on
                  // every sticky cell — a sticky cell paints in its own
                  // layer, so any transparency lets the date columns
                  // scrolling underneath show through (this previously
                  // used bg-muted/10 and bg-muted/[0.04], which are both
                  // ~90%+ transparent — nowhere near opaque enough, and
                  // the actual cause of the roster column visually
                  // "mixing" with the marks while scrolling). Matches the
                  // proven sticky-cell convention in
                  // term-sheet-summary-table.tsx: a flat bg-card, no
                  // per-row alpha variation. Zebra striping / withdrawn
                  // dimming stay on the non-sticky mark cells via the
                  // <TableRow>'s own `odd:`/conditional classes below —
                  // those aren't `position: sticky` so they don't have
                  // this problem. Withdrawn signaling inside the sticky
                  // cell itself is carried by the italic/dimmed text +
                  // "Withdrawn" badge already rendered below, not by the
                  // background.
                  const rowStickyBg = 'bg-card';
                  return (
                    <TableRow
                      key={e.enrolmentId}
                      style={{ height: ROW_HEIGHT.body }}
                      className={
                        e.withdrawn
                          ? 'bg-muted/10 text-muted-foreground hover:bg-muted/10'
                          : 'odd:bg-muted/[0.04] hover:bg-muted/20'
                      }
                    >
                      <TableCell
                        style={{
                          ...cellHeight(ROW_HEIGHT.body),
                          left: stickyOf('index').left,
                        }}
                        className={
                          'sticky z-10 overflow-hidden border-r border-border px-1 py-1 text-right font-mono tabular-nums text-muted-foreground ' +
                          rowStickyBg +
                          (isLastSticky('index')
                            ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                            : '')
                        }
                      >
                        {e.indexNumber}
                      </TableCell>
                      <TableCell
                        style={{
                          ...cellHeight(ROW_HEIGHT.body),
                          left: stickyOf('student').left,
                        }}
                        className={
                          'sticky z-10 overflow-hidden px-2 py-1 ' +
                          rowStickyBg +
                          (isLastSticky('student')
                            ? ' border-r-2 border-border shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                            : '')
                        }
                      >
                        <div
                          className={
                            'truncate text-[12px] font-medium text-foreground ' +
                            (e.withdrawn ? 'opacity-60 italic' : '')
                          }
                          title={e.studentName}
                        >
                          {e.studentName}
                        </div>
                        <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                          {e.withdrawn && (
                            <Badge
                              variant="secondary"
                              className="border-0 px-1.5 py-0 font-mono text-[10px] font-normal shadow-none"
                            >
                              Withdrawn
                            </Badge>
                          )}
                          {e.busNo && (
                            <Badge
                              variant="secondary"
                              className="gap-0.5 border-0 px-1.5 py-0 text-[10px] font-normal shadow-none"
                              title="Bus number"
                            >
                              <Bus aria-hidden /> {e.busNo}
                            </Badge>
                          )}
                          {e.classroomOfficerRole && (
                            <Badge
                              variant="secondary"
                              className="gap-0.5 border-0 px-1.5 py-0 text-[10px] font-normal shadow-none"
                              title="Classroom officer"
                            >
                              <Star aria-hidden /> {e.classroomOfficerRole}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {showDetails && (
                        <TableCell
                          style={{
                            ...cellHeight(ROW_HEIGHT.body),
                            left: stickyOf('busCare').left,
                          }}
                          className={
                            'sticky z-10 overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground ' +
                            rowStickyBg +
                            (isLastSticky('busCare')
                              ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                              : '')
                          }
                        >
                          {canEditBusCare ? (
                            <button
                              type="button"
                              className="w-full truncate text-left hover:underline"
                              onClick={() =>
                                setActiveMetaEnrolmentId(e.enrolmentId)
                              }
                            >
                              {busCareLabel(e)}
                            </button>
                          ) : (
                            busCareLabel(e)
                          )}
                        </TableCell>
                      )}
                      {showDetails && canEditAcademics && (
                        <TableCell
                          style={{
                            ...cellHeight(ROW_HEIGHT.body),
                            left: stickyOf('academics').left,
                          }}
                          className={
                            'sticky z-10 overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground ' +
                            rowStickyBg +
                            (isLastSticky('academics')
                              ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                              : '')
                          }
                        >
                          <button
                            type="button"
                            className="w-full truncate text-left hover:underline"
                            onClick={() =>
                              setActiveMetaEnrolmentId(e.enrolmentId)
                            }
                          >
                            {e.academicsNotes ?? '—'}
                          </button>
                        </TableCell>
                      )}
                      {showDetails && canEditAdmin && (
                        <TableCell
                          style={{
                            ...cellHeight(ROW_HEIGHT.body),
                            left: stickyOf('admin').left,
                          }}
                          className={
                            'sticky z-10 overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground ' +
                            rowStickyBg +
                            (isLastSticky('admin')
                              ? ' border-r-2 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]'
                              : '')
                          }
                        >
                          <button
                            type="button"
                            className="w-full truncate text-left hover:underline"
                            onClick={() =>
                              setActiveMetaEnrolmentId(e.enrolmentId)
                            }
                          >
                            {e.adminNotes ?? '—'}
                          </button>
                        </TableCell>
                      )}
                      {columns.map((c) => {
                        const cell = cells.get(keyFor(e.enrolmentId, c.iso));
                        const status = cell?.status ?? null;
                        const exReason = cell?.exReason ?? null;
                        const exNote = cell?.exNote ?? null;
                        // Pre-enrollment: date is before the student's enrollment
                        // date — cell should be dimmed and non-interactive. If
                        // there is already a recorded entry, we still show it
                        // dimmed rather than silently discarding it.
                        const beforeEnrolment =
                          !!e.enrollmentDate && c.iso < e.enrollmentDate;

                        return (
                          <TableCell
                            key={c.iso}
                            title={
                              beforeEnrolment
                                ? 'Before enrolment date'
                                : undefined
                            }
                            style={cellHeight(ROW_HEIGHT.body)}
                            className={
                              'overflow-hidden p-0 text-center align-middle ' +
                              (beforeEnrolment
                                ? 'bg-muted/40 '
                                : DAY_TYPE_CELL_BG[c.dayType]) +
                              (c.drawMonthBoundary
                                ? ' border-l-2 border-l-border'
                                : '')
                            }
                          >
                            {beforeEnrolment ? (
                              // Dim cell for pre-enrollment dates. If data was
                              // already recorded (edge-case: back-dated entry),
                              // show the value dimmed but do not allow edits.
                              <span
                                className={
                                  'block px-1 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] opacity-40 ' +
                                  (status
                                    ? statusCellWash(status)
                                    : 'text-muted-foreground')
                                }
                                title={
                                  status
                                    ? `Before enrolment date · ${ATTENDANCE_STATUS_LABELS[status]}${status === 'EX' && exReason ? ` · ${EX_REASON_LABELS[exReason]}` : ''}`
                                    : 'Before enrolment date'
                                }
                              >
                                {status ?? '—'}
                              </span>
                            ) : !c.encodable ? (
                              <span
                                className="block px-1 py-1 text-[10px] text-muted-foreground"
                                title={`${DAY_TYPE_LABELS[c.dayType]}${c.label ? ` · ${c.label}` : ''}`}
                              >
                                —
                              </span>
                            ) : (
                              <CellButton
                                enrolmentId={e.enrolmentId}
                                iso={c.iso}
                                active={
                                  activeCell?.enrolmentId === e.enrolmentId &&
                                  activeCell?.iso === c.iso
                                }
                                withdrawn={e.withdrawn}
                                status={status}
                                exReason={exReason}
                                exNote={exNote}
                                onOpen={openCell}
                              />
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell
                        style={cellHeight(ROW_HEIGHT.body)}
                        className="overflow-hidden bg-background p-0"
                      />
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* One shared cell-mark dialog for the whole register (single portal;
          the per-cell control is a plain button). It is rendered only while a
          cell is active so its internal draft state — the note being typed,
          and whether the excused reasons have been opened without a reason
          chosen yet — cannot survive into the next cell. The key does the same
          job for a move from one open cell straight to another. */}
      {activeEnrolment && activeCell && (
        <CellMarkDialog
          key={`${activeCell.enrolmentId}|${activeCell.iso}`}
          open
          onOpenChange={(o) => {
            if (!o) setActiveCell(null);
          }}
          studentName={activeEnrolment.studentName}
          indexNumber={activeEnrolment.indexNumber}
          dateLabel={cellDateLabel(activeCell.iso)}
          status={activeCellState?.status ?? null}
          exReason={activeCellState?.exReason ?? null}
          exNote={activeCellState?.exNote ?? null}
          filing={
            filingsByCell?.[`${activeCell.enrolmentId}|${activeCell.iso}`] ??
            null
          }
          vlUsed={activeEnrolment.vlUsedThisTerm}
          vlAllowance={activeEnrolment.vlAllowance}
          compassionateUsed={activeEnrolment.compassionateUsed}
          compassionateAllowance={activeEnrolment.compassionateAllowance}
          onPick={(status, exReason, exNote) => {
            void writeCell(
              activeCell.enrolmentId,
              activeCell.iso,
              status,
              exReason,
              exNote
            );
            // Present, Absent, Late and a clear are each one decision, so the
            // dialog closes and the teacher moves on — that is the fast
            // bulk-encoding path and it must stay one click. (A clear arrives
            // as `null`, which is not 'EX', so it closes with the rest — and
            // it should: the dialog's whole lower half is about a mark that no
            // longer exists.)
            //
            // Excused is not one decision: it is a mark, then a reason, then
            // possibly a note. Closing after the first of those threw the
            // teacher out of the cell and made them re-open it twice to
            // finish. So EX keeps the dialog open, and they leave it the way
            // they leave any dialog — Esc, the close button, or clicking
            // outside it.
            if (status !== 'EX') setActiveCell(null);
          }}
        />
      )}

      {/* One shared roster-metadata editor sheet — anchored to whichever
          row's Bus/Academics/Admin cell was clicked (single portal; mirrors
          the shared cell-mark popover above). */}
      <Sheet
        open={activeMetaEnrolmentId != null}
        onOpenChange={(o) => {
          if (!o) setActiveMetaEnrolmentId(null);
        }}
      >
        {activeMetaEnrolment && activeMetaEnrolmentId && (
          <EnrolmentMetaEditor
            enrolment={activeMetaEnrolment}
            canEditBusCare={canEditBusCare}
            canEditAcademics={canEditAcademics}
            canEditAdmin={canEditAdmin}
            saving={metaSaving}
            onSave={(patch) =>
              void saveMeta({
                enrolmentId: activeMetaEnrolmentId,
                patch,
              })
            }
          />
        )}
      </Sheet>
    </div>
  );
}

// The per-cell control: a plain button showing the canonical letter on its
// paper-palette wash. Clicking opens the one shared marking dialog; when this
// cell is the active one it carries the ring that says so. Withdrawn cells
// render a non-interactive letter (no marking). Replaces the old native
// <select>.
//
// ⚠ THE RING IS THE FEATURE, not decoration (2026-08-31). The editor used to
// be a popover floating beside its cell, and Mr Ace's first complaint about it
// was that "there is no indicator which cell is open" — true, and at ~1,410
// cells there is no recovering that from proximity. A dialog sits in the
// middle of the screen, so this ring is now the ONLY thing on screen naming
// the day being edited. `ring-inset` (not an offset ring) because the cell has
// `overflow: hidden` and a ring drawn outside the box would be clipped away;
// indigo on an inset ring stays legible over all four paper washes AND over an
// empty white cell, which a wash-tinted highlight would not.
//
// Memoized: at HFSE scale (~1,410 cells) an unmemoized CellButton re-renders
// every cell on every grid re-render (e.g. a single `writeCell` optimistic
// update touching one cell's entry in the `cells` Map). `onOpen` is the
// parent's stable `openCell` callback (identity never changes) and
// `enrolmentId`/`iso` are passed as primitive props instead of baked into a
// fresh per-cell closure, so React.memo's default shallow-prop comparison
// correctly skips re-rendering every cell whose props (status/exReason/
// exNote/active) are unchanged.
const CellButton = memo(function CellButton({
  enrolmentId,
  iso,
  active,
  withdrawn,
  status,
  exReason,
  exNote,
  onOpen,
}: {
  enrolmentId: string;
  iso: string;
  active: boolean;
  withdrawn: boolean;
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  exNote: string | null;
  onOpen: (enrolmentId: string, iso: string) => void;
}) {
  const label = status ?? '—';
  const hasNote = status === 'EX' && exNote != null && exNote !== '';
  const tip = status
    ? `${ATTENDANCE_STATUS_LABELS[status]}${status === 'EX' && exReason ? ` · ${EX_REASON_LABELS[exReason]}` : ''}${hasNote ? ` — ${exNote}` : ''}`
    : 'Mark attendance';

  return (
    <div
      // `active` is a primitive prop, so the memo above still short-circuits
      // every cell that is not the open one — only two cells re-render when
      // the teacher moves from one day to the next.
      data-active={active || undefined}
      className={
        'relative ' +
        statusCellWash(status) +
        (active ? ' z-10 ring-2 ring-primary ring-inset' : '')
      }
    >
      {withdrawn ? (
        <span className="block px-1 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] opacity-60">
          {label}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(enrolmentId, iso)}
          aria-haspopup="dialog"
          aria-expanded={active}
          title={tip}
          className={
            'block w-full px-1 py-1 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ' +
            (status
              ? 'hover:brightness-105'
              : 'text-foreground hover:bg-muted/50')
          }
        >
          {label}
        </button>
      )}
      {/* A note lives in the tooltip, which nobody discovers by accident.
          This dot is the only thing that says "there is a reason recorded
          here" while scanning the sheet. */}
      {hasNote && (
        <span
          className="pointer-events-none absolute bottom-0.5 left-0.5 size-1 rounded-full bg-foreground/50"
          aria-hidden
        />
      )}
    </div>
  );
});
