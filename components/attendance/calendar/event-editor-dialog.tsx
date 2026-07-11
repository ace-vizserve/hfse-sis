'use client';

// EventEditorDialog — one unified "add to the calendar" flow. Pick a TYPE and a
// LEVEL; the type decides where it's stored:
//   • Day-affecting types (HBL / closures) → school_calendar (POST /attendance/calendar)
//   • Informational types (exam, PTC, …)   → calendar_events (POST/PATCH .../events)
// Edit mode handles informational events only (day-status overrides are removed
// from the day sheet and re-added).
//
// Design system: shadcn Dialog + Field-shaped rows; tokens only.

import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { sgToday } from '@/lib/dates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CalendarEventRow } from '@/lib/attendance/calendar';
import {
  AUDIENCE_LABELS,
  AUDIENCE_VALUES,
  type Audience,
  type DayType,
  type EventCategory,
} from '@/lib/schemas/attendance';

// ─── Entry types (day-affecting + informational, one flat list) ────────────────

type EntryType =
  | {
      key: string;
      label: string;
      target: 'day';
      dayType: DayType;
      hblOverlay?: boolean;
    }
  | { key: string; label: string; target: 'event'; category: EventCategory };

const ENTRY_TYPES: EntryType[] = [
  // Day-affecting — change whether attendance is taken.
  {
    key: 'school_day',
    label: 'Regular school day (clear any closure)',
    target: 'day',
    dayType: 'school_day',
  },
  {
    key: 'hbl',
    label: 'HBL — taught remotely (attendance taken)',
    target: 'day',
    dayType: 'hbl',
  },
  {
    key: 'public_holiday',
    label: 'Public holiday — closed',
    target: 'day',
    dayType: 'public_holiday',
  },
  {
    key: 'school_holiday',
    label: 'School holiday — closed',
    target: 'day',
    dayType: 'school_holiday',
    hblOverlay: false,
  },
  {
    key: 'school_holiday_hbl',
    label: 'School holiday — attendance still taken',
    target: 'day',
    dayType: 'school_holiday',
    hblOverlay: true,
  },
  {
    key: 'no_class',
    label: 'No class — closed',
    target: 'day',
    dayType: 'no_class',
  },
  // Informational — labels only, never affect attendance.
  { key: 'term_exam', label: 'Exam', target: 'event', category: 'term_exam' },
  {
    key: 'ptc',
    label: 'Parent-teacher conference',
    target: 'event',
    category: 'ptc',
  },
  {
    key: 'parents_dialogue',
    label: 'Parents dialogue',
    target: 'event',
    category: 'parents_dialogue',
  },
  {
    key: 'subject_week',
    label: 'Subject week',
    target: 'event',
    category: 'subject_week',
  },
  {
    key: 'start_of_term',
    label: 'Start of term',
    target: 'event',
    category: 'start_of_term',
  },
  { key: 'pfe', label: 'PFE', target: 'event', category: 'pfe' },
  {
    key: 'school_event',
    label: 'School event',
    target: 'event',
    category: 'school_event',
  },
  { key: 'other', label: 'Other', target: 'event', category: 'other' },
];

function entryKeyForEvent(category: EventCategory): string {
  return (
    ENTRY_TYPES.find((t) => t.target === 'event' && t.category === category)
      ?.key ?? 'other'
  );
}

/** yyyy-MM-dd inclusive range → array of dates (local, tz-safe). */
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const d = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  const pad = (n: number) => String(n).padStart(2, '0');
  while (d.getTime() <= last.getTime()) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** yyyy-MM-dd → readable local date (tz-safe). */
function formatIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function EventEditorDialog({
  open,
  termId,
  defaultStart,
  defaultEnd,
  defaultAudience,
  editing,
  onClose,
  onCreated,
}: {
  open: boolean;
  termId: string;
  /** Seed dates for a new entry (e.g. the clicked day). Falls back to today. */
  defaultStart?: string;
  defaultEnd?: string;
  defaultAudience: Audience;
  /** When set, edits this informational event (PATCH) instead of creating. */
  editing: CalendarEventRow | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = editing !== null;
  // A fresh "add" with no clicked day seeds today (not the term start, which is
  // often already in the past — that's what tripped the old term-window guard).
  const seedStart = defaultStart || sgToday();
  const seedEnd = defaultEnd || seedStart;
  const [start, setStart] = useState(seedStart);
  const [end, setEnd] = useState(seedEnd);
  const [label, setLabel] = useState('');
  const [typeKey, setTypeKey] = useState<string>('public_holiday');
  const [eventAudience, setEventAudience] = useState<Audience>(defaultAudience);
  // Past-date warning confirm (future/today saves directly; a passed date warns).
  const [pastWarnOpen, setPastWarnOpen] = useState(false);

  // Edit mode only offers informational types (day overrides are re-added).
  const typeOptions = isEdit
    ? ENTRY_TYPES.filter((t) => t.target === 'event')
    : ENTRY_TYPES;
  const selected = ENTRY_TYPES.find((t) => t.key === typeKey) ?? ENTRY_TYPES[0];

  // Reset on open — from `editing` in edit mode, else the seed dates.
  const key = isEdit
    ? `edit:${editing.id}`
    : `new:${termId}-${seedStart}-${seedEnd}-${defaultAudience}`;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (open && initKey !== key) {
    setInitKey(key);
    if (isEdit) {
      setStart(editing.startDate);
      setEnd(editing.endDate);
      setLabel(editing.label);
      setTypeKey(entryKeyForEvent(editing.category));
      setEventAudience(editing.audience);
    } else {
      setStart(seedStart);
      setEnd(seedEnd);
      setLabel('');
      setTypeKey('public_holiday');
      setEventAudience(defaultAudience);
    }
  }
  if (!open && initKey !== null) setInitKey(null);

  // Tier-2 mutation (Model A): useMutation owns the pending/error UX; on success
  // we toast + call onCreated() (the parent closes + router.refresh()s). The
  // route-specific error copy is preserved — ApiError.message already resolves
  // to the body's `error` (then `message`), so `e.message` carries the route's
  // own wording (e.g. day-type not encodable / term-bound validation / 409).
  const saveMutation = useMutation({
    mutationFn: () => {
      if (selected.target === 'day') {
        const entries = datesInRange(start, end).map((date) => ({
          date,
          dayType: selected.dayType,
          label: label.trim() || null,
          hblOverlay: selected.hblOverlay ?? false,
        }));
        return apiFetch(
          '/api/attendance/calendar',
          jsonInit('POST', { termId, audience: eventAudience, entries })
        );
      }
      return apiFetch(
        '/api/attendance/calendar/events',
        jsonInit(
          isEdit ? 'PATCH' : 'POST',
          isEdit
            ? {
                id: editing.id,
                startDate: start,
                endDate: end,
                label: label.trim(),
                category: selected.category,
                audience: eventAudience,
                pastDateOverride: end < sgToday(),
              }
            : {
                termId,
                startDate: start,
                endDate: end,
                label: label.trim(),
                category: selected.category,
                audience: eventAudience,
                pastDateOverride: end < sgToday(),
              }
        )
      );
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Event updated' : 'Added to the calendar');
      onCreated();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  const saving = saveMutation.isPending;

  function save() {
    if (end < start) {
      toast.error('End date must be on or after the start date');
      return;
    }
    // Informational events need a label; day overrides can use the type label.
    if (selected.target === 'event' && !label.trim()) {
      toast.error('Label is required');
      return;
    }
    // A date that has already passed is editable, but warn first (the change
    // still goes through on confirm, flagged in the audit trail). Today/future
    // saves directly. "Passed" = the entry's end date is before today, so an
    // entry currently in progress is treated as not-yet-passed.
    if (end < sgToday()) {
      setPastWarnOpen(true);
      return;
    }

    saveMutation.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              School calendar
            </p>
            <DialogTitle className="font-serif text-[18px] font-semibold tracking-tight">
              {isEdit ? 'Edit event' : 'Add to the calendar'}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the event's dates, label, type, or level."
                : 'Pick a type and the level it applies to. Holidays / HBL change whether attendance is taken; everything else is just a labelled note.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={typeKey} onValueChange={setTypeKey}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Level</Label>
                <Select
                  value={eventAudience}
                  onValueChange={(v) => setEventAudience(v as Audience)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick a level" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIENCE_VALUES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a === 'all' ? 'Whole school' : AUDIENCE_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <DatePicker value={start} onChange={setStart} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <DatePicker value={end} onChange={setEnd} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="addEventLabel">
                Label{selected.target === 'day' ? ' (optional)' : ''}
              </Label>
              <Input
                id="addEventLabel"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  selected.target === 'day'
                    ? 'e.g. Vesak Day, Marking day'
                    : "e.g. P5 Mock Exam Week, Founders' Day"
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !saving) {
                    e.preventDefault();
                    save();
                  }
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {isEdit ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pastWarnOpen} onOpenChange={setPastWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This date has already passed</AlertDialogTitle>
            <AlertDialogDescription>
              {start === end
                ? `${formatIso(start)} is in the past.`
                : `${formatIso(start)}–${formatIso(end)} is in the past.`}{' '}
              You can still save this change — it&rsquo;ll be recorded in the
              activity log. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPastWarnOpen(false);
                saveMutation.mutate();
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
