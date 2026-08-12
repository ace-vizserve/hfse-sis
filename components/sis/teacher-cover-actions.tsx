'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RELIEF_REASON_LABELS,
  RELIEF_REASON_VALUES,
  type ReliefReason,
} from '@/lib/schemas/assignment-relief';

/** Today as yyyy-MM-dd in the viewer's own calendar — the same day the picker
 *  writes when they click "today", so the two cannot disagree by a timezone. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "13 August" — long form here; this line is a warning, not a table cell. */
function formatStartDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]}`;
}

export type CoverableClass = {
  assignmentId: string;
  label: string;
  sublabel: string;
  /** Running OR scheduled — either way the slot is taken and the database
   *  will refuse a second cover on it. */
  alreadyCovered: boolean;
  /** Who has it and from when, so a locked row explains itself. */
  coverNote: string | null;
};

/**
 * "Arrange cover" — the whole teacher at once.
 *
 * This is the screen used the morning somebody calls in sick, so it starts
 * from the teacher and lists everything they hold. One reason and one start
 * date for the batch; a substitute chosen per class, because in practice one
 * person takes the form class and the subject classes get split.
 *
 * Classes already being covered are listed but locked — arranging a second
 * cover on the same class is what the database refuses, and showing the row
 * greyed with the reason is kinder than letting it be ticked and then failing.
 */
export function TeacherCoverActions({
  teacherId,
  teacherName,
  classes,
  teacherOptions,
  canManage,
}: {
  teacherId: string;
  teacherName: string;
  classes: CoverableClass[];
  teacherOptions: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReliefReason>('on_leave');
  const [notes, setNotes] = useState('');
  const [startedOn, setStartedOn] = useState('');
  // TWO facts, TWO pieces of state.
  //
  //   ticked      — which classes are being arranged
  //   chosenById  — who covers each, remembered even while unticked
  //
  // They were one map twice, and both times it went wrong. First, ticking
  // stored '' and the checkbox rendered from `Boolean(value)`, so a freshly
  // ticked box drew itself unticked. Then, un-ticking DELETED the entry while
  // the Select — passed `value={chosen || undefined}` — quietly went
  // uncontrolled and kept displaying the old teacher, so the row read as
  // filled in while the state said empty.
  //
  // Kept apart, neither can happen: the checkbox reads `ticked`, the dropdown
  // reads `chosenById`, and un-ticking touches only the first.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [chosenById, setChosenById] = useState<Record<string, string>>({});

  const available = classes.filter((c) => !c.alreadyCovered);
  const tickedIds = [...ticked];
  const readyIds = tickedIds.filter((id) => Boolean(chosenById[id]));
  const tickedCount = tickedIds.length;
  const readyCount = readyIds.length;
  const notesRequired = reason === 'other';
  // Compared as plain yyyy-MM-dd strings, which sort correctly and avoid
  // dragging a Date (and its timezone) into a purely calendar question.
  const isFutureStart = Boolean(startedOn) && startedOn > todayIso();

  // Blocked only when there is nothing to do, or something ticked with nobody
  // in it. A ticked class with no teacher is the one genuinely incomplete
  // state; everything else is a valid partial selection.
  const incomplete = tickedCount === 0 || readyCount !== tickedCount;
  const blocked = incomplete || (notesRequired && notes.trim().length === 0);

  const reset = () => {
    setReason('on_leave');
    setNotes('');
    setStartedOn('');
    setTicked(new Set());
    setChosenById({});
  };

  const arrange = useMutation({
    mutationFn: async () => {
      return apiFetch<{ count: number }>(
        '/api/assignment-reliefs',
        jsonInit('POST', {
          reason,
          notes: notes.trim() || undefined,
          started_on: startedOn || undefined,
          // Ticked-but-empty rows are filtered out rather than sent. The
          // button already blocks on them, so this is belt and braces — but
          // sending one would fail Zod on a uuid, and "Choose the teacher who
          // will be covering" arriving as a toast is a worse way to learn it
          // than the row telling you.
          covers: readyIds.map((assignmentId) => ({
            assignment_id: assignmentId,
            relief_teacher_user_id: chosenById[assignmentId],
          })),
        })
      );
    },
    onSuccess: (result) => {
      toast.success(
        result.count === 1
          ? 'Cover arranged for 1 class.'
          : `Cover arranged for ${result.count} classes.`
      );
      setOpen(false);
      reset();
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!canManage) {
    // Shown disabled rather than hidden. A control that silently vanishes for
    // the academic coordinator — who keeps every other control on this page —
    // reads as a bug and generates a question.
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" disabled>
          <RefreshCw className="size-4" />
          Arrange cover
        </Button>
        <p className="text-xs text-muted-foreground">
          Only a school administrator can arrange cover.
        </p>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={available.length === 0}>
          <RefreshCw className="size-4" />
          Arrange cover
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Arrange cover for {teacherName}
          </DialogTitle>
          <DialogDescription>
            {teacherName} stays the teacher of record throughout — their name is
            what appears on the report cards and the mark sheets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cover-reason">Why</FieldLabel>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as ReliefReason)}
              >
                <SelectTrigger id="cover-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELIEF_REASON_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {RELIEF_REASON_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="cover-start">Starting</FieldLabel>
              <DatePicker
                id="cover-start"
                value={startedOn}
                onChange={setStartedOn}
                placeholder="Today"
              />
              {/* A future start date is legitimate — leave is often arranged in
                  advance — but it means nothing changes today, and the class
                  keeps its own teacher until then. Said here, at the moment of
                  choosing, because the alternative is arranging cover, seeing
                  no change anywhere, and assuming it failed to save. */}
              {isFutureStart && (
                <p className="text-xs text-brand-amber">
                  Cover will not start until {formatStartDate(startedOn)}.{' '}
                  {teacherName} keeps these classes until then.
                </p>
              )}
            </Field>
          </div>

          {notesRequired && (
            <Field>
              <FieldLabel htmlFor="cover-notes">
                Say briefly why cover is needed
              </FieldLabel>
              <Input
                id="cover-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
                placeholder="Seconded to the new campus for a term"
              />
            </Field>
          )}

          <div className="rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="font-serif text-sm font-semibold text-foreground">
                {classes.length} {classes.length === 1 ? 'class' : 'classes'}
              </p>
              {/* Counts rows with somebody actually in them, not rows ticked.
                  A ticked row with an empty dropdown is not cover arranged,
                  and counting it as such is what made the button disagree
                  with this line. */}
              <p className="text-xs text-muted-foreground">
                {readyCount} of {available.length} covered
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto px-4 py-1">
              {classes.map((c) => {
                const chosen = chosenById[c.assignmentId] ?? '';
                const isTicked = ticked.has(c.assignmentId);
                return (
                  <div
                    key={c.assignmentId}
                    className={`flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0 ${
                      c.alreadyCovered ? 'opacity-55' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        id={`cover-${c.assignmentId}`}
                        checked={isTicked}
                        disabled={c.alreadyCovered}
                        onCheckedChange={(next) => {
                          // Only membership changes. The chosen teacher is
                          // left alone, so an accidental untick is one click
                          // to undo rather than a re-pick.
                          setTicked((prev) => {
                            const copy = new Set(prev);
                            if (next) copy.add(c.assignmentId);
                            else copy.delete(c.assignmentId);
                            return copy;
                          });
                        }}
                      />
                      <label
                        htmlFor={`cover-${c.assignmentId}`}
                        className="min-w-0 cursor-pointer"
                      >
                        <span className="block text-sm font-semibold text-foreground">
                          {c.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {c.alreadyCovered
                            ? (c.coverNote ?? 'Already being covered')
                            : c.sublabel}
                        </span>
                      </label>
                    </div>

                    {/* Not gated on the checkbox. Choosing a teacher IS the
                        act of assigning cover, so it ticks the row itself —
                        making someone tick a box before the control they were
                        reaching for becomes usable is a step that exists only
                        because the state was modelled that way. */}
                    <Select
                      // Controlled with '' rather than undefined. `undefined`
                      // hands the component back its own internal state, and
                      // it then goes on showing a teacher this dialog no
                      // longer has recorded.
                      value={chosen}
                      disabled={c.alreadyCovered}
                      onValueChange={(v) => {
                        setChosenById((prev) => ({
                          ...prev,
                          [c.assignmentId]: v,
                        }));
                        // Choosing somebody IS arranging cover for that class.
                        setTicked((prev) => new Set(prev).add(c.assignmentId));
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Choose a teacher" />
                      </SelectTrigger>
                      <SelectContent>
                        {teacherOptions.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:items-center">
          {/* A disabled button with no reason beside it is a dead end — the
              admin can see it is off and not why. */}
          {blocked && (
            <p className="mr-auto text-xs text-muted-foreground">
              {tickedCount === 0
                ? 'Tick a class and choose who covers it.'
                : readyCount !== tickedCount
                  ? 'Choose a teacher for every class you have ticked.'
                  : 'Say briefly why cover is needed.'}
            </p>
          )}
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => arrange.mutate()}
            disabled={blocked || arrange.isPending}
          >
            {arrange.isPending && <Loader2 className="size-4 animate-spin" />}
            {readyCount === 0
              ? 'Arrange cover'
              : `Arrange cover for ${readyCount} ${readyCount === 1 ? 'class' : 'classes'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
