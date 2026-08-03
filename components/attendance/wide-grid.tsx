'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Attendance wide grid. Rows = students (~30), columns = term school-days
// (~47). Cell count at HFSE scale: ~1,410 per render.
//
// Render-perf invariants — do not regress:
//   1. Each cell is a plain <button> (CellButton), NOT a per-cell Radix
//      Select/Popover. There is exactly ONE shared marking popover for the
//      whole grid, anchored to the active cell (state: `activeCell`). 1,410
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

import {
  Bus,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Star,
  Users,
} from 'lucide-react';
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
import { CellMarkPalette } from '@/components/attendance/cell-mark-popover';
import { EnrolmentMetaEditor } from '@/components/attendance/enrolment-meta-editor';
import { useDebouncedRefresh } from '@/lib/hooks/use-debounced-refresh';
import { statusCellWash } from '@/components/attendance/status-wash';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
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
// grid cells, the legend, AND the cell-mark popover chips.

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
// "marking palette" popover (components/attendance/cell-mark-popover.tsx)
// anchored to the active cell — see the cell render + <Popover> below.

type CellState = {
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  /** Free-text "why" on an EX mark. Shown in the tooltip + a corner dot. */
  exNote: string | null;
  saving: boolean;
  savedAt: number | null;
};

type GridKey = string; // `${enrolmentId}|${date}`

function keyFor(enrolmentId: string, date: string): GridKey {
  return `${enrolmentId}|${date}`;
}

