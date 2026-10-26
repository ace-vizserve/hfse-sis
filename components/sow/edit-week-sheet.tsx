'use client';

import { CalendarDays } from 'lucide-react';
import { useState } from 'react';

import { formatRange } from '@/components/sow/format';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { SowWeekFields } from '@/lib/schemas/sow';
import type { SowView } from '@/lib/sow/read';

// Edit week (board 4): one week's plan. The school calendar's events for the
// week sit read-only at the top, so the teacher plans around them.
//
// A save that lost a race (409 — someone else saved this week since it was
// opened) keeps everything typed and says so inline, rather than closing the
// drawer and throwing the work away.

type Week = SowView['weeks'][number];

type Form = {
  topic: string;
  learningOutcomes: string;
  textbookPages: string;
  activities: string;
  assessment: string;
  remarks: string;
};

const fromWeek = (w: Week): Form => ({
  topic: w.topic ?? '',
  learningOutcomes: w.learningOutcomes ?? '',
  textbookPages: w.textbookPages ?? '',
  activities: w.activities ?? '',
  assessment: w.assessment ?? '',
  remarks: w.remarks ?? '',
});

export function EditWeekSheet({
  sowId,
  week,
  title,
  returnNote,
  onOpenChange,
}: {
  sowId: string;
  /** The week being edited; null = closed. */
  week: Week | null;
  /** "Secondary 1 Science · Term 2". */
  title: string;
  /** The return note, when it is about this week. */
  returnNote: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={week !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* Keyed so each week opens with its own saved values. */}
        {week && (
          <WeekForm
            key={`${week.weekNumber}-${week.updatedAt}`}
            sowId={sowId}
            week={week}
            title={title}
            returnNote={returnNote}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function WeekForm({
  sowId,
  week,
  title,
  returnNote,
  onDone,
}: {
  sowId: string;
  week: Week;
  title: string;
  returnNote: string | null;
  onDone: () => void;
}) {
  const run = useWriteAction();
  const [form, setForm] = useState<Form>(() => fromWeek(week));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const n = week.weekNumber;

  const set =
    (k: keyof Form) =>
    (value: string): void =>
      setForm((f) => ({ ...f, [k]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Only what changed is sent, so a save never rewrites a field it did not
    // touch.
    const initial = fromWeek(week);
    const fields: SowWeekFields = {};
    for (const k of Object.keys(form) as (keyof Form)[]) {
      if (form[k] !== initial[k]) fields[k] = form[k];
    }
    if (Object.keys(fields).length === 0) {
      onDone();
      return;
    }
    setConflict(null);
    setSaving(true);
    await run(
      () =>
        apiFetch<{ ok: true; updatedAt: string }>(
          `/api/sow/${sowId}/weeks/${n}`,
          jsonInit('PATCH', { fields, expectedUpdatedAt: week.updatedAt })
        ),
      {
        pending: `Saving Week ${n}…`,
        success: `Week ${n} saved`,
        error: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict(err.message);
            return null;
          }
          return err instanceof Error && err.message
            ? err.message
            : 'Could not save. Please try again.';
        },
        onResolved: onDone,
      }
    );
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
        <p className="text-[13px] text-muted-foreground">{title}</p>
        <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
          Week {n} · {formatRange(week.startsOn, week.endsOn)}
        </SheetTitle>
        <SheetDescription asChild>
          {week.events.length > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-brand-amber">
              <CalendarDays className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>From the school calendar: {week.events.join(' · ')}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No school events this week.
            </p>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {returnNote && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">
            Return note: &ldquo;{returnNote}&rdquo;
          </div>
        )}
        {conflict && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive"
          >
            {conflict}
          </div>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="week-topic">Topic</FieldLabel>
            <Input
              id="week-topic"
              value={form.topic}
              maxLength={300}
              onChange={(e) => set('topic')(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="week-outcomes">Learning outcomes</FieldLabel>
            <RichTextEditor
              id="week-outcomes"
              value={form.learningOutcomes}
              onChange={set('learningOutcomes')}
              rows={3}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="week-textbook">Textbook / pages</FieldLabel>
            <Input
              id="week-textbook"
              value={form.textbookPages}
              maxLength={200}
              onChange={(e) => set('textbookPages')(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="week-activities">
              Teaching and learning activities
            </FieldLabel>
            <RichTextEditor
              id="week-activities"
              value={form.activities}
              onChange={set('activities')}
              rows={3}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="week-assessment">Assessment</FieldLabel>
            <Input
              id="week-assessment"
              value={form.assessment}
              maxLength={500}
              onChange={(e) => set('assessment')(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="week-remarks">Remarks</FieldLabel>
            <RichTextEditor
              id="week-remarks"
              value={form.remarks}
              onChange={set('remarks')}
              rows={2}
            />
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-6 py-4">
        <SheetClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </SheetClose>
        <Button
          type="submit"
          loading={saving}
          loadingText={`Saving Week ${n}…`}
        >
          Save Week {n}
        </Button>
      </SheetFooter>
    </form>
  );
}
