'use client';

import { Calendar, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
  dayStatusToStorage,
  storageToDayStatus,
  type DayStatus,
} from '@/lib/attendance/calendar-operational';
import {
  AUDIENCE_LABELS,
  AUDIENCE_VALUES,
  type Audience,
} from '@/lib/schemas/attendance';

// The two editable audiences shown in the sheet. 'All' is the implicit
// school-wide default both levels start from; it isn't edited directly.
const SHEET_LEVELS = AUDIENCE_VALUES.filter(
  (a): a is Exclude<Audience, 'all'> => a !== 'all'
);

// ─── Status options (one flat list per level — no override/inherit jargon) ──────

type StatusOption = { value: string; label: string; status: DayStatus };

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'open', label: 'Open', status: { kind: 'open', hbl: false } },
  {
    value: 'open-hbl',
    label: 'Open · HBL (taught remotely)',
    status: { kind: 'open', hbl: true },
  },
  {
    value: 'closed-public',
    label: 'Closed · Public holiday',
    status: { kind: 'closed', reason: 'public_holiday' },
  },
  {
    value: 'closed-school',
    label: 'Closed · School holiday',
    status: { kind: 'closed', reason: 'school_holiday', hblOverlay: false },
  },
  {
    value: 'closed-school-hbl',
    label: 'Closed · School holiday (attendance still taken)',
    status: { kind: 'closed', reason: 'school_holiday', hblOverlay: true },
  },
  {
    value: 'closed-noclass',
    label: 'Closed · No class',
    status: { kind: 'closed', reason: 'no_class' },
  },
];

/** Map a DayStatus to its STATUS_OPTIONS value. */
function statusToValue(s: DayStatus): string {
  if (s.kind === 'open') return s.hbl ? 'open-hbl' : 'open';
  if (s.reason === 'school_holiday') {
    return s.hblOverlay ? 'closed-school-hbl' : 'closed-school';
  }
  if (s.reason === 'public_holiday') return 'closed-public';
  return 'closed-noclass';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DayActionSheetProps {
  iso: string | null;
  termId: string;
  /** The clicked date's school_calendar row per audience (null = none yet). */
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

// ─── Per-level status editor (one compact dropdown) ─────────────────────────────

function LevelStatusEditor({
  level,
  status,
  onChange,
}: {
  level: Exclude<Audience, 'all'>;
  status: DayStatus;
  onChange: (s: DayStatus) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={`status-${level}`}
        className="text-[13px] font-medium text-foreground"
      >
        {AUDIENCE_LABELS[level]}
      </Label>
      <Select
        value={statusToValue(status)}
        onValueChange={(v) => {
          const opt = STATUS_OPTIONS.find((o) => o.value === v);
          if (opt) onChange(opt.status);
        }}
      >
        <SelectTrigger id={`status-${level}`} className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
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
  // Each level starts from its own row, or the school-wide default it follows.
  const effectiveRow = (level: Audience): SchoolCalendarRow | null =>
    rowsByAudience[level] ?? rowsByAudience.all;

  const [statusByLevel, setStatusByLevel] = useState<
    Record<'primary' | 'secondary', DayStatus>
  >(() => ({
    primary: initialStatus(effectiveRow('primary')),
    secondary: initialStatus(effectiveRow('secondary')),
  }));
  const [busy, setBusy] = useState(false);

  // Re-initialise when the sheet opens for a new day. rowsByAudience already
  // reflects the new iso (resolved by the parent).
  const [lastIso, setLastIso] = useState<string | null>(iso);
  if (iso !== lastIso) {
    setLastIso(iso);
    setStatusByLevel({
      primary: initialStatus(effectiveRow('primary')),
      secondary: initialStatus(effectiveRow('secondary')),
    });
    setBusy(false);
  }

  // Save writes BOTH levels — one request per audience (the upsert route takes
  // a single audience per call).
  async function handleSave() {
    if (!iso) return;
    setBusy(true);
    try {
      await Promise.all(
        SHEET_LEVELS.map(async (lvl) => {
          const { dayType, hblOverlay } = dayStatusToStorage(
            statusByLevel[lvl]
          );
          const res = await fetch('/api/attendance/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              termId,
              audience: lvl,
              // Preserve this level's own label, if any.
              entries: [
                {
                  date: iso,
                  dayType,
                  label: rowsByAudience[lvl]?.label ?? null,
                  hblOverlay,
                },
              ],
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              (body as { error?: string; message?: string }).error ??
                (body as { message?: string }).message ??
                `Server error ${res.status}`
            );
          }
        })
      );
      toast.success('Day saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save day');
    } finally {
      setBusy(false);
    }
  }

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
              {/* Day status — Primary and Secondary, both shown, set each. */}
              <section className="space-y-4">
                <div className="space-y-1">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Day status
                  </p>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Set the schedule for each level — they can differ (e.g. HBL
                    for Primary, open for Secondary).
                  </p>
                </div>

                <LevelStatusEditor
                  level="primary"
                  status={statusByLevel.primary}
                  onChange={(s) =>
                    setStatusByLevel((prev) => ({ ...prev, primary: s }))
                  }
                />
                <LevelStatusEditor
                  level="secondary"
                  status={statusByLevel.secondary}
                  onChange={(s) =>
                    setStatusByLevel((prev) => ({ ...prev, secondary: s }))
                  }
                />
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
