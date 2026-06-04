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
import {
  AUDIENCE_LABELS,
  AUDIENCE_VALUES,
  type Audience,
} from '@/lib/schemas/attendance';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DayActionSheetProps {
  iso: string | null;
  termId: string;
  /** The clicked date's school_calendar row per audience (null = no override). */
  rowsByAudience: Record<Audience, SchoolCalendarRow | null>;
  /** Level pre-selected when the sheet opens (the page audience filter). */
  defaultLevel: Audience;
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

/** Short human label for a day status, used in the per-level summary. */
function statusLabel(s: DayStatus): string {
  if (s.kind === 'open') return s.hbl ? 'Open · HBL' : 'Open';
  if (s.reason === 'school_holiday') {
    return s.hblOverlay
      ? 'Closed · School holiday (HBL)'
      : 'Closed · School holiday';
  }
  return `Closed · ${CLOSED_REASON_LABELS[s.reason]}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DayActionSheet({
  iso,
  termId,
  rowsByAudience,
  defaultLevel,
  events,
  editable,
  onClose,
  onSaved,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
}: DayActionSheetProps) {
  // Effective row for a level: its own override, else (for non-'all') the All
  // baseline it inherits. 'all' has no fallback.
  const effectiveRow = (level: Audience): SchoolCalendarRow | null =>
    rowsByAudience[level] ?? (level !== 'all' ? rowsByAudience.all : null);
  /** Does this level carry its OWN override (vs inheriting All)? */
  const hasOwnOverride = (level: Audience): boolean =>
    level !== 'all' && rowsByAudience[level] != null;

  const [selectedLevel, setSelectedLevel] = useState<Audience>(defaultLevel);
  const [status, setStatus] = useState<DayStatus>(() =>
    initialStatus(effectiveRow(defaultLevel))
  );
  const [busy, setBusy] = useState(false);

  // Re-initialise when the sheet opens for a new day: reset the level to the
  // page default and the status to that level's effective row. rowsByAudience
  // already reflects the new iso (resolved by the parent).
  const [lastIso, setLastIso] = useState<string | null>(iso);
  if (iso !== lastIso) {
    setLastIso(iso);
    setSelectedLevel(defaultLevel);
    setStatus(initialStatus(effectiveRow(defaultLevel)));
    setBusy(false);
  }

  // Switching level shows that level's effective status (own or inherited).
  function handleLevelChange(level: Audience) {
    setSelectedLevel(level);
    setStatus(initialStatus(effectiveRow(level)));
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
          // Writes to the selected level — creating a per-level override when
          // it's Primary/Secondary, or the baseline when it's All.
          audience: selectedLevel,
          // Preserve any existing label on THIS level's own row — the upsert
          // writes the full row, so omitting label would clobber it to null.
          entries: [
            {
              date: iso,
              dayType,
              label: rowsByAudience[selectedLevel]?.label ?? null,
              hblOverlay,
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? `Server error ${res.status}`
        );
      }
      toast.success(
        selectedLevel === 'all'
          ? 'Day saved'
          : `${AUDIENCE_LABELS[selectedLevel]} override saved`
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save day');
    } finally {
      setBusy(false);
    }
  }

  // Remove a Primary/Secondary override so the level falls back to the All
  // baseline (DELETE the level-specific row).
  async function handleResetToAll() {
    if (!iso || selectedLevel === 'all') return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        termId,
        date: iso,
        audience: selectedLevel,
      });
      const res = await fetch(`/api/attendance/calendar?${params.toString()}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Server error ${res.status}`
        );
      }
      toast.success(
        `${AUDIENCE_LABELS[selectedLevel]} now follows the All baseline`
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset');
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
              {/* Level switcher + per-level summary — a date can differ by
                  level (e.g. HBL for Primary, open for Secondary). */}
              <section className="space-y-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Level
                </p>
                <div className="inline-flex w-full rounded-lg border border-border bg-muted/40 p-0.5">
                  {AUDIENCE_VALUES.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => handleLevelChange(lvl)}
                      className={[
                        'flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors',
                        selectedLevel === lvl
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      ].join(' ')}
                    >
                      {AUDIENCE_LABELS[lvl]}
                    </button>
                  ))}
                </div>

                {/* Effective status for each level (own override, else All). */}
                <div className="space-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  {AUDIENCE_VALUES.map((lvl) => (
                    <div
                      key={lvl}
                      className="flex items-center justify-between gap-3 text-[12px]"
                    >
                      <span className="text-muted-foreground">
                        {AUDIENCE_LABELS[lvl]}
                      </span>
                      <span className="font-medium text-foreground">
                        {statusLabel(initialStatus(effectiveRow(lvl)))}
                        {lvl !== 'all' && !hasOwnOverride(lvl) && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            (inherits All)
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {selectedLevel !== 'all' && !hasOwnOverride(selectedLevel) && (
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {AUDIENCE_LABELS[selectedLevel]} inherits the All baseline.
                    Saving below creates a {AUDIENCE_LABELS[selectedLevel]}
                    -specific override.
                  </p>
                )}
              </section>

              <Separator />

              {/* Day status section — edits the SELECTED level */}
              <section className="space-y-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {selectedLevel === 'all'
                    ? 'Day status'
                    : `Day status · ${AUDIENCE_LABELS[selectedLevel]}`}
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
          <div className="flex flex-col gap-2 border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={handleSave}
            >
              {busy
                ? 'Saving…'
                : selectedLevel === 'all'
                  ? 'Save'
                  : `Save ${AUDIENCE_LABELS[selectedLevel]} override`}
            </Button>
            {hasOwnOverride(selectedLevel) && (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={busy}
                onClick={handleResetToAll}
              >
                Reset {AUDIENCE_LABELS[selectedLevel]} to the All baseline
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
