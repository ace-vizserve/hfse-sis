'use client';

import Link from 'next/link';

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
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Local-tz ISO for today. Inline helper — the file doesn't pull from
// lib/attendance/calendar.ts to stay a pure client leaf.
function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
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
import {
  STATUS_CELL_WASH,
  statusCellWash,
} from '@/components/attendance/status-wash';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { summarizeByMonth, type Mark } from '@/lib/attendance/sheet-summary';
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

// Day-type → ChartLegendChip color. Mirrors the calendar admin's
// DAY_TYPE_LEGEND_COLOR exactly so the wide-grid header chip and the
// calendar's day-type chip read as the same affordance across surfaces.
// 'school_day' uses 'fresh' to match the calendar.
const DAY_TYPE_CHIP_COLOR: Record<DayType, ChartLegendChipColor> = {
  school_day: 'fresh',
  public_holiday: 'very-stale',
  school_holiday: 'stale',
  hbl: 'primary',
  no_class: 'neutral',
};

// COLUMN_TAG_COLOR (date-column tag → ChartLegendChip color) is shared with the
// sheet-context card's term-calendar key — see components/attendance/column-tags.ts (§10.2).

// STATUS_CELL_WASH (status → HFSE paper-palette wash) + statusCellWash now live
// in components/attendance/status-wash.ts — shared single source (§10.2) for the
// grid cells, the legend, AND the cell-mark popover chips.

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
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  canWriteNc: boolean;
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
  const [showSummary, setShowSummary] = useState(false);
  // The one open cell-mark popover (single portal — see the marking-palette note
  // above and the perf invariants in the file header). null = closed.
  const [activeCell, setActiveCell] = useState<{
    enrolmentId: string;
    iso: string;
  } | null>(null);

  function busCareLabel(e: WideGridEnrolment): string {
    return [e.busNo, e.classroomOfficerRole].filter(Boolean).join(' / ') || '—';
  }

  function updateCell(k: GridKey, patch: Partial<CellState>) {
    setCells((current) => {
      const next = new Map(current);
      const prev = next.get(k) ?? {
        status: null,
        exReason: null,
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
    }) => apiFetch('/api/attendance/daily', jsonInit('PATCH', payload)),
  });

  async function writeCell(
    enrolmentId: string,
    date: string,
    status: AttendanceStatus,
    exReason: ExReason | null
  ) {
    void sectionId; // reserved: future bulk endpoint may use it
    const k = keyFor(enrolmentId, date);
    const prev = cells.get(k) ?? {
      status: null,
      exReason: null,
      saving: false,
      savedAt: null,
    };

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

    updateCell(k, { status, exReason, saving: true });
    try {
      await saveCellMutation.mutateAsync({
        sectionStudentId: enrolmentId,
        termId,
        date,
        status,
        exReason,
      });
      updateCell(k, { saving: false, savedAt: Date.now() });
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
      return {
        iso: c.date,
        dayType: c.dayType,
        encodable: isEncodableDayType(c.dayType),
        label: c.label,
        events: evBy(c.date),
        drawMonthBoundary: isMonthStart && idx > 0,
        tag: resolveColumnTag({ dayType: c.dayType, events: evBy(c.date) }),
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

  // Per-student marks (from the live cells Map) → summary rows. Recomputes on
  // edit so the panel stays live. Withdrawn rows excluded (match the roster).
  //
  // NOTE: this summary iterates calendar-configured `columns` (school days for
  // the selected term); the export builder iterates the full term date window.
  // Both feed the same `summarizeMarks` helper, so totals match for normal
  // data. The difference is intentional — don't try to "align" them.
  const summaryRows = useMemo(() => {
    if (!showSummary) return [];
    return enrolments
      .filter((e) => !e.withdrawn)
      .map((e) => {
        const marks: Mark[] = columns.map((c) => ({
          date: c.iso,
          status: cells.get(keyFor(e.enrolmentId, c.iso))?.status ?? null,
        }));
        return { enrolment: e, ...summarizeByMonth(marks) };
      });
  }, [showSummary, enrolments, columns, cells]);

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
  // vertically. Both panes use identical <tr style={{height}}> values.
  const ROW_HEIGHT = { monthBanner: 28, dateRow: 48, body: 40 };

  // Resolve the active cell → its student + current mark, for the shared popover.
  const activeEnrolment = activeCell
    ? (enrolments.find((e) => e.enrolmentId === activeCell.enrolmentId) ?? null)
    : null;
  const activeCellState = activeCell
    ? (cells.get(keyFor(activeCell.enrolmentId, activeCell.iso)) ?? null)
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
        <Button
          type="button"
          variant={showSummary ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary ? 'Hide summary' : 'Show summary'}
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
            // Two-pane flex layout — roster on the left (fixed width, no
            // horizontal scroll), calendar on the right (scrolls horizontally
            // independently). Replaces the legacy single-table sticky-column
            // design which had browser bugs with position: sticky inside
            // border-collapse tables, causing the first date to be covered
            // by the last sticky roster column. Two tables, row heights
            // locked, alignment is deterministic.
            <div className="flex">
              {/* ─── Roster pane — fixed width, no horizontal scroll ─── */}
              <div className="shrink-0 border-r border-border">
                <Table
                  noWrapper
                  className="border-separate border-spacing-0 text-[11px]"
                >
                  <colgroup>
                    <col style={{ width: 40 }} />
                    <col style={{ width: 180 }} />
                    {showDetails && <col style={{ width: 120 }} />}
                    {showDetails && <col style={{ width: 90 }} />}
                    {showDetails && <col style={{ width: 90 }} />}
                  </colgroup>
                  <TableHeader>
                    <TableRow
                      style={{ height: ROW_HEIGHT.monthBanner }}
                      className="hover:bg-transparent"
                    >
                      <TableHead
                        colSpan={showDetails ? 5 : 2}
                        className="h-auto border-b border-border bg-muted/60 px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        Roster
                      </TableHead>
                    </TableRow>
                    <TableRow
                      style={{ height: ROW_HEIGHT.dateRow }}
                      className="hover:bg-transparent"
                    >
                      <TableHead className="h-auto border-b border-r border-border bg-muted/60 px-1 py-1 text-right font-mono text-[10px] font-semibold text-muted-foreground">
                        #
                      </TableHead>
                      <TableHead className="h-auto border-b border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                        Student
                      </TableHead>
                      {showDetails && (
                        <>
                          <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                            Bus / Student Care
                          </TableHead>
                          <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                            Academics
                          </TableHead>
                          <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                            Admin
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrolments.map((e) => (
                      <TableRow
                        key={e.enrolmentId}
                        style={{ height: ROW_HEIGHT.body }}
                        className={
                          e.withdrawn
                            ? 'bg-muted/10 text-muted-foreground hover:bg-muted/10'
                            : 'odd:bg-muted/[0.04] hover:bg-muted/20'
                        }
                      >
                        <TableCell className="overflow-hidden border-r border-border px-1 py-1 text-right font-mono tabular-nums text-muted-foreground">
                          {e.indexNumber}
                        </TableCell>
                        <TableCell className="overflow-hidden px-2 py-1">
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
                            <span>{e.studentNumber}</span>
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
                          <>
                            <TableCell className="overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground">
                              {busCareLabel(e)}
                            </TableCell>
                            <TableCell className="border-l border-border px-2 py-1 text-center text-[11px] text-muted-foreground">
                              —
                            </TableCell>
                            <TableCell className="border-l border-border px-2 py-1 text-center text-[11px] text-muted-foreground">
                              —
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ─── Calendar pane — scrolls horizontally ─── */}
              <div className="flex-1 overflow-x-auto">
                <Table
                  noWrapper
                  className="border-separate border-spacing-0 table-fixed text-[11px]"
                >
                  <colgroup>
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
                      {monthGroups.map((g) => (
                        <TableHead
                          key={g.month}
                          colSpan={g.dates.length}
                          className="h-auto border-b border-r border-border bg-muted/60 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                        >
                          {g.label}
                        </TableHead>
                      ))}
                      <TableHead className="h-auto border-b border-border bg-muted/60 p-0" />
                    </TableRow>
                    <TableRow
                      style={{ height: ROW_HEIGHT.dateRow }}
                      className="hover:bg-transparent"
                    >
                      {columns.map((c) => {
                        const weekday = new Date(
                          Number(c.iso.slice(0, 4)),
                          Number(c.iso.slice(5, 7)) - 1,
                          Number(c.iso.slice(8, 10))
                        ).toLocaleDateString('en-SG', { weekday: 'short' });
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
                            className={
                              'h-auto overflow-hidden border-b border-border bg-muted/40 px-1 py-1 text-center font-mono text-[10px] font-semibold text-foreground ' +
                              (c.drawMonthBoundary
                                ? ' border-l-2 border-l-border'
                                : '') +
                              (isToday
                                ? ' relative ring-2 ring-inset ring-brand-indigo'
                                : '')
                            }
                          >
                            <div className="leading-tight">
                              {c.iso.slice(-2)}
                            </div>
                            <div className="text-[9px] font-normal opacity-70">
                              {weekday.slice(0, 3)}
                            </div>
                            {/* Column tag — resolveColumnTag picks the single
                              most-informative tag: PH/SH/NC from day_type,
                              EX for exam events, SE for other events, HBL
                              for HBL days; plain school days are untagged.
                              Same ChartLegendChip rendered in the legend below
                              so the column header and legend chip read as the
                              same affordance per §10. */}
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
                      <TableHead className="h-auto border-b border-border bg-muted/60 p-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrolments.map((e) => (
                      <TableRow
                        key={e.enrolmentId}
                        style={{ height: ROW_HEIGHT.body }}
                        className={
                          e.withdrawn
                            ? 'bg-muted/10 text-muted-foreground hover:bg-muted/10'
                            : 'odd:bg-muted/[0.04] hover:bg-muted/20'
                        }
                      >
                        {columns.map((c) => {
                          const cell = cells.get(keyFor(e.enrolmentId, c.iso));
                          const status = cell?.status ?? null;
                          const exReason = cell?.exReason ?? null;
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
                                  active={
                                    activeCell?.enrolmentId === e.enrolmentId &&
                                    activeCell?.iso === c.iso
                                  }
                                  withdrawn={e.withdrawn}
                                  status={status}
                                  exReason={exReason}
                                  saving={!!cell?.saving}
                                  saved={!!cell?.savedAt}
                                  onOpen={() =>
                                    setActiveCell({
                                      enrolmentId: e.enrolmentId,
                                      iso: c.iso,
                                    })
                                  }
                                />
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="bg-background p-0" />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </Card>
        <PopoverContent align="center" sideOffset={6} className="w-64">
          {activeEnrolment && activeCell && (
            <CellMarkPalette
              studentName={activeEnrolment.studentName}
              dateLabel={cellDateLabel(activeCell.iso)}
              status={activeCellState?.status ?? null}
              exReason={activeCellState?.exReason ?? null}
              canWriteNc={canWriteNc}
              vlUsed={activeEnrolment.vlUsedThisTerm}
              vlAllowance={activeEnrolment.vlAllowance}
              compassionateUsed={activeEnrolment.compassionateUsed}
              compassionateAllowance={activeEnrolment.compassionateAllowance}
              onPick={(status, exReason) => {
                void writeCell(
                  activeCell.enrolmentId,
                  activeCell.iso,
                  status,
                  exReason
                );
                setActiveCell(null);
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      {/* Summary panel — per-month + term totals per student */}
      {showSummary && (
        <Card className="overflow-x-auto p-0">
          <Table noWrapper className="text-[12px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 py-2 text-left">Student</TableHead>
                <TableHead className="px-2 py-2 text-left">Period</TableHead>
                <TableHead className="px-2 py-2 text-right">Days</TableHead>
                <TableHead className="px-2 py-2 text-right">P</TableHead>
                <TableHead className="px-2 py-2 text-right">L</TableHead>
                <TableHead className="px-2 py-2 text-right">EX</TableHead>
                <TableHead className="px-2 py-2 text-right">A</TableHead>
                <TableHead className="px-2 py-2 text-right">
                  Attendance %
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryRows.map(({ enrolment, months, term }) => (
                <SummaryStudentRows
                  key={enrolment.enrolmentId}
                  name={enrolment.studentName}
                  months={months}
                  term={term}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Legend */}
      <Card className="p-4 text-xs text-muted-foreground">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          Status · cell colour
        </p>
        {/* Each swatch reads the SAME STATUS_CELL_WASH map used inside the
            cell when populated, so legend ↔ cell pixel-match per
            docs/context/09a-design-patterns.md §10.2 (bespoke swatch for grid
            cell tints). EX is a single chip — the cell collapses every EX
            subtype (MC / vacation / compassionate) to "EX";
            the subtype is still selectable in the dropdown + stored (KD #94),
            and shown in the cell tooltip. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
          <StatusLegendChip status="P" letter="P" description="Present" />
          <StatusLegendChip status="L" letter="L" description="Late" />
          <StatusLegendChip status="EX" letter="EX" description="Excused" />
          <StatusLegendChip status="A" letter="A" description="Absent" />
          {canWriteNc && (
            <StatusLegendChip status="NC" letter="NC" description="No class" />
          )}
        </div>
        <p className="mt-3 mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          Calendar · column header
        </p>
        {/* Day-type chips are the SAME ChartLegendChip rendered in column
            headers, so the column-header chip and the legend chip read as
            the same affordance per §10. School day is the default — no chip
            on its column headers, so the legend chip just signals "this is
            what a teaching day looks like elsewhere in the SIS". */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
          <DayTypeLegendChip
            dayType="school_day"
            letter="·"
            description="School day (default)"
          />
          <DayTypeLegendChip
            dayType="public_holiday"
            letter="PH"
            description="Public holiday"
          />
          <DayTypeLegendChip
            dayType="school_holiday"
            letter="SH"
            description="School holiday"
          />
          <DayTypeLegendChip
            dayType="hbl"
            letter="HBL"
            description="HBL · Attendance recorded"
          />
          <DayTypeLegendChip
            dayType="no_class"
            letter="NC"
            description="No class"
          />
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.SE} label="SE" />
            <span className="text-[12px] font-medium text-foreground">
              School event
            </span>
          </span>
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.EX} label="EX" />
            <span className="text-[12px] font-medium text-foreground">
              Examination
            </span>
          </span>
        </div>
      </Card>
    </div>
  );
}

// The per-cell control: a plain button showing the canonical letter on its
// paper-palette wash. Clicking opens the one shared marking popover; when this
// cell is the active one it becomes the popover's anchor. Withdrawn cells render
// a non-interactive letter (no marking). Replaces the old native <select>.
function CellButton({
  active,
  withdrawn,
  status,
  exReason,
  saving,
  saved,
  onOpen,
}: {
  active: boolean;
  withdrawn: boolean;
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  saving: boolean;
  saved: boolean;
  onOpen: () => void;
}) {
  const label = status ?? '—';
  const tip = status
    ? `${ATTENDANCE_STATUS_LABELS[status]}${status === 'EX' && exReason ? ` · ${EX_REASON_LABELS[exReason]}` : ''}`
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
          onClick={onOpen}
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
    </div>
  );

  return active ? <PopoverAnchor asChild>{inner}</PopoverAnchor> : inner;
}

// Legend row pairing a marking-cell swatch with a description label. The
// swatch reads the SAME STATUS_CELL_WASH map applied to the cells when status
// is set, so legend + cell are pixel-identical paint per the "true visual
// key" rule in docs/context/09a-design-patterns.md §10.2 (bespoke swatch for
// grid cell tints). The letter sits ON the swatch so the key shows both the
// colour AND the letter exactly as the grid does.
function StatusLegendChip({
  status,
  letter,
  description,
}: {
  status: AttendanceStatus;
  letter: string;
  description: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          'inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] shadow-input ' +
          STATUS_CELL_WASH[status]
        }
      >
        {letter}
      </span>
      <span className="text-[12px] font-medium text-foreground">
        {description}
      </span>
    </span>
  );
}

// Sibling to StatusLegendChip — pulls its color from the same
// DAY_TYPE_CHIP_COLOR map the column header chips use, so legend + header
// stay pixel-identical. Single source of truth, per §10.
function DayTypeLegendChip({
  dayType,
  letter,
  description,
}: {
  dayType: DayType;
  letter: string;
  description: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <ChartLegendChip color={DAY_TYPE_CHIP_COLOR[dayType]} label={letter} />
      <span className="text-[12px] font-medium text-foreground">
        {description}
      </span>
    </span>
  );
}

// Per-student rows in the summary panel: one <TableRow> per month block +
// one term-total <TableRow>. The student name spans all rows via rowSpan.
function SummaryStudentRows({
  name,
  months,
  term,
}: {
  name: string;
  months: import('@/lib/attendance/sheet-summary').MonthlySummary[];
  term: import('@/lib/attendance/sheet-summary').SummaryStat;
}) {
  const pct = (p: number | null) => (p == null ? '—' : `${p.toFixed(1)}%`);
  return (
    <>
      {months.map((m, i) => (
        <TableRow key={m.month}>
          {i === 0 ? (
            <TableCell
              rowSpan={months.length + 1}
              className="px-3 py-2 align-top font-medium text-foreground"
            >
              {name}
            </TableCell>
          ) : null}
          <TableCell className="px-2 py-2 text-muted-foreground">
            {m.label}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.totalDays}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.present}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.late}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.excused}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.absent}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {pct(m.stat.attendancePct)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/30 font-semibold">
        <TableCell className="px-2 py-2">Term total</TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.totalDays}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.present}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.late}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.excused}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.absent}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {pct(term.attendancePct)}
        </TableCell>
      </TableRow>
    </>
  );
}
