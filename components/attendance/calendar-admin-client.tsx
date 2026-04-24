"use client";

import { CalendarOff, CalendarPlus, CheckCheck, ChevronLeft, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { CopyHolidaysDialog } from "@/components/attendance/copy-holidays-dialog";
import { ChartLegendChip } from "@/components/dashboard/chart-legend-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarEventRow, SchoolCalendarRow } from "@/lib/attendance/calendar";
import { DAY_TYPE_LABELS, DAY_TYPE_VALUES, isEncodableDayType, type DayType } from "@/lib/schemas/attendance";

// School-calendar admin. Two views — Month grid and Full-term strip — both
// rendered as custom 5-column (Mon–Fri) grids. Weekends are not school days
// and are not rendered; the design-system (§6) allows custom composition when
// no registry fits (per §5 step 4).
//
// UX model: every weekday is a school day by default. The page RSC
// auto-seeds `school_calendar` rows on first visit via ensureTermSeeded(),
// so the registrar never sees empty state. The only actions on a weekday
// click are "Set as holiday" and "Set as important date".
//
// Allowlist semantics (migration 015) are preserved underneath: the
// attendance grid reads `school_calendar` rows and treats missing rows as
// non-encodable once the term has ≥1 row. Auto-seed guarantees that
// state — the UI just never shows it.
//
// Events (`calendar_events`) are informational labels overlaid as a
// primary-colored dot in the cell's top-right corner.

type TermOption = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};

type CopyHolidaysProps = {
  targetTermId: string;
  targetTermLabel: string;
  targetYear: number;
  sourceAyCode: string;
  sourceHolidays: SchoolCalendarRow[];
};

// Short banner labels printed inside each cell (below the day number).
// Keep terse — cell is ~80px wide. `school_day` is intentionally null so
// the default encodable state renders nothing; showing "School" on every
// weekday would be pure noise.
const DAY_TYPE_SHORT_LABEL: Record<DayType, string | null> = {
  school_day: null,
  public_holiday: "Public",
  school_holiday: "School hol.",
  hbl: "HBL",
  no_class: "No class",
};

// Tint + descriptive copy per day-type (KD #50). Spec §4.1 recipe: solid
// medium-opacity wash + inset colored ring (cell), gradient chip + white text
// (chip). All colors resolve to Aurora Vault tokens; rgba in shadow-[...] are
// intentional (match hex values of brand tokens at specified opacity).
const DAY_TYPE_STYLES: Record<DayType, { cell: string; chip: string; blurb: string }> = {
  school_day: {
    cell: "bg-brand-mint/50 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(34,197,94,0.35)] hover:bg-brand-mint/60",
    chip: "bg-gradient-to-b from-chart-5 to-chart-3 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "Regular in-school day. Attendance is taken.",
  },
  public_holiday: {
    cell: "bg-destructive/22 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(239,68,68,0.45)] hover:bg-destructive/30",
    chip: "bg-gradient-to-b from-destructive to-destructive/80 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "National / public closure. No attendance taken.",
  },
  school_holiday: {
    cell: "bg-brand-amber/35 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(245,158,11,0.55)] hover:bg-brand-amber/45",
    chip: "bg-gradient-to-b from-brand-amber to-brand-amber/80 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "School-only closure (staff PD, founder’s day). No attendance taken.",
  },
  hbl: {
    cell: "bg-primary/30 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(79,70,229,0.4)] hover:bg-primary/40",
    chip: "bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "Home-based learning. Attendance still taken; counts as a school day.",
  },
  no_class: {
    cell: "bg-muted text-muted-foreground font-semibold shadow-[inset_0_0_0_1px_var(--av-hairline-strong)] hover:bg-muted/90",
    chip: "bg-gradient-to-b from-ink-4 to-ink-3 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "School-wide no class. No attendance taken.",
  },
};

