'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Pencil, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { Badge } from '@/components/ui/badge';
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
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  coverBadgeClass,
  coverBadgeLabel,
  reliefStatus,
} from '@/lib/relief/display';

// Cover for one class.
//
// Everything about this control is one row's worth, and it sits beside the
// class rather than behind a page-level button that would then have to ask
// which class was meant. Booking a teacher's WHOLE absence at once is the Cover
// page's job; this is "I am already looking at this class and it needs somebody
// tomorrow."
//
// ⚠ SINCE MIGRATION 123 COVER CARRIES A WINDOW, so the badge no longer means
// one thing. Filled amber is a substitute who has the class NOW; hollow amber
// is one who is booked and has nothing yet. Both dates are optional and both
// blanks mean something — no start is "from now", no end is "until you end it"
// — so the original flow, pick a name and save, is still one pick and a save.
//
// Amber throughout, not mint or destructive: cover is neither healthy-normal
// nor broken. It is a fact worth noticing on a row you are reading for another
// reason (§9.3). The words and the fill carry the rest.

export type ReliefOption = { id: string; name: string };

export function AssignmentReliefControl({
  assignmentId,
  coveredTeacherName,
  coveredTeacherId,
  reliefTeacherName,
  reliefTeacherId = null,
  reliefStartedOn = null,
  reliefEndedOn = null,
  teacherOptions,
  canManage,
  onChanged,
}: {
  assignmentId: string;
  /** The teacher of record — the person being stood in for. */
  coveredTeacherName: string;
  coveredTeacherId: string;
  /**
   * Who is covering, or null when nobody is. ⚠ A name here does NOT mean they
   * have access — check the window below before saying so on screen.
   */
  reliefTeacherName: string | null;
  /** Their auth id — needed to pre-select them when the cover is edited. */
  reliefTeacherId?: string | null;
  /** First day of the cover; null means it started when it was set. */
  reliefStartedOn?: string | null;
  /** Last day of the cover, inclusive; null means open-ended. */
  reliefEndedOn?: string | null;
  teacherOptions: ReliefOption[];
  canManage: boolean;
  /**
   * Optional extra refresh for a caller holding its own copy of the rows.
   * `router.refresh()` always runs, which is all a server-rendered page needs —
   * and a server component cannot pass a function here anyway.
   */
  onChanged?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  const mutation = useMutation({
    mutationFn: (body: {
      relief_teacher_user_id: string | null;
      relief_started_on: string | null;
      relief_ended_on: string | null;
    }) =>
      apiFetch(
        `/api/teacher-assignments/${assignmentId}`,
        jsonInit('PATCH', body)
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setPicked('');
    setStartsOn('');
    setEndsOn('');
  }

  // Editing loads the cover that is already there; adding starts blank. Without
  // this the only way to move a booked cover's dates was to cancel it and set it
  // up again from scratch — which for "her leave got extended by two days" is
  // three steps too many, and on a bulk booking means redoing every class.
  function openDialog() {
    if (reliefTeacherName) {
      setPicked(reliefTeacherId ?? '');
      setStartsOn(reliefStartedOn ?? '');
      setEndsOn(reliefEndedOn ?? '');
    } else {
      resetForm();
    }
    setOpen(true);
  }

  // Arguments rather than component state: by the time the toast is worded the
  // dialog has closed and the fields are cleared, so a message read off state
  // would name the wrong person or nobody.
  async function setRelief(
    next: string | null,
    start: string | null,
    end: string | null
  ) {
    const who = teacherOptions.find((t) => t.id === next)?.name;
    // A cover that has not started yet gets different words throughout — the
    // action, the pending line and the confirmation all have to agree, or the
    // toast promises access the substitute does not have until next week.
    const later = Boolean(next && start && start > sgToday());

    setBusy(true);
    await run(
      () =>
        mutation.mutateAsync({
          relief_teacher_user_id: next,
          relief_started_on: next ? (start ?? null) : null,
          relief_ended_on: next ? (end ?? null) : null,
        }),
      {
        pending: next
          ? later
            ? 'Booking cover…'
            : 'Starting cover…'
          : 'Ending cover…',
        success: next
          ? later
            ? `${who ?? 'That teacher'} is booked to cover this class for ${coveredTeacherName}. They get access on the first day.`
            : `${who ?? 'That teacher'} is now covering this class for ${coveredTeacherName}.`
          : `${coveredTeacherName} has this class back.`,
        error: (e) =>
          e instanceof Error ? e.message : 'That change could not be saved.',
        onResolved: () => {
          setOpen(false);
          resetForm();
          void onChanged?.();
        },
      }
    );
    setBusy(false);
  }

  // A teacher cannot cover their own class — enforced by the route and by a
  // CHECK constraint. Leaving them out of the list means nobody meets the
  // error in the first place.
  const choices = teacherOptions.filter((t) => t.id !== coveredTeacherId);

  // A start date in the future books cover instead of starting it, and the
  // button says so.
  const willSchedule = Boolean(startsOn && startsOn > sgToday());

  const status = reliefStatus(reliefStartedOn, reliefEndedOn);
  const scheduled = status === 'scheduled';

  // The dialog is shared by both states — "Add relief" opens it empty, the
  // pencil opens it filled in. One form, so the two can never drift apart on
  // what a blank date means.
  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {reliefTeacherName
              ? `Cover for ${coveredTeacherName}`
              : `Who is covering for ${coveredTeacherName}?`}
          </DialogTitle>
          <DialogDescription>
            They get the mark sheet, the register and the class list for this
            one class. {coveredTeacherName} stays the teacher named on the
            report card.
          </DialogDescription>
        </DialogHeader>

        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There is no other teacher with an active account to stand in. Create
            one on the Staff page first.
          </p>
        ) : (
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor={`relief-${assignmentId}`}>
                Relief teacher
              </FieldLabel>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger id={`relief-${assignmentId}`}>
                  <SelectValue placeholder="— pick a teacher —" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Both optional, and the descriptions say what blank does —
                leaving them alone is the ordinary case and must not feel like
                skipping a step. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`relief-start-${assignmentId}`}>
                  First day
                </FieldLabel>
                <DatePicker
                  id={`relief-start-${assignmentId}`}
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
                <FieldLabel htmlFor={`relief-end-${assignmentId}`}>
                  Last day
                </FieldLabel>
                <DatePicker
                  id={`relief-end-${assignmentId}`}
                  value={endsOn}
                  onChange={setEndsOn}
                  placeholder="Until you end it"
                  allowClear
                />
                <FieldDescription>Access stops the day after.</FieldDescription>
              </Field>
            </div>

            {endsOn && startsOn && endsOn < startsOn && (
              <p className="text-sm text-destructive">
                The last day cannot be before the first day.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          {/* The button names what will actually happen. Picking a start date
              in the future books cover rather than starting it, and a control
              that still said "Start cover" would be describing the wrong thing
              at the moment of committing to it. */}
          <Button
            onClick={() =>
              void setRelief(picked, startsOn || null, endsOn || null)
            }
            loading={busy}
            loadingText="Saving…"
            disabled={
              !picked || Boolean(startsOn && endsOn && endsOn < startsOn)
            }
          >
            {!busy &&
              (willSchedule ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              ))}
            {reliefTeacherName
              ? 'Save changes'
              : willSchedule
                ? 'Book cover'
                : 'Start cover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (reliefTeacherName) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Badge
          variant="outline"
          className={`h-6 ${coverBadgeClass(status)}`}
          // The window in full on hover, so the badge itself can stay short.
          title={
            scheduled
              ? `${reliefTeacherName} has no access to this class yet.`
              : undefined
          }
        >
          {scheduled ? (
            <CalendarClock className="h-3 w-3" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {coverBadgeLabel(reliefTeacherName, reliefStartedOn, reliefEndedOn)}
        </Badge>
        {canManage && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={openDialog}
              aria-label={`Change the dates ${reliefTeacherName} is covering for ${coveredTeacherName}`}
              title="Change the dates or the teacher"
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void setRelief(null, null, null)}
              loading={busy}
              aria-label={
                scheduled
                  ? `Cancel ${reliefTeacherName} covering for ${coveredTeacherName}`
                  : `Stop ${reliefTeacherName} covering for ${coveredTeacherName}`
              }
              title={
                scheduled
                  ? 'Cancel this cover'
                  : `${coveredTeacherName} is back`
              }
              className="text-muted-foreground hover:text-foreground"
            >
              {!busy && <X className="h-4 w-4" />}
            </Button>
            {dialog}
          </>
        )}
      </div>
    );
  }

  if (!canManage) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={openDialog}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Add relief
      </Button>
      {dialog}
    </>
  );
}