// "14 Jul" label for the popover header (on-screen only — browser ICU).
function cellDateLabel(iso: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  ).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
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
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  canWriteNc: boolean;
  canEditBusCare: boolean;
  canEditAcademics: boolean;
  canEditAdmin: boolean;
}) {
  const router = useRouter();
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
        saving: false,
        savedAt: null,
      });
    }
    return m;
  }, [initialDaily]);

  const [cells, setCells] = useState<Map<GridKey, CellState>>(
    () => new Map(seed)
  );

  const [showDetails, setShowDetails] = useState(false);
  // The one open cell-mark popover (single portal — see the marking-palette note
  // above and the perf invariants in the file header). null = closed.
  const [activeCell, setActiveCell] = useState<{
    enrolmentId: string;
    iso: string;
  } | null>(null);

  // The one open roster-metadata editor sheet (single portal, mirrors the
  // cell-mark popover's perf invariant above). null = closed.
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
        saving: false,
        savedAt: null,
      };
      next.set(k, { ...prev, ...patch });
      return next;
    });
  }

  // Tier-3 autosave grid: the cell state stays in the local `cells` Map with
  // its own optimistic write + revert-on-failure (unchanged). The ONLY change
  // is that the per-cell PATCH now goes through useMutation so it gets the
  // shared retry: 0 + apiFetch error handling. `mutate` is called per cell —
  // each call is independent. The optimistic write, the saved-tick timeout, and
  // the revert all stay inside writeCell exactly as before.
  const saveCellMutation = useMutation({
    mutationFn: (payload: {
      sectionStudentId: string;
      termId: string;
      date: string;
      status: AttendanceStatus;
      exReason: ExReason | null;
      exNote?: string | null;
    }) => apiFetch('/api/attendance/daily', jsonInit('PATCH', payload)),
  });

  // The stat cards above this grid (average attendance, perfect attendance)
  // are rendered by the page's server component from the rollup that each
  // write recomputes. Marking is bursty, so we ask for a fresh render once
  // marking goes quiet rather than once per cell — see the hook's own note.
  const refreshStats = useDebouncedRefresh(() => router.refresh());

  // Low-frequency roster-metadata edit (Bus/Care, Academics, Admin notes) —
  // unlike the high-frequency cell-mark mutation above, this one calls
  // router.refresh() on success so the roster pane reflects the saved value.
  const metaMutation = useMutation({
    mutationFn: (vars: {
      enrolmentId: string;
      patch: Record<string, string | null>;
    }) =>
      apiFetch(
        `/api/sections/${sectionId}/students/${vars.enrolmentId}`,
        jsonInit('PATCH', vars.patch)
      ),
    onSuccess: () => {
      toast.success('Saved.');
      router.refresh();
      setActiveMetaEnrolmentId(null);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not save.');
    },
  });

  async function writeCell(
    enrolmentId: string,
    date: string,
    status: AttendanceStatus,
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
      saving: false,
      savedAt: null,
    };

    // A note only belongs to an EX mark, so moving away from EX drops it.
    const nextNote =
      status !== 'EX' ? null : exNote === undefined ? prev.exNote : exNote;

    // KD #94 — soft warning when a vacation-leave entry would push the
    // student over their per-term quota (HFSE policy: 1 per term). The
    // write proceeds either way — registrar can grant an exception, this
    // is just a heads-up. Count cells in the current grid (all in this
    // term) excluding the cell we're about to flip.
    if (status === 'EX' && exReason === 'vacation') {
      const wasAlreadyVacation =
        prev.status === 'EX' && prev.exReason === 'vacation';
      if (!wasAlreadyVacation) {
        const enr = enrolments.find((e) => e.enrolmentId === enrolmentId);
        if (enr) {
          let vlInTerm = 0;
          for (const [key, c] of cells.entries()) {
            if (!key.startsWith(`${enrolmentId}|`)) continue;
            if (c.status === 'EX' && c.exReason === 'vacation') vlInTerm += 1;
          }
          const nextCount = vlInTerm + 1;
          if (nextCount > enr.vlAllowance) {
            toast.warning(
              `${enr.studentName} has used ${vlInTerm} of ${enr.vlAllowance} vacation leaves this term. Saving anyway — check with the registrar if this needs an exception.`
            );
          }
        }
      }
    }

    updateCell(k, { status, exReason, exNote: nextNote, saving: true });
    try {
      await saveCellMutation.mutateAsync({
        sectionStudentId: enrolmentId,
        termId,
        date,
        status,
        exReason,
        exNote: nextNote,
      });
      updateCell(k, { saving: false, savedAt: Date.now() });
      // Saved — the server's rollup has moved, so the stat cards are now
      // stale. Only on success: a failed write reverts and changes nothing.
      refreshStats();
      setTimeout(() => {
        setCells((current) => {
          const c = current.get(k);
          if (!c || !c.savedAt || Date.now() - c.savedAt < 1400) return current;
          const next = new Map(current);
          next.set(k, { ...c, savedAt: null });
          return next;
        });
      }, 1500);
    } catch (e) {
      updateCell(k, {
        status: prev.status,
        exReason: prev.exReason,
        exNote: prev.exNote,
        saving: false,
      });
      toast.error(
        `Could not save: ${e instanceof Error ? e.message : 'error'}`
      );
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
      {/* One shared cell-mark popover — anchored to the active cell (single
          portal; the per-cell control is a plain button). */}
      <Popover
        open={activeCell != null}
        onOpenChange={(o) => {
          if (!o) setActiveCell(null);
        }}
      >
        <Card className="p-0 overflow-hidden">
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
                      const eventLabel = c.events
                        .map((e) => e.label)
                        .join(' · ');
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
                                  saving={!!cell?.saving}
                                  saved={!!cell?.savedAt}
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
        <PopoverContent align="center" sideOffset={6} className="w-72">
          {activeEnrolment && activeCell && (
            <CellMarkPalette
              // Keyed on the cell so moving to another one remounts the
              // palette. Its draft state — the note being typed, and whether
              // the excused reasons have been opened without a reason chosen
              // yet — belongs to ONE cell, and React would otherwise reuse the
              // instance and carry it across.
              key={`${activeCell.enrolmentId}|${activeCell.iso}`}
              studentName={activeEnrolment.studentName}
              dateLabel={cellDateLabel(activeCell.iso)}
              status={activeCellState?.status ?? null}
              exReason={activeCellState?.exReason ?? null}
              exNote={activeCellState?.exNote ?? null}
              canWriteNc={canWriteNc}
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
                // Present, Absent, Late and No class are one decision, so the
                // popover closes and the teacher moves on — that is the fast
                // bulk-encoding path and it must stay one click.
                //
                // Excused is not one decision: it is a mark, then a reason,
                // then possibly a note. Closing after the first of those threw
                // the teacher out of the cell and made them re-open it twice
                // to finish. So EX keeps the popover open, and they leave it
                // the way they leave any popover — Esc, or clicking the next
                // cell, which opens that one in the same motion.
                if (status !== 'EX') setActiveCell(null);
              }}
            />
          )}
        </PopoverContent>
      </Popover>

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
            saving={metaMutation.isPending}
            onSave={(patch) =>
              metaMutation.mutate({
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
// paper-palette wash. Clicking opens the one shared marking popover; when this
// cell is the active one it becomes the popover's anchor. Withdrawn cells render
// a non-interactive letter (no marking). Replaces the old native <select>.
//
// Memoized: at HFSE scale (~1,410 cells) an unmemoized CellButton re-renders
// every cell on every grid re-render (e.g. a single `writeCell` optimistic
// update touching one cell's entry in the `cells` Map). `onOpen` is the
// parent's stable `openCell` callback (identity never changes) and
// `enrolmentId`/`iso` are passed as primitive props instead of baked into a
// fresh per-cell closure, so React.memo's default shallow-prop comparison
// correctly skips re-rendering every cell whose props (status/saving/
// saved/active) are unchanged.
const CellButton = memo(function CellButton({
  enrolmentId,
  iso,
  active,
  withdrawn,
  status,
  exReason,
  exNote,
  saving,
  saved,
  onOpen,
}: {
  enrolmentId: string;
  iso: string;
  active: boolean;
  withdrawn: boolean;
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  exNote: string | null;
  saving: boolean;
  saved: boolean;
  onOpen: (enrolmentId: string, iso: string) => void;
}) {
  const label = status ?? '—';
  const hasNote = status === 'EX' && exNote != null && exNote !== '';
  const tip = status
    ? `${ATTENDANCE_STATUS_LABELS[status]}${status === 'EX' && exReason ? ` · ${EX_REASON_LABELS[exReason]}` : ''}${hasNote ? ` — ${exNote}` : ''}`
    : 'Mark attendance';

  const inner = (
    <div className={'relative ' + statusCellWash(status)}>
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
      {saving && (
        <Loader2 className="pointer-events-none absolute right-0 top-0 size-2.5 animate-spin text-muted-foreground" />
      )}
      {saved && (
        <CheckCircle2 className="pointer-events-none absolute right-0 top-0 size-2.5 text-primary" />
      )}
      {/* A note lives in the tooltip, which nobody discovers by accident.
          This dot is the only thing that says "there is a reason recorded
          here" while scanning the sheet. Bottom-left keeps it clear of the
          saving/saved indicators. */}
      {hasNote && !saving && !saved && (
        <span
          className="pointer-events-none absolute bottom-0.5 left-0.5 size-1 rounded-full bg-foreground/50"
          aria-hidden
        />
      )}
    </div>
  );

  return active ? <PopoverAnchor asChild>{inner}</PopoverAnchor> : inner;
});
