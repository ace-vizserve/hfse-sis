'use client';

// EventEditorDialog — create / edit a single calendar_events row (label,
// category incl. term_break, audience/level, tentative, date range bounded to
// a term). Lifted verbatim from the legacy calendar-admin-client.tsx
// AddEventDialog (Task 11) — only import paths changed. POST creates, PATCH
// edits via /api/attendance/calendar/events.
//
// Design system: shadcn Dialog + Field-shaped Label/Input/Select rows; tokens
// only (already compliant in its original location).

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  EVENT_CATEGORY_LABELS,
  EVENT_CATEGORY_VALUES,
  type Audience,
  type EventCategory,
} from '@/lib/schemas/attendance';

export function EventEditorDialog({
  open,
  termId,
  termStart,
  termEnd,
  defaultAudience,
  editing,
  onClose,
  onCreated,
}: {
  open: boolean;
  termId: string;
  termStart: string;
  termEnd: string;
  defaultAudience: Audience;
  /** When set, the dialog edits this event (PATCH) instead of creating one (POST). */
  editing: CalendarEventRow | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = editing !== null;
  const [start, setStart] = useState(termStart);
  const [end, setEnd] = useState(termEnd);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<EventCategory>('school_event');
  const [eventAudience, setEventAudience] = useState<Audience>(defaultAudience);
  const [tentative, setTentative] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens — values come from `editing` in edit mode,
  // or from term defaults in create mode.
  const key = isEdit
    ? `edit:${editing.id}`
    : `new:${termId}-${termStart}-${termEnd}-${defaultAudience}`;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (open && initKey !== key) {
    setInitKey(key);
    if (isEdit) {
      setStart(editing.startDate);
      setEnd(editing.endDate);
      setLabel(editing.label);
      setCategory(editing.category);
      setEventAudience(editing.audience);
      setTentative(editing.tentative);
    } else {
      setStart(termStart);
      setEnd(termEnd);
      setLabel('');
      setCategory('school_event');
      setEventAudience(defaultAudience);
      setTentative(false);
    }
  }
  if (!open && initKey !== null) setInitKey(null);

  async function save() {
    if (!label.trim()) {
      toast.error('Label is required');
      return;
    }
    if (end < start) {
      toast.error('End date must be on or after start date');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/attendance/calendar/events', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? {
                id: editing.id,
                startDate: start,
                endDate: end,
                label: label.trim(),
                category,
                audience: eventAudience,
                tentative,
              }
            : {
                termId,
                startDate: start,
                endDate: end,
                label: label.trim(),
                category,
                audience: eventAudience,
                tentative,
              }
        ),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(
          body?.error ?? (isEdit ? 'update failed' : 'create failed')
        );
      toast.success(isEdit ? 'Event updated' : 'Event added');
      onCreated();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : isEdit
            ? 'update failed'
            : 'create failed'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[18px] font-semibold tracking-tight">
            {isEdit ? 'Edit date range' : 'Add a date range'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the event's dates, label, category, audience, or tentative flag. Changes apply immediately."
              : "Adds a colored event chip across the matching dates. Doesn't block attendance — teachers still mark students as usual. Pick a category to color-code (term exams, subject weeks, parents dialogue, etc.)."}
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
              placeholder="e.g. P5 Mock Exam Week, Founders' Day, PFE Site Visit"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="addEventCategory">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as EventCategory)}
              >
                <SelectTrigger id="addEventCategory" className="h-9">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_CATEGORY_VALUES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {EVENT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addEventAudience">Audience</Label>
              <Select
                value={eventAudience}
                onValueChange={(v) => setEventAudience(v as Audience)}
              >
                <SelectTrigger id="addEventAudience" className="h-9">
                  <SelectValue placeholder="Pick an audience" />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_VALUES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIENCE_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <Checkbox
              checked={tentative}
              onCheckedChange={(v) => setTentative(Boolean(v))}
            />
            <span>
              Tentative — provisional date pending review (renders dashed in the
              grid)
            </span>
          </label>
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
  );
}