// yyyy-MM-dd → local Date (no tz shift).
function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad iso: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// local Date → yyyy-MM-dd.
function formatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Readable date: "Monday, 15 Jan 2026".
function formatHumanDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CalendarAdminClient({
  terms,
  termId,
  calendar,
  events,
  copyHolidaysProps,
}: {
  terms: TermOption[];
  termId: string;
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  copyHolidaysProps?: CopyHolidaysProps | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const [dateDialogIso, setDateDialogIso] = useState<string | null>(null);
  const [addEventOpen, setAddEventOpen] = useState(false);

  // Multi-select bulk-classify flow. When `multiSelect` is true, clicking a
  // weekday toggles it into `selectedDates` instead of opening the single
  // action dialog. "Apply day-type…" opens `bulkDialogOpen` which writes
  // every selected date in one `POST /api/attendance/calendar` batch.
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [view, setView] = useState<"month" | "term">("month");

  const selectedTerm = terms.find((t) => t.id === termId) ?? terms[0];

  // Index calendar rows by ISO date for O(1) lookup.
  const byDate = useMemo(() => {
    const map = new Map<string, SchoolCalendarRow>();
    for (const r of calendar) map.set(r.date, r);
    return map;
  }, [calendar]);

  // Classified dates grouped by day-type, plus an `event` array of event days.
  const daysByType = useMemo(() => {
    const out: Record<DayType, Date[]> = {
      school_day: [],
      public_holiday: [],
      school_holiday: [],
      hbl: [],
      no_class: [],
    };
    for (const r of calendar) {
      out[r.dayType]?.push(parseIso(r.date));
    }

    // Expand each event's [start..end] into individual days for the dot overlay.
    const eventIsoSet = new Set<string>();
    for (const e of events) {
      const d = parseIso(e.startDate);
      const end = parseIso(e.endDate);
      while (d.getTime() <= end.getTime()) {
        eventIsoSet.add(formatIso(d));
        d.setDate(d.getDate() + 1);
      }
    }
    return { ...out, event: Array.from(eventIsoSet).map(parseIso) };
  }, [calendar, events]);

  // Events overlapping a given ISO date — used by the date-action dialog.
  const eventsOnDate = useMemo(() => {
    return (iso: string): CalendarEventRow[] => events.filter((e) => iso >= e.startDate && iso <= e.endDate);
  }, [events]);

  function switchTerm(next: string) {
    // Clear multi-select selection when crossing terms — the picked dates
    // belong to the previous term's calendar scope and shouldn't leak.
    setView("month");
    setSelectedDates([]);
    setMultiSelect(false);
    startTransition(() => {
      router.push(`${pathname}?term_id=${encodeURIComponent(next)}`);
    });
  }

  function toggleMultiSelect() {
    setMultiSelect((prev) => {
      if (prev) {
        // Exiting multi-select mode clears the pending selection.
        setSelectedDates([]);
      }
      return !prev;
    });
  }

  async function bulkUpsert(dates: Date[], dayType: DayType, label: string | null) {
    if (!selectedTerm || dates.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: selectedTerm.id,
          entries: dates.map((d) => ({ date: formatIso(d), dayType, label })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "save failed");
      toast.success(`${dates.length} date${dates.length === 1 ? "" : "s"} set to ${DAY_TYPE_LABELS[dayType]}.`);
      setSelectedDates([]);
      setMultiSelect(false);
      setBulkDialogOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function upsertDate(iso: string, dayType: DayType, label: string | null) {
    if (!selectedTerm) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: selectedTerm.id,
          entries: [{ date: iso, dayType, label }],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "save failed");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function createEventOnDate(iso: string, label: string) {
    if (!selectedTerm) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: selectedTerm.id,
          startDate: iso,
          endDate: iso,
          label,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "create failed");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "create failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  // Missing row is defensive only — auto-seed should prevent it. Treat as
  // school day so the dialog still offers sensible actions.
  const dateDialogEntry = dateDialogIso ? (byDate.get(dateDialogIso) ?? null) : null;
  const dateDialogType: DayType = dateDialogEntry?.dayType ?? "school_day";

  return (
    <div className="space-y-6">
      {/* Term + action bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="termSel">Term</Label>
          <Select value={termId} onValueChange={switchTerm} disabled={pending}>
            <SelectTrigger id="termSel" className="h-10 w-[260px]">
              <SelectValue placeholder="Pick a term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                  {t.isCurrent && (
                    <span className="ml-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                      current
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedTerm && (
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {selectedTerm.startDate} → {selectedTerm.endDate}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "month" | "term")}>
            <TabsList variant="segmented">
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="term">Full term</TabsTrigger>
            </TabsList>
          </Tabs>
          {copyHolidaysProps && (
            <CopyHolidaysDialog
              targetTermId={copyHolidaysProps.targetTermId}
              targetTermLabel={copyHolidaysProps.targetTermLabel}
              targetYear={copyHolidaysProps.targetYear}
              sourceAyCode={copyHolidaysProps.sourceAyCode}
              sourceHolidays={copyHolidaysProps.sourceHolidays}
            />
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy || !selectedTerm}
            onClick={toggleMultiSelect}
            className="gap-1.5">
            <CheckCheck className="size-3.5" />
            {multiSelect ? "Cancel multi-select" : "Multi-select"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !selectedTerm}
            onClick={() => setAddEventOpen(true)}
            className="gap-1.5">
            <CalendarPlus className="size-3.5" />
            Add date range
          </Button>
          {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Multi-select selection strip. */}
      {multiSelect && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <CheckCheck className="size-4 text-primary" />
            <span className="font-medium tabular-nums">
              {selectedDates.length === 0
                ? "Click dates to build a selection"
                : `${selectedDates.length} date${selectedDates.length === 1 ? "" : "s"} selected`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || selectedDates.length === 0}
              onClick={() => setSelectedDates([])}
              className="gap-1.5">
              <X className="size-3.5" />
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || selectedDates.length === 0}
              onClick={() => setBulkDialogOpen(true)}
              className="gap-1.5">
              Apply day-type
            </Button>
          </div>
        </div>
      )}

      {/* Legend — each chip here matches the in-cell chip color for the same day-type. */}
      {selectedTerm && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-muted/25 px-4 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
          <ChartLegendChip color="very-stale" label="Public holiday" />
          <ChartLegendChip color="stale" label="School holiday" />
          <ChartLegendChip color="primary" label="HBL" />
          <ChartLegendChip color="neutral" label="No class" />
          <span className="inline-flex items-center gap-1.5 rounded-md border border-brand-indigo-soft/40 bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-brand-indigo-deep">
            Event
          </span>
          <span className="ml-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            School days are the default — weekdays without a chip are in-school
          </span>
        </div>
      )}

      {/* Calendar view — Month (default) or Full-term strip */}
      {selectedTerm && view === "month" && (
        <MonthView
          term={selectedTerm}
          daysByType={daysByType}
          events={events}
          multiSelect={multiSelect}
          selectedDates={selectedDates}
          onSelectDates={setSelectedDates}
          onDayClick={(iso) => setDateDialogIso(iso)}
        />
      )}
      {selectedTerm && view === "term" && (
        <TermStripView
          term={selectedTerm}
          daysByType={daysByType}
          multiSelect={multiSelect}
          selectedDates={selectedDates}
          onSelectDates={setSelectedDates}
          onDayClick={(iso) => setDateDialogIso(iso)}
        />
      )}

      {/* Events panel */}
      {selectedTerm && (
        <EventsPanel
          events={events}
          busy={busy}
          onDelete={async (id) => {
            setBusy(true);
            try {
              const res = await fetch(`/api/attendance/calendar/events?id=${encodeURIComponent(id)}`, {
                method: "DELETE",
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body?.error ?? "delete failed");
              router.refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "delete failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {/* Dialogs */}
      <DateActionDialog
        open={dateDialogIso !== null}
        iso={dateDialogIso}
        currentDayType={dateDialogType}
        existingLabel={dateDialogEntry?.label ?? null}
        eventsOnDate={dateDialogIso ? eventsOnDate(dateDialogIso) : []}
        busy={busy}
        onClose={() => setDateDialogIso(null)}
        onSaveDayType={async (iso, dayType, label) => {
          await upsertDate(iso, dayType, label);
          setDateDialogIso(null);
        }}
        onAddImportantDate={async (iso, label) => {
          await createEventOnDate(iso, label);
          setDateDialogIso(null);
        }}
      />

      <AddEventDialog
        open={addEventOpen}
        termId={selectedTerm?.id ?? ""}
        termStart={selectedTerm?.startDate ?? ""}
        termEnd={selectedTerm?.endDate ?? ""}
        onClose={() => setAddEventOpen(false)}
        onCreated={() => {
          setAddEventOpen(false);
          router.refresh();
        }}
      />

      <BulkDayTypeDialog
        open={bulkDialogOpen}
        selectedDates={selectedDates}
        busy={busy}
        onClose={() => setBulkDialogOpen(false)}
        onSave={bulkUpsert}
      />
    </div>
  );
}

function LegendChip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 font-medium ${className}`}>{children}</span>;
}

// Build 5-column (Mon–Fri) weekday rows for the month containing `cursor`.
// Weekends are intentionally excluded — weekdays are school days by default;
// there is no classification granularity for Saturdays / Sundays.
// Out-of-month cells ARE included (with `outOfMonth: true`) so the grid
// renders a full rectangle with leading / trailing days visible but faded —
// Google-Calendar-style — instead of blank gaps.
type MonthCell = {
  iso: string;
  date: Date;
  dayType: DayType | null;
  isToday: boolean;
  inTermRange: boolean;
  outOfMonth: boolean;
};

function buildMonthWeekdayRows(
  cursor: Date,
  termStart: Date,
  termEnd: Date,
  dayTypeByIso: Map<string, DayType>,
): MonthCell[][] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  // Align to the Monday of the week containing the 1st.
  const firstDow = firstOfMonth.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const mondayShift = firstDow === 0 ? -6 : 1 - firstDow;
  const weekStart = new Date(firstOfMonth);
  weekStart.setDate(firstOfMonth.getDate() + mondayShift);

  const todayIso = formatIso(new Date());
  const rows: MonthCell[][] = [];

  while (weekStart.getTime() <= lastOfMonth.getTime()) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = formatIso(d);
      week.push({
        iso,
        date: new Date(d),
        dayType: dayTypeByIso.get(iso) ?? null,
        isToday: iso === todayIso,
        inTermRange:
          d.getTime() >= termStart.getTime() && d.getTime() <= termEnd.getTime(),
        outOfMonth: d.getMonth() !== month,
      });
    }
    rows.push(week);
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return rows;
}

// Horizontal event bar — left-aligned, full-width of cell, colored left border
// with tinted background. Used for both day-type classifications and event-row
// labels (Google-Calendar-style). All colors resolve to Aurora Vault tokens.
function EventBar({
  type,
  label,
}: {
  type: DayType | "event";
  label: string;
}) {
  const classByType: Record<DayType | "event", string> = {
    school_day: "bg-brand-mint/30 text-ink border-l-[3px] border-brand-mint",
    public_holiday: "bg-destructive/15 text-destructive border-l-[3px] border-destructive",
    school_holiday: "bg-brand-amber/25 text-foreground border-l-[3px] border-brand-amber",
    hbl: "bg-primary/15 text-primary border-l-[3px] border-primary",
    no_class: "bg-muted text-ink-3 border-l-[3px] border-ink-5",
    event: "bg-accent text-brand-indigo-deep border-l-[3px] border-brand-indigo-soft",
  };
  return (
    <span
      className={`block truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-tight tracking-[0.02em] ${classByType[type]}`}
      title={label}>
      {label}
    </span>
  );
}

function MonthView({
  term,
  daysByType,
  events,
  multiSelect,
  selectedDates,
  onSelectDates,
  onDayClick,
}: {
  term: TermOption;
  daysByType: Record<DayType, Date[]> & { event: Date[] };
  events: CalendarEventRow[];
  multiSelect: boolean;
  selectedDates: Date[];
  onSelectDates: (next: Date[]) => void;
  onDayClick: (iso: string) => void;
}) {
  const termStart = parseIso(term.startDate);
  const termEnd = parseIso(term.endDate);

  // Cursor = first-of-month for the visible month. Starts at term-start month.
  const [cursor, setCursor] = useState<Date>(() => new Date(termStart.getFullYear(), termStart.getMonth(), 1));

  // Flatten daysByType into an iso → DayType map for O(1) lookup.
  const dayTypeByIso = useMemo(() => {
    const m = new Map<string, DayType>();
    (Object.keys(daysByType) as Array<keyof typeof daysByType>).forEach((key) => {
      if (key === "event") return;
      daysByType[key as DayType].forEach((d) => m.set(formatIso(d), key as DayType));
    });
    return m;
  }, [daysByType]);

  // Event rows grouped by ISO date. Multi-day events expand into one entry per
  // day they cover, so each cell can render its stack of event labels.
  const eventsByIso = useMemo(() => {
    const m = new Map<string, CalendarEventRow[]>();
    for (const e of events) {
      const start = parseIso(e.startDate);
      const end = parseIso(e.endDate);
      const d = new Date(start);
      while (d.getTime() <= end.getTime()) {
        const iso = formatIso(d);
        const arr = m.get(iso) ?? [];
        arr.push(e);
        m.set(iso, arr);
        d.setDate(d.getDate() + 1);
      }
    }
    return m;
  }, [events]);

  const selectedIsoSet = useMemo(() => new Set(selectedDates.map(formatIso)), [selectedDates]);

  const rows = useMemo(
    () => buildMonthWeekdayRows(cursor, termStart, termEnd, dayTypeByIso),
    [cursor, termStart, termEnd, dayTypeByIso],
  );

  // Nav — clamp prev/next to months that overlap the term range.
  const firstOfTermStart = new Date(termStart.getFullYear(), termStart.getMonth(), 1);
  const firstOfTermEnd = new Date(termEnd.getFullYear(), termEnd.getMonth(), 1);
  const canPrev = cursor.getTime() > firstOfTermStart.getTime();
  const canNext = cursor.getTime() < firstOfTermEnd.getTime();

  function goPrev() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  }
  function goNext() {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  }
  function goToday() {
    const t = new Date();
    setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
  }

  function toggleSelection(iso: string, d: Date) {
    if (selectedIsoSet.has(iso)) {
      onSelectDates(selectedDates.filter((x) => formatIso(x) !== iso));
    } else {
      onSelectDates([...selectedDates, d]);
    }
  }

  const monthLabel = cursor.toLocaleString("en-SG", { month: "long", year: "numeric" });

  const totalSchoolDays =
    daysByType.school_day.length +
    daysByType.public_holiday.length +
    daysByType.school_holiday.length +
    daysByType.hbl.length +
    daysByType.no_class.length;

  // Week-of-term — 1-indexed number of Monday-weeks from term start to today,
  // clamped to [1, 13].
  const now = new Date();
  const daysSinceStart = Math.max(0, Math.floor((now.getTime() - termStart.getTime()) / 86400000));
  const weekOfTerm = Math.min(13, Math.floor(daysSinceStart / 7) + 1);

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip — term label + week-of-term left, classified-count right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {term.label}
          <span className="mx-2 text-hairline-strong">·</span>
          Week <span className="tabular-nums">{weekOfTerm}</span> of 13
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="tabular-nums">{totalSchoolDays}</span> days classified
        </p>
      </div>

      {/* Month caption + nav */}
      <div className="flex items-end justify-between gap-3 border-b border-hairline px-6 pb-3 pt-5">
        <h2 className="font-serif text-[30px] font-semibold leading-none tracking-tight text-foreground">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="Previous month"
            className="flex size-8 items-center justify-center rounded-md border border-hairline bg-background text-ink-3 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-8 rounded-md border border-hairline bg-background px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-muted/40">
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            aria-label="Next month"
            className="flex size-8 items-center justify-center rounded-md border border-hairline bg-background text-ink-3 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Event-calendar grid — flush table-style, no gaps, thin hairlines
          between cells. Full-bleed under the card's rounded edges. */}
      <div className="border-t border-hairline">
        {/* Weekday header row */}
        <div className="grid grid-cols-5 bg-muted/30">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, idx) => (
            <div
              key={d}
              className={`px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4 ${
                idx < 4 ? "border-r border-hairline" : ""
              } border-b border-hairline`}>
              {d}
            </div>
          ))}
        </div>

        {/* Day rows */}
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-5">
            {row.map((cell, colIdx) => {
              const isSelected = selectedIsoSet.has(cell.iso);
              const dayEvents = eventsByIso.get(cell.iso) ?? [];
              const shortLabel = cell.dayType ? DAY_TYPE_SHORT_LABEL[cell.dayType] : null;
              const clickable = cell.inTermRange && !cell.outOfMonth;
              const isLastRow = rowIdx === rows.length - 1;
              const isLastCol = colIdx === 4;

              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (!clickable) return;
                    if (multiSelect) toggleSelection(cell.iso, cell.date);
                    else onDayClick(cell.iso);
                  }}
                  className={[
                    "relative flex min-h-[120px] flex-col gap-1.5 p-2 text-left align-top transition-colors",
                    !isLastCol && "border-r border-hairline",
                    !isLastRow && "border-b border-hairline",
                    cell.outOfMonth ? "bg-muted/20" : "bg-background",
                    isSelected && "bg-accent",
                    clickable && "cursor-pointer hover:bg-muted/40",
                    !clickable && "cursor-not-allowed",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={formatHumanDate(cell.iso)}>
                  {/* Date number — sans, top-left. Today = filled indigo circle. */}
                  <span
                    className={[
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums leading-none",
                      cell.isToday
                        ? "bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_1px_2px_rgba(15,23,42,0.1)]"
                        : cell.outOfMonth
                          ? "text-ink-5"
                          : "text-foreground",
                    ]
                      .filter(Boolean)
                      .join(" ")}>
                    {cell.date.getDate()}
                  </span>

                  {/* Stacked event bars */}
                  <div className="flex w-full flex-col gap-0.5">
                    {shortLabel && cell.dayType && (
                      <EventBar type={cell.dayType} label={shortLabel} />
                    )}
                    {dayEvents.slice(0, 3).map((evt) => (
                      <EventBar key={evt.id} type="event" label={evt.label} />
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Group every weekday within [termStart, termEnd] into rows keyed by
// Monday-starting week number. Each row is a 5-day Mon–Fri strip — weekends
// are excluded entirely (they're not school days).
type StripDay = {
  iso: string;
  date: Date;
  dayType: DayType | null;
  isEvent: boolean;
  isToday: boolean;
  isFirstOfMonth: boolean;
};
type StripWeek = { weekNumber: number; days: (StripDay | null)[] };

function buildStripWeeks(
  termStartIso: string,
  termEndIso: string,
  dayTypeByIso: Map<string, DayType>,
  eventIsos: Set<string>,
): StripWeek[] {
  const start = parseIso(termStartIso);
  const end = parseIso(termEndIso);

  // Align to the Monday of the week containing term start.
  const firstMonday = new Date(start);
  const startDow = start.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const shift = startDow === 0 ? -6 : 1 - startDow; // Mon → 0, Tue → -1, Sun → -6
  firstMonday.setDate(start.getDate() + shift);

  const weeks: StripWeek[] = [];
  const todayIso = formatIso(new Date());
  const weekStart = new Date(firstMonday);
  let weekNumber = 1;

  while (weekStart.getTime() <= end.getTime()) {
    const days: (StripDay | null)[] = [];
    for (let i = 0; i < 5; i++) {
      // Mon..Fri only
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = formatIso(d);
      const inRange = d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
      if (!inRange) {
        days.push(null);
      } else {
        days.push({
          iso,
          date: new Date(d),
          dayType: dayTypeByIso.get(iso) ?? null,
          isEvent: eventIsos.has(iso),
          isToday: iso === todayIso,
          isFirstOfMonth: d.getDate() === 1,
        });
      }
    }
    weeks.push({ weekNumber, days });
    weekNumber++;
    weekStart.setDate(weekStart.getDate() + 7);
  }
  return weeks;
}

function TermStripView({
  term,
  daysByType,
  multiSelect,
  selectedDates,
  onSelectDates,
  onDayClick,
}: {
  term: TermOption;
  daysByType: Record<DayType, Date[]> & { event: Date[] };
  multiSelect: boolean;
  selectedDates: Date[];
  onSelectDates: (next: Date[]) => void;
  onDayClick: (iso: string) => void;
}) {
  // Flatten daysByType into an iso→dayType map for O(1) lookup per cell.
  const dayTypeByIso = useMemo(() => {
    const m = new Map<string, DayType>();
    (Object.keys(daysByType) as Array<keyof typeof daysByType>).forEach((key) => {
      if (key === "event") return;
      daysByType[key as DayType].forEach((d) => m.set(formatIso(d), key as DayType));
    });
    return m;
  }, [daysByType]);

  const eventIsoSet = useMemo(() => {
    const s = new Set<string>();
    daysByType.event.forEach((d) => s.add(formatIso(d)));
    return s;
  }, [daysByType]);

  const weeks = useMemo(
    () => buildStripWeeks(term.startDate, term.endDate, dayTypeByIso, eventIsoSet),
    [term.startDate, term.endDate, dayTypeByIso, eventIsoSet],
  );

  const selectedIsoSet = useMemo(() => new Set(selectedDates.map(formatIso)), [selectedDates]);

  function toggleSelection(iso: string, d: Date) {
    if (selectedIsoSet.has(iso)) {
      onSelectDates(selectedDates.filter((x) => formatIso(x) !== iso));
    } else {
      onSelectDates([...selectedDates, d]);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Full term
          <span className="mx-2 text-hairline-strong">·</span>
          <span className="tabular-nums">{weeks.length}</span> weeks
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Switch → Month to drill down
        </p>
      </div>
      {/* Term grid */}
      <div className="p-6 md:p-8">
        <div className="mb-3 flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-serif text-[24px] font-semibold tracking-tight text-foreground">
            {term.label} <span className="mx-2 text-hairline-strong">·</span>{" "}
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
              {term.startDate} → {term.endDate}
            </span>
          </h3>
        </div>
        {/* Weekday header (Mon–Fri only) */}
        <div className="mb-1 grid grid-cols-[56px_repeat(5,1fr)] gap-1">
          <div />
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
            <div
              key={d}
              className="rounded-md bg-muted/40 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
              {d}
            </div>
          ))}
        </div>
        {/* Weeks */}
        <div className="space-y-1">
          {weeks.map((wk) => (
            <div key={wk.weekNumber} className="grid grid-cols-[56px_repeat(5,1fr)] gap-1">
              <div className="flex items-center justify-center rounded-md bg-muted/40 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                W{wk.weekNumber}
              </div>
              {wk.days.map((d, idx) => {
                if (!d) {
                  // Leading / trailing days outside term range — render a
                  // subtle placeholder so the grid shape stays visible.
                  return (
                    <div
                      key={idx}
                      className="aspect-[1.2/1] rounded-md border border-hairline/40 bg-muted/20 opacity-50"
                    />
                  );
                }
                const tintClass = d.dayType
                  ? DAY_TYPE_STYLES[d.dayType].cell
                  : "bg-background shadow-[inset_0_0_0_1px_var(--av-hairline)]";
                const isSelected = selectedIsoSet.has(d.iso);
                const todayClass = d.isToday ? "shadow-[inset_0_0_0_2px_var(--av-indigo)]" : "";
                const selectedClass = isSelected
                  ? "scale-[0.98] ring-2 ring-brand-indigo/40 ring-offset-1 ring-offset-card"
                  : "";

                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => {
                      if (multiSelect) toggleSelection(d.iso, d.date);
                      else onDayClick(d.iso);
                    }}
                    className={[
                      "relative aspect-[1.2/1] cursor-pointer rounded-md p-1 text-left font-serif text-[13px] font-semibold tabular-nums leading-none transition-all hover:-translate-y-0.5 hover:shadow-md",
                      tintClass,
                      todayClass,
                      selectedClass,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={formatHumanDate(d.iso)}>
                    <span>{d.date.getDate()}</span>
                    {d.isEvent && (
                      <span
                        aria-hidden
                        className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type InputMode = "view" | "event";

function DateActionDialog({
  open,
  iso,
  currentDayType,
  existingLabel,
  eventsOnDate,
  busy,
  onClose,
  onSaveDayType,
  onAddImportantDate,
}: {
  open: boolean;
  iso: string | null;
  currentDayType: DayType;
  existingLabel: string | null;
  eventsOnDate: CalendarEventRow[];
  busy: boolean;
  onClose: () => void;
  onSaveDayType: (iso: string, dayType: DayType, label: string | null) => Promise<void>;
  onAddImportantDate: (iso: string, label: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<InputMode>("view");
  const [pickedType, setPickedType] = useState<DayType>(currentDayType);
  const [labelInput, setLabelInput] = useState(existingLabel ?? "");
  const [eventLabelInput, setEventLabelInput] = useState("");

  // Reset local state when the dialog opens for a new date.
  const key = `${iso}-${currentDayType}-${existingLabel ?? ""}`;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (open && initKey !== key) {
    setInitKey(key);
    setMode("view");
    setPickedType(currentDayType);
    setLabelInput(existingLabel ?? "");
    setEventLabelInput("");
  }
  if (!open && initKey !== null) setInitKey(null);

  if (!iso) return null;

  const dirty = pickedType !== currentDayType || labelInput.trim() !== (existingLabel ?? "").trim();

  async function saveDayType() {
    if (!iso) return;
    const label = labelInput.trim();
    // For encodable types an empty label is fine; for holidays default to the
    // type label so the attendance sheet header always reads something.
    const resolvedLabel =
      label.length > 0 ? label : isEncodableDayType(pickedType) ? null : DAY_TYPE_LABELS[pickedType];
    try {
      await onSaveDayType(iso, pickedType, resolvedLabel);
    } catch {
      // toast raised by parent
    }
  }

  async function saveImportantDate() {
    if (!iso) return;
    const label = eventLabelInput.trim();
    if (!label) {
      toast.error("Label is required");
      return;
    }
    try {
      await onAddImportantDate(iso, label);
    } catch {
      // toast raised by parent
    }
  }

  const statusBadgeClass = DAY_TYPE_STYLES[currentDayType].chip;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${statusBadgeClass}`}>
              {DAY_TYPE_LABELS[currentDayType]}
            </span>
            {existingLabel && <span className="text-sm font-medium text-foreground">· {existingLabel}</span>}
          </div>
          <DialogTitle className="font-serif text-[18px] font-semibold tracking-tight">
            {formatHumanDate(iso)}
          </DialogTitle>
          <DialogDescription>
            Pick a day-type to classify this date. Encodable types (school day, HBL) accept attendance writes; the
            others reject them and grey the column out on the attendance grid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {eventsOnDate.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Overlapping important dates
              </div>
              <div className="flex flex-wrap gap-1.5">
                {eventsOnDate.map((e) => (
                  <Badge key={e.id} variant="outline" className="text-[11px]">
                    <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary" />
                    {e.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {mode === "view" && (
            <>
              <fieldset className="space-y-2">
                <legend className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Day type
                </legend>
                <div className="grid gap-2">
                  {DAY_TYPE_VALUES.map((dt) => {
                    const style = DAY_TYPE_STYLES[dt];
                    const selected = pickedType === dt;
                    return (
                      <label
                        key={dt}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                          selected
                            ? "border-primary/40 ring-2 ring-primary/20"
                            : "border-border hover:border-primary/30"
                        }`}>
                        <input
                          type="radio"
                          name="dayType"
                          value={dt}
                          checked={selected}
                          onChange={() => setPickedType(dt)}
                          className="mt-1 size-4 cursor-pointer accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] ${style.chip}`}>
                              {DAY_TYPE_LABELS[dt]}
                            </span>
                            {isEncodableDayType(dt) && (
                              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                                encodable
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{style.blurb}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="dlgDayLabel">
                  Label{" "}
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">
                    (optional for school day; required-ish for closures)
                  </span>
                </Label>
                <Input
                  id="dlgDayLabel"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && dirty) {
                      e.preventDefault();
                      saveDayType();
                    }
                  }}
                  placeholder={
                    isEncodableDayType(pickedType) ? "e.g. Half-day: early dismissal" : "e.g. CNY Day 1, Staff Dev Day"
                  }
                />
                <p className="text-[11px] text-muted-foreground">Shown on the attendance sheet header for this date.</p>
              </div>
            </>
          )}

          {mode === "event" && (
            <div className="space-y-2">
              <Label htmlFor="dlgEventLabel">Important date label</Label>
              <Input
                id="dlgEventLabel"
                autoFocus
                value={eventLabelInput}
                onChange={(e) => setEventLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveImportantDate();
                  }
                  if (e.key === "Escape") setMode("view");
                }}
                placeholder="e.g. School Photos, Parent-Teacher Conference"
              />
              <p className="text-[11px] text-muted-foreground">
                Overlays a dot on the grid for this date. Does not affect attendance.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {mode === "view" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setMode("event")}
                className="gap-1.5 text-muted-foreground">
                <CalendarPlus className="size-3.5" />
                Set as important date
              </Button>
              <Button type="button" size="sm" disabled={busy || !dirty} onClick={saveDayType} className="gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarOff className="size-3.5" />}
                Save day type
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={saveImportantDate}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEventDialog({
  open,
  termId,
  termStart,
  termEnd,
  onClose,
  onCreated,
}: {
  open: boolean;
  termId: string;
  termStart: string;
  termEnd: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [start, setStart] = useState(termStart);
  const [end, setEnd] = useState(termEnd);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens for a new term.
  const key = `${termId}-${termStart}-${termEnd}`;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (open && initKey !== key) {
    setInitKey(key);
    setStart(termStart);
    setEnd(termEnd);
    setLabel("");
  }
  if (!open && initKey !== null) setInitKey(null);

  async function create() {
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (end < start) {
      toast.error("End date must be on or after start date");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/attendance/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId, startDate: start, endDate: end, label: label.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "create failed");
      toast.success("Important date added");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[18px] font-semibold tracking-tight">
            Add an important date
          </DialogTitle>
          <DialogDescription>
            Overlays a label on matching dates in the month view and the attendance sheet. Does not block attendance —
            the underlying school days remain encodable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="addEventStart">Start</Label>
              <DatePicker value={start} onChange={setStart} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addEventEnd">End</Label>
              <DatePicker value={end} onChange={setEnd} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addEventLabel">Label</Label>
            <Input
              id="addEventLabel"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Mathematics Week, Assessment Week"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={create}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventsPanel({
  events,
  busy,
  onDelete,
}: {
  events: CalendarEventRow[];
  busy: boolean;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Important dates
        </div>
        <p className="text-[12px] text-muted-foreground">
          Overlay labels on the grid. Does not affect whether a day is encodable.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-[12px] text-muted-foreground">
          No important dates yet. Use <strong>Add important date</strong> to label a span like &ldquo;Math Week&rdquo;.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="font-serif text-[14px] font-semibold text-foreground">
                  <span className="mr-2 inline-block size-1.5 rounded-full bg-primary align-middle" />
                  {e.label}
                </div>
                <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {e.startDate} → {e.endDate}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDelete(e.id)}
                className="gap-1">
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Groups a sorted list of ISO dates into contiguous runs for a compact
// preview ("Feb 3–5 · Feb 8 · Feb 10–14"). Non-adjacent dates are single
// entries; adjacent dates collapse.
function summariseDates(dates: Date[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  type Run = { start: Date; end: Date };
  const runs: Run[] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last) {
      const lastPlusOne = new Date(last.end);
      lastPlusOne.setDate(lastPlusOne.getDate() + 1);
      if (formatIso(lastPlusOne) === formatIso(d)) {
        last.end = d;
        continue;
      }
    }
    runs.push({ start: d, end: d });
  }
  const fmtShort = (d: Date) => d.toLocaleDateString("en-SG", { month: "short", day: "numeric" });
  return runs
    .map((r) =>
      formatIso(r.start) === formatIso(r.end) ? fmtShort(r.start) : `${fmtShort(r.start)}–${r.end.getDate()}`,
    )
    .join(" · ");
}

function BulkDayTypeDialog({
  open,
  selectedDates,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  selectedDates: Date[];
  busy: boolean;
  onClose: () => void;
  onSave: (dates: Date[], dayType: DayType, label: string | null) => Promise<void>;
}) {
  const [pickedType, setPickedType] = useState<DayType>("public_holiday");
  const [labelInput, setLabelInput] = useState("");

  // Reset on dialog open so the next use doesn't inherit a stale label.
  const key = `${open ? "open" : "closed"}-${selectedDates.length}`;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (open && initKey !== key) {
    setInitKey(key);
    setPickedType("public_holiday");
    setLabelInput("");
  }
  if (!open && initKey !== null) setInitKey(null);

  async function save() {
    const label = labelInput.trim();
    const resolved = label.length > 0 ? label : isEncodableDayType(pickedType) ? null : DAY_TYPE_LABELS[pickedType];
    await onSave(selectedDates, pickedType, resolved);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[18px] font-semibold tracking-tight">
            Apply day-type to {selectedDates.length} date
            {selectedDates.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            All selected dates get overwritten with the picked day-type. Existing labels on those dates are replaced by
            the single label below (blank = use the type default).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {selectedDates.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Selection
              </div>
              <p className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] leading-snug tabular-nums text-foreground">
                {summariseDates(selectedDates)}
              </p>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Day type
            </legend>
            <div className="grid gap-2">
              {DAY_TYPE_VALUES.map((dt) => {
                const style = DAY_TYPE_STYLES[dt];
                const selected = pickedType === dt;
                return (
                  <label
                    key={dt}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      selected ? "border-primary/40 ring-2 ring-primary/20" : "border-border hover:border-primary/30"
                    }`}>
                    <input
                      type="radio"
                      name="bulkDayType"
                      value={dt}
                      checked={selected}
                      onChange={() => setPickedType(dt)}
                      className="mt-1 size-4 cursor-pointer accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] ${style.chip}`}>
                          {DAY_TYPE_LABELS[dt]}
                        </span>
                        {isEncodableDayType(dt) && (
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                            encodable
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{style.blurb}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="bulkDayLabel">
              Label{" "}
              <span className="font-mono text-[10px] font-normal text-muted-foreground">
                (applied to every selected date)
              </span>
            </Label>
            <Input
              id="bulkDayLabel"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder={isEncodableDayType(pickedType) ? "e.g. Early dismissal week" : "e.g. CNY Block, Term break"}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || selectedDates.length === 0}
            onClick={save}
            className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarOff className="size-3.5" />}
            Apply to {selectedDates.length} date{selectedDates.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
