'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Pencil, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { ReliefOption } from '@/components/sis/assignment-relief-control';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sgToday } from '@/lib/dates';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Book one substitute across every class a teacher holds.
//
// ⚠ IT ASKS WHO IS AWAY, NOT WHICH CLASS. That is the point of the page and the
// reason this dialog exists beside the per-row control rather than replacing it.
// Which classes is a CONSEQUENCE of who is away, so the route works it out —
// this form never sends a class list, which also means it cannot send a stale
// one after somebody edited the timetable in another tab.

export function BookCoverDialog({
  teacherOptions,
  /**
   * Pre-fills the form to edit an absence that already exists. When set, the
   * page renders a pencil instead of the primary button and the teacher who is
   * away cannot be changed — that would be a different absence, not an edit.
   */
  editing,
}: {
  teacherOptions: ReliefOption[];
  editing?: {
    coveredTeacherId: string;
    coveredTeacherName: string;
    reliefTeacherId: string;
    startedOn: string | null;
    endedOn: string | null;
    classCount: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [away, setAway] = useState(editing?.coveredTeacherId ?? '');
  const [substitute, setSubstitute] = useState(editing?.reliefTeacherId ?? '');
  const [startsOn, setStartsOn] = useState(editing?.startedOn ?? '');
  const [endsOn, setEndsOn] = useState(editing?.endedOn ?? '');

  const mutation = useMutation({
    mutationFn: (body: {
      covered_teacher_user_id: string;
      relief_teacher_user_id: string;
      relief_started_on: string | null;
      relief_ended_on: string | null;
    }) => apiFetch('/api/relief/book', jsonInit('POST', body)),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  // Back to the absence as stored when editing, or blank when booking a new
  // one — so closing without saving never leaves half an edit behind.
  function reset() {
    setAway(editing?.coveredTeacherId ?? '');
    setSubstitute(editing?.reliefTeacherId ?? '');
    setStartsOn(editing?.startedOn ?? '');
    setEndsOn(editing?.endedOn ?? '');
  }

  const awayName = teacherOptions.find((t) => t.id === away)?.name;
  const subName = teacherOptions.find((t) => t.id === substitute)?.name;
  const badOrder = Boolean(startsOn && endsOn && endsOn < startsOn);
  const willSchedule = Boolean(startsOn && startsOn > sgToday());

  async function submit() {
    setBusy(true);
    await run(
      () =>
        mutation.mutateAsync({
          covered_teacher_user_id: away,
          relief_teacher_user_id: substitute,
          relief_started_on: startsOn || null,
          relief_ended_on: endsOn || null,
        }),
      {
        pending: editing
          ? 'Saving…'
          : willSchedule
            ? 'Booking cover…'
            : 'Starting cover…',
        success: editing
          ? `Cover for ${editing.coveredTeacherName} updated.`
          : willSchedule
            ? `${subName ?? 'That teacher'} is booked to cover for ${awayName ?? 'them'}. They get access on the first day.`
            : `${subName ?? 'That teacher'} is now covering for ${awayName ?? 'them'}.`,
        error: (e) =>
          e instanceof Error ? e.message : 'That booking could not be saved.',
        onResolved: () => {
          setOpen(false);
          reset();
        },
      }
    );
    setBusy(false);
  }

  // Nobody can cover for themselves, so the second list never offers the first
  // choice back. Leaving them out beats explaining the error afterwards.
  const substitutes = teacherOptions.filter((t) => t.id !== away);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Change the cover for ${editing.coveredTeacherName}`}
            title="Change the dates or the stand-in"
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
        ) : (
          <Button>
            <CalendarClock className="size-4" />
            Book cover
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {editing ? `Cover for ${editing.coveredTeacherName}` : 'Book cover'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `Changing this updates all ${editing.classCount} ${editing.classCount === 1 ? 'class' : 'classes'} at once. ${editing.coveredTeacherName} keeps their name on report cards and mark sheets throughout.`
              : 'One stand-in takes every class the teacher holds this year. They keep their name on report cards and mark sheets throughout.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="cover-away">Who is away</FieldLabel>
            {/* Locked when editing: swapping who is away would not be an edit,
                it would be a different absence, and would silently leave the
                first teacher's classes still covered. */}
            <Select
              value={away}
              onValueChange={setAway}
              disabled={Boolean(editing)}
            >
              <SelectTrigger id="cover-away">
                <SelectValue placeholder="— pick a teacher —" />
              </SelectTrigger>
              <SelectContent>
                {teacherOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="cover-sub">Standing in</FieldLabel>
            <Select
              value={substitute}
              onValueChange={setSubstitute}
              disabled={!away}
            >
              <SelectTrigger id="cover-sub">
                <SelectValue
                  placeholder={
                    away ? '— pick a teacher —' : 'Pick who is away first'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {substitutes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cover-from">First day</FieldLabel>
              <DatePicker
                id="cover-from"
                value={startsOn}
                onChange={setStartsOn}
                placeholder="Starts now"
                allowClear
              />
              <FieldDescription>
                Leave blank to start straight away.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="cover-to">Last day</FieldLabel>
              <DatePicker
                id="cover-to"
                value={endsOn}
                onChange={setEndsOn}
                placeholder="Until you end it"
                allowClear
              />
              <FieldDescription>Access stops the day after.</FieldDescription>
            </Field>
          </div>

          {badOrder && (
            <p className="text-sm text-destructive">
              The last day cannot be before the first day.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => void submit()}
            loading={busy}
            loadingText="Saving…"
            disabled={!away || !substitute || badOrder}
          >
            {!busy &&
              (willSchedule ? (
                <CalendarClock className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              ))}
            {editing
              ? 'Save changes'
              : willSchedule
                ? 'Book cover'
                : 'Start cover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
