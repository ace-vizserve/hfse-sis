"use client";

import { CalendarRange, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { CalendarEventRow, SchoolCalendarRow } from "@/lib/attendance/calendar";
import {
  AUDIENCE_LABELS,
  EVENT_CATEGORY_LABELS,
  type Audience,
  type DayType,
  type EventCategory,
} from "@/lib/schemas/attendance";

// "Copy from prior AY" dialog. Shows a prior-AY's school_calendar
// overrides (non-school_day rows) AND calendar_events with the new
// category + audience fields, grouped by month/list. On commit, POSTs
// them to the current target term with month+day preserved (year shifted
// to the target-term year), and every copied row defaults to
// tentative=true so the registrar reviews each before locking.
//
// Replaces the legacy single-purpose CopyHolidaysDialog. KD #50 holiday
// carry-forward semantics preserved; new scope per migration 037 covers
// every override + every typed event.

export type CopyFromPriorAyProps = {
  targetTermId: string;
  targetTermLabel: string;
  targetYear: number;
  sourceAyCode: string;
  sourceHolidays: SchoolCalendarRow[];
  sourceEvents: CalendarEventRow[];
};

function shiftIso(iso: string, targetYear: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  let day = Number(m[3]);
  if (m[2] === "02" && day === 29) {
    const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
    if (!isLeap) day = 28;
  }
  return `${targetYear}-${m[2]}-${String(day).padStart(2, "0")}`;
}

export function CopyFromPriorAyDialog({
  targetTermId,
  targetTermLabel,
  targetYear,
  sourceAyCode,
  sourceHolidays,
  sourceEvents,
}: CopyFromPriorAyProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default every row checked. Tentative defaults true (per Q4 lock —
  // registrar reviews + un-flags). Toggleable batch-wide.
  const [holidaySelection, setHolidaySelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sourceHolidays.map((h) => [h.id, true])),
  );
  const [eventSelection, setEventSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sourceEvents.map((e) => [e.id, true])),
  );
  const [markTentative, setMarkTentative] = useState(true);

  const holidayRows = useMemo(() => {
    return sourceHolidays.map((h) => ({
      source: h,
      targetDate: shiftIso(h.date, targetYear),
    }));
  }, [sourceHolidays, targetYear]);

  const eventRows = useMemo(() => {
    return sourceEvents.map((e) => ({
      source: e,
      targetStart: shiftIso(e.startDate, targetYear),
      targetEnd: shiftIso(e.endDate, targetYear),
    }));
  }, [sourceEvents, targetYear]);

  // Group holidays by source month for readability.
  const groupedHolidays = useMemo(() => {
    const map = new Map<string, typeof holidayRows>();
    for (const r of holidayRows) {
      const key = r.source.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
    return entries.map(([ym, list]) => {
      const [y, m] = ym.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-SG", {
        month: "long",
        year: "numeric",
      });
      return { ym, label, list };
    });
  }, [holidayRows]);

  const holidaySelectedCount = Object.values(holidaySelection).filter(Boolean).length;
  const eventSelectedCount = Object.values(eventSelection).filter(Boolean).length;
  const totalSelected = holidaySelectedCount + eventSelectedCount;
  const totalAvailable = sourceHolidays.length + sourceEvents.length;

  function toggleHoliday(id: string) {
    setHolidaySelection((s) => ({ ...s, [id]: !s[id] }));
  }
  function toggleEvent(id: string) {
    setEventSelection((s) => ({ ...s, [id]: !s[id] }));
  }
  function setAll(v: boolean) {
    setHolidaySelection(Object.fromEntries(sourceHolidays.map((h) => [h.id, v])));
    setEventSelection(Object.fromEntries(sourceEvents.map((e) => [e.id, v])));
  }

  async function commit() {
    const dayTypeRows = holidayRows
      .filter((r) => r.targetDate && holidaySelection[r.source.id])
      .map((r) => ({
        date: r.targetDate!,
        dayType: r.source.dayType as DayType,
        audience: r.source.audience as Audience,
        label: r.source.label ?? r.source.dayType,
      }));
    const events = eventRows
      .filter((r) => r.targetStart && r.targetEnd && eventSelection[r.source.id])
      .map((r) => ({
        startDate: r.targetStart!,
        endDate: r.targetEnd!,
        label: r.source.label,
        category: r.source.category as EventCategory,
        audience: r.source.audience as Audience,
      }));

    if (dayTypeRows.length === 0 && events.length === 0) {
      toast.info("Nothing selected — nothing carried over.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/attendance/calendar/copy-from-prior-ay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetTermId,
          dayTypeRows,
          events,
          markTentative,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "save failed");
      const total = (body?.dayTypeRowsCopied ?? 0) + (body?.eventsCopied ?? 0);
      toast.success(
        `Copied ${total} entr${total === 1 ? "y" : "ies"} to ${targetTermLabel}. ${
          markTentative ? "Each row is marked tentative — review the dates before locking." : ""
        }`.trim(),
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (sourceHolidays.length === 0 && sourceEvents.length === 0) {
    return (
      <Button
        type="button"
        size="sm"
        disabled
        className="gap-1.5"
        title={`${sourceAyCode} has no calendar overrides or events on this term — nothing to carry forward.`}>
        <CalendarRange className="size-3.5" />
        Copy from {sourceAyCode}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="size-3.5" />
          Copy from {sourceAyCode}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" />
            Copy from prior AY
          </DialogTitle>
          <DialogDescription>
            Carrying entries from <strong>{sourceAyCode}</strong> into <strong>{targetTermLabel}</strong> (year {targetYear}).
            Month and day are preserved; the year is shifted to {targetYear}. Fixed-date holidays (National Day,
            Christmas) land correctly. Moveable ones (CNY, Good Friday, Hari Raya) and any school events will need
            manual adjustment — review before committing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 px-0 py-2">
          <div className="font-mono text-[11px] text-muted-foreground">
            {totalSelected} of {totalAvailable} selected
          </div>
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
              Deselect all
            </Button>
          </div>
        </div>

        <Tabs defaultValue="overrides" className="w-full">
          <TabsList variant="default">
            <TabsTrigger value="overrides">
              Day-type overrides ({holidaySelectedCount}/{sourceHolidays.length})
            </TabsTrigger>
            <TabsTrigger value="events">
              Events ({eventSelectedCount}/{sourceEvents.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overrides" className="mt-3">
            {sourceHolidays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-[12px] text-muted-foreground">
                No day-type overrides on the prior term — nothing to carry.
              </div>
            ) : (
              <ScrollArea className="h-[300px] rounded-xl border border-border">
                {groupedHolidays.map(({ ym, label, list }) => (
                  <div key={ym}>
                    <div className="sticky top-0 z-10 border-b border-border bg-muted/60 px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {label}
                    </div>
                    {list.map((r) => {
                      const checked = !!holidaySelection[r.source.id];
                      const sameDay = r.targetDate && r.source.date.slice(5) === r.targetDate.slice(5);
                      return (
                        <label
                          key={r.source.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-muted/30">
                          <Checkbox checked={checked} onCheckedChange={() => toggleHoliday(r.source.id)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-medium text-foreground">
                              <span className="truncate">{r.source.label ?? r.source.dayType}</span>
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {r.source.dayType}
                              </Badge>
                              {r.source.audience !== "all" && (
                                <Badge variant="secondary" className="shrink-0 text-[10px]">
                                  {AUDIENCE_LABELS[r.source.audience]}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                              <span>{r.source.date}</span>
                              <span className="text-border">→</span>
                              <span className={sameDay ? "text-foreground" : "text-amber-700 dark:text-amber-200"}>
                                {r.targetDate ?? "(bad date)"}
                              </span>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-3">
            {sourceEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-[12px] text-muted-foreground">
                No events on the prior term — nothing to carry.
              </div>
            ) : (
              <ScrollArea className="h-[300px] rounded-xl border border-border">
                {eventRows.map((r) => {
                  const checked = !!eventSelection[r.source.id];
                  return (
                    <label
                      key={r.source.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-muted/30">
                      <Checkbox checked={checked} onCheckedChange={() => toggleEvent(r.source.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <span className="truncate">{r.source.label}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {EVENT_CATEGORY_LABELS[r.source.category]}
                          </Badge>
                          {r.source.audience !== "all" && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {AUDIENCE_LABELS[r.source.audience]}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                          <span>
                            {r.source.startDate}
                            {r.source.endDate !== r.source.startDate && ` → ${r.source.endDate}`}
                          </span>
                          <span className="text-border">→</span>
                          <span className="text-amber-700 dark:text-amber-200">
                            {r.targetStart}
                            {r.targetEnd !== r.targetStart && ` → ${r.targetEnd}`}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <Checkbox
            checked={markTentative}
            onCheckedChange={(v) => setMarkTentative(Boolean(v))}
          />
          <div className="flex-1">
            <div className="font-medium text-foreground">Mark every copied row as Tentative</div>
            <p className="text-[11px] text-muted-foreground">
              Recommended — review each entry before locking. Tentative rows render with a dashed border in the
              calendar grid until you confirm them.
            </p>
          </div>
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={saving || totalSelected === 0} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {saving ? "Copying…" : `Copy ${totalSelected} entr${totalSelected === 1 ? "y" : "ies"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
