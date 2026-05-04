"use client";

import Link from "next/link";

// Attendance wide grid. Rows = students (~30), columns = term school-days
// (~47). Cell count at HFSE scale: ~1,410 per render.
//
// Render-perf invariants — do not regress:
//   1. Each cell uses a NATIVE <select>, not shadcn/Radix Select. Radix
//      Select mounts a Portal per instance; 1,410 portals is catastrophic.
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

import { Bus, CalendarDays, CheckCircle2, Loader2, Star, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// Local-tz ISO for today. Inline helper — the file doesn't pull from
// lib/attendance/calendar.ts to stay a pure client leaf.
function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

import { ChartLegendChip, type ChartLegendChipColor } from "@/components/dashboard/chart-legend-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CalendarEventRow, SchoolCalendarRow } from "@/lib/attendance/calendar";
import type { DailyEntryRow } from "@/lib/attendance/queries";
import {
  ATTENDANCE_STATUS_LABELS,
  DAY_TYPE_LABELS,
  EX_REASON_LABELS,
  isEncodableDayType,
  type AttendanceStatus,
  type DayType,
  type ExReason,
} from "@/lib/schemas/attendance";

// Status → ChartLegendChip color. The CELL renders the same gradient
// (via statusChipGradient below) and the LEGEND renders ChartLegendChip
// with this color, so cell + chip pixel-match per §10 of the design
// patterns doc. EX shares one color regardless of subtype — the LETTER
// (EM/EC/ES) disambiguates, not the colour.
const STATUS_CHIP_COLOR: Record<AttendanceStatus, ChartLegendChipColor> = {
  P: "fresh",
  L: "stale",
  EX: "primary",
  A: "very-stale",
  NC: "neutral",
};

// Day-type → ChartLegendChip color. Mirrors the calendar admin's
// DAY_TYPE_LEGEND_COLOR exactly so the wide-grid header chip and the
// calendar's day-type chip read as the same affordance across surfaces.
// 'school_day' uses 'fresh' to match the calendar.
const DAY_TYPE_CHIP_COLOR: Record<DayType, ChartLegendChipColor> = {
  school_day: "fresh",
  public_holiday: "very-stale",
  school_holiday: "stale",
  hbl: "primary",
  no_class: "neutral",
};

// Short labels for column-header chips (1-3 chars to fit the dense
// 36px-wide column). 'school_day' renders no chip — it's the default
// state and a chip on every column would be visual noise.
const DAY_TYPE_HEADER_CHIP_LABEL: Record<DayType, string | null> = {
  school_day: null,
  public_holiday: "PH",
  school_holiday: "SH",
  hbl: "HBL",
  no_class: "NC",
};

// Status → cell gradient classes. Uses the SAME gradient palette as
// ChartLegendChip's chipGradientByColor map, so the cell wash + the
// legend chip render as the same affordance. White text on gradient
// matches ChartLegendChip's text-white default.
const STATUS_CHIP_GRADIENT: Record<AttendanceStatus, string> = {
  P: "from-chart-5 to-chart-3 text-white",
  L: "from-brand-amber to-brand-amber/80 text-white",
  EX: "from-brand-indigo to-brand-navy text-white",
  A: "from-destructive to-destructive/80 text-white",
  NC: "from-ink-4 to-ink-3 text-white",
};

function statusChipGradient(status: AttendanceStatus | null): string {
  return status ? "bg-gradient-to-b " + STATUS_CHIP_GRADIENT[status] : "text-foreground";
}

// Faint per-day-type cell tint, kept under the gradient pill so non-
// school-day columns read as a vertical band even when no status is set.
const DAY_TYPE_CELL_BG: Record<DayType, string> = {
  school_day: "",
  public_holiday: "bg-destructive/5",
  school_holiday: "bg-brand-amber/5",
  hbl: "bg-primary/5",
  no_class: "bg-muted/20",
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
};

// Dropdown option value shape: "P" | "L" | "EX:mc" | "EX:compassionate" |
// "EX:school_activity" | "A" | "NC" | "" (unmarked)
type OptionValue = "" | "P" | "L" | "EX:mc" | "EX:compassionate" | "EX:school_activity" | "A" | "NC";

const TEACHER_OPTIONS: Array<{ value: OptionValue; label: string }> = [
  { value: "", label: "—" },
  { value: "P", label: "P · Present" },
  { value: "L", label: "L · Late" },
  { value: "EX:mc", label: "EX · MC" },
  { value: "EX:compassionate", label: "EX · Compassionate" },
  { value: "EX:school_activity", label: "EX · School activity" },
  { value: "A", label: "A · Absent" },
];

const REGISTRAR_OPTIONS: Array<{ value: OptionValue; label: string }> = [
  ...TEACHER_OPTIONS,
  { value: "NC", label: "NC · No class" },
];

function decodeOption(value: OptionValue): { status: AttendanceStatus; exReason: ExReason | null } | null {
  if (!value) return null;
  if (value.startsWith("EX:")) {
    return { status: "EX", exReason: value.slice(3) as ExReason };
  }
  return { status: value as AttendanceStatus, exReason: null };
}

function encodeOption(status: AttendanceStatus | null, exReason: ExReason | null): OptionValue {
  if (status == null) return "";
  if (status === "EX") return `EX:${exReason ?? "mc"}` as OptionValue;
  return status;
}

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

  const [cells, setCells] = useState<Map<GridKey, CellState>>(() => new Map(seed));

  function updateCell(k: GridKey, patch: Partial<CellState>) {
    setCells((current) => {
      const next = new Map(current);
      const prev = next.get(k) ?? { status: null, exReason: null, saving: false, savedAt: null };
      next.set(k, { ...prev, ...patch });
      return next;
    });
  }

  async function writeCell(enrolmentId: string, date: string, status: AttendanceStatus, exReason: ExReason | null) {
    void sectionId; // reserved: future bulk endpoint may use it
    const k = keyFor(enrolmentId, date);
    const prev = cells.get(k) ?? { status: null, exReason: null, saving: false, savedAt: null };
    updateCell(k, { status, exReason, saving: true });
    try {
      const res = await fetch("/api/attendance/daily", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sectionStudentId: enrolmentId,
          termId,
          date,
          status,
          exReason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "save failed");
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
      updateCell(k, { status: prev.status, exReason: prev.exReason, saving: false });
      toast.error(`Could not save: ${e instanceof Error ? e.message : "error"}`);
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
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, []);

  // Calendar columns in order; each flagged with day_type + event labels.
  // `drawMonthBoundary` is true for month-starts EXCEPT the first column —
  // the first column already has the roster pane's right border as its
  // visual boundary.
  const columns = useMemo(() => {
    const evBy = (iso: string) => events.filter((e) => iso >= e.startDate && iso <= e.endDate);
    let prevMonth = "";
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
      };
    });
  }, [calendar, events]);

  // Group by month for banner rows.
  const monthGroups = useMemo(() => {
    const groups: Array<{ month: string; label: string; dates: typeof columns }> = [];
    for (const col of columns) {
      const key = col.iso.slice(0, 7);
      let g = groups[groups.length - 1];
      if (!g || g.month !== key) {
        const [y, m] = key.split("-");
        const d = new Date(Number(y), Number(m) - 1, 1);
        g = {
          month: key,
          label: d.toLocaleDateString("en-SG", { month: "short", year: "numeric" }),
          dates: [],
        };
        groups.push(g);
      }
      g.dates.push(col);
    }
    return groups;
  }, [columns]);

  const options = canWriteNc ? REGISTRAR_OPTIONS : TEACHER_OPTIONS;

  if (columns.length === 0) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" aria-hidden />
          </div>
          <CardTitle className="font-serif">No calendar configured</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Attendance can&apos;t be recorded until the registrar configures the school calendar for this term. Seed the
            weekdays to start encoding.
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

  return (
    <div className="space-y-3">
      <Card className="p-0 overflow-hidden">
        {enrolments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-5" aria-hidden />
            </div>
            <p className="text-sm text-muted-foreground">No students enrolled in this section yet.</p>
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
              <Table noWrapper className="border-separate border-spacing-0 text-[11px]">
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 180 }} />
                </colgroup>
                <TableHeader>
                  <TableRow style={{ height: ROW_HEIGHT.monthBanner }} className="hover:bg-transparent">
                    <TableHead
                      colSpan={2}
                      className="h-auto border-b border-border bg-muted/60 px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Roster
                    </TableHead>
                  </TableRow>
                  <TableRow style={{ height: ROW_HEIGHT.dateRow }} className="hover:bg-transparent">
                    <TableHead className="h-auto border-b border-r border-border bg-muted/60 px-1 py-1 text-right font-mono text-[10px] font-semibold text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="h-auto border-b border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                      Student
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrolments.map((e) => (
                    <TableRow
                      key={e.enrolmentId}
                      style={{ height: ROW_HEIGHT.body }}
                      className={
                        e.withdrawn
                          ? "bg-muted/10 text-muted-foreground hover:bg-muted/10"
                          : "odd:bg-muted/[0.04] hover:bg-muted/20"
                      }>
                      <TableCell className="overflow-hidden border-r border-border px-1 py-1 text-right font-mono tabular-nums text-muted-foreground">
                        {e.indexNumber}
                      </TableCell>
                      <TableCell className="overflow-hidden px-2 py-1">
                        <div
                          className={
                            "truncate text-[12px] font-medium " + (e.withdrawn ? "line-through" : "text-foreground")
                          }
                          title={e.studentName}>
                          {e.studentName}
                        </div>
                        <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                          <span>{e.studentNumber}</span>
                          {e.busNo && (
                            <Badge
                              variant="secondary"
                              className="gap-0.5 border-0 px-1.5 py-0 text-[10px] font-normal shadow-none"
                              title="Bus number">
                              <Bus aria-hidden /> {e.busNo}
                            </Badge>
                          )}
                          {e.classroomOfficerRole && (
                            <Badge
                              variant="secondary"
                              className="gap-0.5 border-0 px-1.5 py-0 text-[10px] font-normal shadow-none"
                              title="Classroom officer">
                              <Star aria-hidden /> {e.classroomOfficerRole}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ─── Calendar pane — scrolls horizontally ─── */}
            <div className="flex-1 overflow-x-auto">
              <Table noWrapper className="border-separate border-spacing-0 table-fixed text-[11px]">
                <colgroup>
                  {columns.map((c) => (
                    <col key={c.iso} style={{ width: 36 }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>
                <TableHeader>
                  <TableRow style={{ height: ROW_HEIGHT.monthBanner }} className="hover:bg-transparent">
                    {monthGroups.map((g) => (
                      <TableHead
                        key={g.month}
                        colSpan={g.dates.length}
                        className="h-auto border-b border-r border-border bg-muted/60 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {g.label}
                      </TableHead>
                    ))}
                    <TableHead className="h-auto border-b border-border bg-muted/60 p-0" />
                  </TableRow>
                  <TableRow style={{ height: ROW_HEIGHT.dateRow }} className="hover:bg-transparent">
                    {columns.map((c) => {
                      const weekday = new Date(
                        Number(c.iso.slice(0, 4)),
                        Number(c.iso.slice(5, 7)) - 1,
                        Number(c.iso.slice(8, 10)),
                      ).toLocaleDateString("en-SG", { weekday: "short" });
                      const eventLabel = c.events.map((e) => e.label).join(" · ");
                      const dayTypeTitle = `${DAY_TYPE_LABELS[c.dayType]}${
                        c.label ? ` · ${c.label}` : ""
                      }${eventLabel ? ` · ${eventLabel}` : ""}`;
                      const isToday = c.iso === todayIso;
                      const headerChipLabel = DAY_TYPE_HEADER_CHIP_LABEL[c.dayType];
                      return (
                        <TableHead
                          key={c.iso}
                          ref={isToday ? todayHeaderRef : undefined}
                          title={isToday ? `Today · ${dayTypeTitle}` : dayTypeTitle}
                          className={
                            "h-auto overflow-hidden border-b border-border bg-muted/40 px-1 py-1 text-center font-mono text-[10px] font-semibold text-foreground " +
                            (c.drawMonthBoundary ? " border-l-2 border-l-border" : "") +
                            (isToday ? " relative ring-2 ring-inset ring-brand-indigo" : "")
                          }>
                          <div className="leading-tight">{c.iso.slice(-2)}</div>
                          <div className="text-[9px] font-normal opacity-70">{weekday.slice(0, 3)}</div>
                          {/* Day-type pill — same ChartLegendChip rendered in
                              the legend below, so the column header and the
                              legend chip read as the same affordance per §10. */}
                          {headerChipLabel && (
                            <div className="mt-0.5 flex justify-center">
                              <ChartLegendChip
                                color={DAY_TYPE_CHIP_COLOR[c.dayType]}
                                label={headerChipLabel}
                                className="px-1 py-px text-[9px] tracking-[0.1em]"
                              />
                            </div>
                          )}
                          {c.events.length > 0 && (
                            <div className="mt-0.5 truncate text-[9px] font-normal text-primary">★</div>
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
                          ? "bg-muted/10 text-muted-foreground hover:bg-muted/10"
                          : "odd:bg-muted/[0.04] hover:bg-muted/20"
                      }>
                      {columns.map((c) => {
                        const cell = cells.get(keyFor(e.enrolmentId, c.iso));
                        const status = cell?.status ?? null;
                        const exReason = cell?.exReason ?? null;
                        const currentValue = encodeOption(status, exReason);
                        const disabled = e.withdrawn || !c.encodable;

                        return (
                          <TableCell
                            key={c.iso}
                            className={
                              "overflow-hidden p-0 text-center align-middle " +
                              DAY_TYPE_CELL_BG[c.dayType] +
                              (c.drawMonthBoundary ? " border-l-2 border-l-border" : "")
                            }>
                            {!c.encodable ? (
                              <span
                                className="block px-1 py-1 text-[10px] text-muted-foreground"
                                title={`${DAY_TYPE_LABELS[c.dayType]}${c.label ? ` · ${c.label}` : ""}`}>
                                —
                              </span>
                            ) : (
                              <div className={"relative " + statusChipGradient(status)}>
                                <select
                                  value={currentValue}
                                  disabled={disabled}
                                  onChange={(ev) => {
                                    const decoded = decodeOption(ev.target.value as OptionValue);
                                    if (!decoded) return;
                                    void writeCell(e.enrolmentId, c.iso, decoded.status, decoded.exReason);
                                  }}
                                  className={
                                    "w-full appearance-none bg-transparent px-1 py-1 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.06em] focus:outline-none focus:ring-1 focus:ring-primary " +
                                    (status ? "text-white" : "text-foreground")
                                  }
                                  title={
                                    status
                                      ? `${ATTENDANCE_STATUS_LABELS[status]}${
                                          status === "EX" && exReason ? ` · ${EX_REASON_LABELS[exReason]}` : ""
                                        }`
                                      : "Unmarked"
                                  }>
                                  {options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.value === ""
                                        ? "—"
                                        : o.value.startsWith("EX:")
                                          ? `E${o.value.slice(3, 4).toUpperCase()}`
                                          : o.value}
                                    </option>
                                  ))}
                                </select>
                                {cell?.saving && (
                                  <Loader2 className="absolute right-0 top-0 size-2.5 animate-spin text-muted-foreground" />
                                )}
                                {cell?.savedAt && (
                                  <CheckCircle2 className="absolute right-0 top-0 size-2.5 text-primary" />
                                )}
                              </div>
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

      {/* Legend */}
      <Card className="p-4 text-xs text-muted-foreground">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          Status · cell colour
        </p>
        {/* Each chip is the SAME ChartLegendChip used
            inside the cell when populated, so legend ↔ cell pixel-match
            per docs/context/09a-design-patterns.md §10. EX has 3 entries
            (EM / EC / ES) matching the dropdown's letter transform — they
            share the indigo gradient since the colour is by status family,
            the letter by sub-reason. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
          <StatusLegendChip status="P" letter="P" description="Present" />
          <StatusLegendChip status="L" letter="L" description="Late" />
          <StatusLegendChip status="EX" letter="EM" description="Excused · MC" />
          <StatusLegendChip status="EX" letter="EC" description="Excused · Compassionate" />
          <StatusLegendChip status="EX" letter="ES" description="Excused · School activity" />
          <StatusLegendChip status="A" letter="A" description="Absent" />
          {canWriteNc && <StatusLegendChip status="NC" letter="NC" description="No class" />}
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
          <DayTypeLegendChip dayType="school_day" letter="·" description="School day (default)" />
          <DayTypeLegendChip dayType="public_holiday" letter="PH" description="Public holiday" />
          <DayTypeLegendChip dayType="school_holiday" letter="SH" description="School holiday" />
          <DayTypeLegendChip dayType="hbl" letter="HBL" description="HBL · Attendance recorded" />
          <DayTypeLegendChip dayType="no_class" letter="NC" description="No class" />
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          ★ marks dates with a calendar event.
        </p>
      </Card>
    </div>
  );
}

// Legend row pairing a ChartLegendChip swatch with a description label.
// The swatch is the SAME ChartLegendChip rendered inside cells when status
// is set, so legend + cell read as the same affordance per the "true
// visual key" rule in docs/context/09a-design-patterns.md §10.
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
      <ChartLegendChip color={STATUS_CHIP_COLOR[status]} label={letter} />
      <span className="text-[12px] font-medium text-foreground">{description}</span>
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
      <span className="text-[12px] font-medium text-foreground">{description}</span>
    </span>
  );
}
