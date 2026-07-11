'use client';

// DayActionSheet — "what's on this day" + Add. Lists the day's school-status
// overrides (HBL / closures) and events as readable, color-coded rows; every
// addition is an event (the editor's type decides whether it's a school-status
// override or an informational event). A plain school day shows the empty state.

import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  DAY_TYPE_LEGEND_COLOR,
  EVENT_CATEGORY_LEGEND_COLOR,
} from '@/components/attendance/calendar/calendar-cell';
import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
// Same date-box anatomy as the hub's "Coming up" card and the List view —
// one visual grammar for "a specific date" across the calendar module.
import { DateBox } from '@/components/sis/hub-upcoming-events-card';
import { Button } from '@/components/ui/button';
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
  dayStatusLabel,
  isPlainSchoolDay,
  storageToDayStatus,
} from '@/lib/attendance/calendar-operational';
import { AUDIENCE_LABELS, type Audience } from '@/lib/schemas/attendance';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DayActionSheetProps {
  iso: string | null;
  termId: string;
  /** The clicked date's school_calendar row per audience (null = none). */
  rowsByAudience: Record<Audience, SchoolCalendarRow | null>;
  events: CalendarEventRow[];
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
  onAddEvent: (iso: string) => void;
  onEditEvent: (e: CalendarEventRow) => void;
  onDeleteEvent: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const AUDS: Audience[] = ['all', 'primary', 'secondary'];

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

function levelSuffix(a: Audience): string {
  return a === 'all' ? '' : ` · ${AUDIENCE_LABELS[a]}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DayActionSheet({
  iso,
  termId,
  rowsByAudience,
  events,
  editable,
  onClose,
  onSaved,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
}: DayActionSheetProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // School-status overrides on this day (non-plain-school-day rows only).
  const overrides = AUDS.map((a) => rowsByAudience[a])
    .filter((r): r is SchoolCalendarRow => r != null)
    .map((r) => ({
      row: r,
      status: storageToDayStatus({
        dayType: r.dayType,
        hblOverlay: r.hblOverlay,
      }),
    }))
    .filter((o) => !isPlainSchoolDay(o.status));

  const isEmpty = overrides.length === 0 && events.length === 0;

  // Revert a school-status override back to a regular school day. Whole-school
  // ('all') is set explicitly to school_day; a level override is dropped so it
  // follows the school-wide day again. Tier-2 mutation (Model A): the network
  // call routes through useMutation (retry: 0 + consistent error handling),
  // while `busyKey` still gates the specific row's button. Route-specific error
  // copy is preserved — ApiError.message resolves the body's `error`/`message`.
  const removeMutation = useMutation({
    mutationFn: (audience: Audience) =>
      audience === 'all'
        ? apiFetch(
            '/api/attendance/calendar',
            jsonInit('POST', {
              termId,
              audience: 'all',
              entries: [
                {
                  date: iso,
                  dayType: 'school_day',
                  label: null,
                  hblOverlay: false,
                },
              ],
            })
          )
        : apiFetch(
            `/api/attendance/calendar?${new URLSearchParams({
              termId,
              date: iso ?? '',
              audience,
            }).toString()}`,
            { method: 'DELETE' }
          ),
    onSuccess: () => {
      toast.success('Reverted to a school day');
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to revert');
    },
    onSettled: () => {
      setBusyKey(null);
    },
  });

  function removeOverride(audience: Audience) {
    if (!iso) return;
    setBusyKey(`day:${audience}`);
    removeMutation.mutate(audience);
  }

  return (
    <Sheet open={iso !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border px-6 pb-5 pt-6">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            School calendar
          </p>
          <div className="flex items-center gap-3">
            {iso && <DateBox iso={iso} />}
            <SheetTitle className="leading-snug">
              {iso ? formatIso(iso) : '—'}
            </SheetTitle>
          </div>
        </SheetHeader>

        {/* Body — scrollable */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!editable ? (
            <div className="rounded-xl border border-border bg-muted/40 p-5">
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                This date falls in a term break — it has no school day to
                configure.
              </p>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                On this day
              </p>

              {isEmpty ? (
                <p className="text-[13px] text-muted-foreground">
                  {iso && isWeekend(iso)
                    ? 'Weekend — no school. Add an event below if there’s something on this day.'
                    : 'It’s a school day. Add an event below — a holiday, an HBL day, an exam, and so on.'}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {/* School-status overrides */}
                  {overrides.map(({ row, status }) => (
                    <li
                      key={`day:${row.audience}`}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <ChartLegendChip
                        color={DAY_TYPE_LEGEND_COLOR[row.dayType]}
                        label={`${dayStatusLabel(status)}${levelSuffix(row.audience)}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Revert to a regular school day"
                        title="Revert to a regular school day"
                        disabled={busyKey === `day:${row.audience}`}
                        onClick={() => removeOverride(row.audience)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}

                  {/* Events */}
                  {events.map((e) => (
                    <li
                      key={`ev:${e.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <ChartLegendChip
                        color={EVENT_CATEGORY_LEGEND_COLOR[e.category]}
                        label={`${e.label}${levelSuffix(e.audience)}`}
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${e.label}`}
                          onClick={() => onEditEvent(e)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${e.label}`}
                          onClick={() => onDeleteEvent(e.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Footer — Add event */}
        {editable && iso && (
          <div className="border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              className="w-full gap-1.5"
              onClick={() => onAddEvent(iso)}
            >
              <CalendarPlus className="size-4" />
              Add event
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
