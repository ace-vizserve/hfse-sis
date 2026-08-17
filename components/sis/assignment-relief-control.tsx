'use client';

import { useMutation } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Cover for one class: on or off.
//
// Everything about this control is one row's worth. There is no date to pick,
// nothing to schedule and nothing to end later — somebody is standing in on
// this class right now, or nobody is (migration 117). So it renders as either
// "Add relief" or the substitute's name with a way to take them off, and it
// sits beside the class rather than behind a page-level button that would then
// have to ask which class was meant.
//
// Amber, not mint or destructive: cover is neither healthy-normal nor broken.
// It is a fact worth noticing on a row you are reading for another reason
// (§9.3).

export type ReliefOption = { id: string; name: string };

export function AssignmentReliefControl({
  assignmentId,
  coveredTeacherName,
  coveredTeacherId,
  reliefTeacherName,
  teacherOptions,
  canManage,
  onChanged,
}: {
  assignmentId: string;
  /** The teacher of record — the person being stood in for. */
  coveredTeacherName: string;
  coveredTeacherId: string;
  /** Who is covering right now, or null when nobody is. */
  reliefTeacherName: string | null;
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

  const mutation = useMutation({
    mutationFn: (reliefTeacherUserId: string | null) =>
      apiFetch(
        `/api/teacher-assignments/${assignmentId}`,
        jsonInit('PATCH', { relief_teacher_user_id: reliefTeacherUserId })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  // The argument rather than component state: by the time the toast is worded
  // the dialog has closed and `picked` is cleared, so a message read off state
  // would name the wrong person or nobody.
  async function setRelief(next: string | null) {
    const who = teacherOptions.find((t) => t.id === next)?.name;
    setBusy(true);
    await run(() => mutation.mutateAsync(next), {
      pending: next ? 'Starting cover…' : 'Ending cover…',
      success: next
        ? `${who ?? 'That teacher'} is now covering this class for ${coveredTeacherName}.`
        : `${coveredTeacherName} has this class back.`,
      error: (e) =>
        e instanceof Error ? e.message : 'That change could not be saved.',
      onResolved: () => {
        setOpen(false);
        setPicked('');
        void onChanged?.();
      },
    });
    setBusy(false);
  }

  // A teacher cannot cover their own class — enforced by the route and by a
  // CHECK constraint. Leaving them out of the list means nobody meets the
  // error in the first place.
  const choices = teacherOptions.filter((t) => t.id !== coveredTeacherId);

  if (reliefTeacherName) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Badge
          variant="outline"
          className="h-6 border-brand-amber bg-brand-amber-light text-ink"
        >
          <RefreshCw className="h-3 w-3" />
          {reliefTeacherName} covering
        </Badge>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void setRelief(null)}
            loading={busy}
            aria-label={`Stop ${reliefTeacherName} covering for ${coveredTeacherName}`}
            title={`${coveredTeacherName} is back`}
            className="text-muted-foreground hover:text-foreground"
          >
            {!busy && <X className="h-4 w-4" />}
          </Button>
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
        onClick={() => setOpen(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Add relief
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPicked('');
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Who is covering for {coveredTeacherName}?
            </DialogTitle>
            <DialogDescription>
              They get the mark sheet, the register and the class list for this
              one class until you take them off. {coveredTeacherName} stays the
              teacher named on the report card.
            </DialogDescription>
          </DialogHeader>

          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There is no other teacher with an active account to stand in.
              Create one on the Staff page first.
            </p>
          ) : (
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
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => void setRelief(picked)}
              loading={busy}
              loadingText="Saving…"
              disabled={!picked}
            >
              {!busy && <RefreshCw className="h-4 w-4" />}
              Start cover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
