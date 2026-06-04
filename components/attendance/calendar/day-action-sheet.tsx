'use client';

import { Calendar, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  CLOSED_REASON_LABELS,
  dayStatusToStorage,
  storageToDayStatus,
  type ClosedReason,
  type DayStatus,
} from '@/lib/attendance/calendar-operational';
import type { Audience } from '@/lib/schemas/attendance';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DayActionSheetProps {
  iso: string | null;
  termId: string;
  audience: Audience;
  row: SchoolCalendarRow | null;
  events: CalendarEventRow[];
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
  onAddEvent: (iso: string) => void;
  onEditEvent: (e: CalendarEventRow) => void;
  onDeleteEvent: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a yyyy-MM-dd string as a readable date, e.g. "Wednesday, 4 June 2026". */
function formatIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  // Construct date as local calendar date (no UTC shift)
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function initialStatus(row: SchoolCalendarRow | null): DayStatus {
  if (!row) return { kind: 'open', hbl: false };
  return storageToDayStatus({
    dayType: row.dayType,
    hblOverlay: row.hblOverlay,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DayActionSheet({
  iso,
  termId,
  audience,
  row,
  events,
  editable,
  onClose,
  onSaved,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
}: DayActionSheetProps) {
  const [status, setStatus] = useState<DayStatus>(() => initialStatus(row));
  const [busy, setBusy] = useState(false);

  // Re-initialise local state whenever the sheet opens for a new day.
  // Using a key on the content would remount the whole tree — instead we
  // derive on every render but only "write" when iso changes.
  const derivedStatus = initialStatus(row);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [lastIso, setLastIso] = useState<string | null>(iso);
  if (iso !== lastIso) {
    setLastIso(iso);
    setStatus(derivedStatus);
    setBusy(false);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleKindChange(value: string) {
    if (value === 'open') {
      setStatus({ kind: 'open', hbl: false });
    } else {
      // Default to public_holiday when switching to closed
      setStatus({ kind: 'closed', reason: 'public_holiday' });
    }
  }

  function handleOpenHblChange(checked: boolean | 'indeterminate') {
    setStatus({ kind: 'open', hbl: checked === true });
  }

  function handleReasonChange(value: string) {
    const r = value as ClosedReason;
    if (r === 'school_holiday') {
      setStatus({
        kind: 'closed',
        reason: 'school_holiday',
        hblOverlay: false,
      });
    } else {
      setStatus({ kind: 'closed', reason: r });
    }
  }

  function handleSchoolHolidayHblChange(checked: boolean | 'indeterminate') {
    // Guard: only call when current status is school_holiday closed
    if (status.kind === 'closed' && status.reason === 'school_holiday') {
      setStatus({
        kind: 'closed',
        reason: 'school_holiday',
        hblOverlay: checked === true,
      });
    }
  }

  async function handleSave() {
    if (!iso) return;
    setBusy(true);
    try {
      const { dayType, hblOverlay } = dayStatusToStorage(status);
      const res = await fetch('/api/attendance/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termId,
          audience,
          // Preserve any existing label — the upsert writes the full row, so
          // omitting label would clobber it to null. Day status is edited here;
          // labelling a day is done via events, not this sheet.
          entries: [
            { date: iso, dayType, label: row?.label ?? null, hblOverlay },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? `Server error ${res.status}`
        );
      }
      toast.success('Day saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save day');
    } finally {
      setBusy(false);
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const isClosed = status.kind === 'closed';
  const currentReason: ClosedReason | undefined = isClosed
    ? (status as Extract<DayStatus, { kind: 'closed' }>).reason
    : undefined;
  const isSchoolHolidayClosed =
    status.kind === 'closed' && status.reason === 'school_holiday';
  const schoolHolidayHblOverlay = isSchoolHolidayClosed
    ? (
        status as Extract<
          DayStatus,
          { kind: 'closed'; reason: 'school_holiday' }
        >
      ).hblOverlay
    : false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Sheet open={iso !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border px-6 pb-5 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Calendar className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 pt-0.5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                School calendar
              </p>
              <SheetTitle className="leading-snug">
                {iso ? formatIso(iso) : '—'}
              </SheetTitle>
            </div>
          </div>
        </SheetHeader>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {!editable ? (
            /* Between-term break — read-only note */
            <div className="rounded-xl border border-border bg-muted/40 p-5">
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                This date falls in a term break — it has no school day to
                configure. Add a labelled break via an event on the adjacent
                term days.
              </p>
            </div>
          ) : (
            <>
              {/* Day status section */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Day status
                </p>

                <RadioGroup
                  value={isClosed ? 'closed' : 'open'}
                  onValueChange={handleKindChange}
                  className="gap-3"
                >
                  {/* Open */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-accent/60">
                    <RadioGroupItem
                      value="open"
                      id="kind-open"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="space-y-1">
                      <span className="text-[13px] font-medium text-foreground">
                        Open
                      </span>
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        School in session — attendance is taken.
                      </p>
                      {/* HBL sub-option — only when Open is selected */}
                      {!isClosed && (
                        <div className="mt-3 flex items-center gap-2.5">
                          <Checkbox
                            id="open-hbl"
                            checked={
                              status.kind === 'open' ? status.hbl : false
                            }
                            onCheckedChange={handleOpenHblChange}
                          />
                          <Label
                            htmlFor="open-hbl"
                            className="text-[13px] font-normal text-foreground cursor-pointer"
                          >
                            HBL (taught remotely)
                          </Label>
                        </div>
                      )}
                    </div>
                  </label>

                  {/* Closed */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-accent/60">
                    <RadioGroupItem
                      value="closed"
                      id="kind-closed"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="w-full space-y-1">
                      <span className="text-[13px] font-medium text-foreground">
                        Closed
                      </span>
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        No school — no attendance taken.
                      </p>

                      {/* Reason + HBL overlay — only when Closed is selected */}
                      {isClosed && (
                        <div className="mt-3 space-y-3">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="closed-reason"
                              className="text-[12px] text-muted-foreground"
                            >
                              Reason
                            </Label>
                            <Select
                              value={currentReason}
                              onValueChange={handleReasonChange}
                            >
                              <SelectTrigger
                                id="closed-reason"
                                className="h-9 text-sm"
                              >
                                <SelectValue placeholder="Select reason…" />
                              </SelectTrigger>
                              <SelectContent>
                                {(
                                  Object.entries(CLOSED_REASON_LABELS) as [
                                    ClosedReason,
                                    string,
                                  ][]
                                ).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* School holiday HBL overlay */}
                          {isSchoolHolidayClosed && (
                            <div className="flex items-center gap-2.5">
                              <Checkbox
                                id="school-holiday-hbl"
                                checked={schoolHolidayHblOverlay}
                                onCheckedChange={handleSchoolHolidayHblChange}
                              />
                              <Label
                                htmlFor="school-holiday-hbl"
                                className="text-[13px] font-normal text-foreground cursor-pointer"
                              >
                                Attendance still taken (HBL overlay)
                              </Label>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </label>
                </RadioGroup>
              </section>

              <Separator />
            </>
          )}

          {/* Events section — always visible */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Events on this day
              </p>
              {iso && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-[12px]"
                  onClick={() => onAddEvent(iso)}
                >
                  <span aria-hidden>+</span>
                  Add event
                </Button>
              )}
            </div>

            {events.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No events on this day.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="text-[13px] font-medium text-foreground leading-snug min-w-0 truncate">
                      {e.label}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Edit event: ${e.label}`}
                        onClick={() => onEditEvent(e)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`Delete event: ${e.label}`}
                        onClick={() => onDeleteEvent(e.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer — pinned, only when editable */}
        {editable && (
          <div className="border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={handleSave}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
