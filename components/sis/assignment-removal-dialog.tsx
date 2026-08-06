'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ASSIGNMENT_CHANGE_NOTES_MAX,
  ASSIGNMENT_CHANGE_REASON_LABELS,
  ASSIGNMENT_CHANGE_REASON_VALUES,
  type AssignmentChangeReason,
} from '@/lib/schemas/teacher-assignment';

// Confirm dialog for taking a teacher off a class.
//
// Shared by all three removal surfaces (the class Teachers tab, and both the
// subject-removal and adviser-replacement paths in the staff sheet) so the
// question is worded and validated identically wherever it is asked.
//
// `termStarted` decides whether this is a plain confirmation or a recorded
// change: before the school year begins, removing a teacher is just setup and
// stays one click. The same gate is enforced server-side — this only spares the
// user a round-trip to be told.
export function AssignmentRemovalDialog({
  open,
  onOpenChange,
  termStarted,
  title,
  description,
  confirmLabel = 'Remove',
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  termStarted: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (
    reason: AssignmentChangeReason | null,
    notes: string | null
  ) => void | Promise<void>;
}) {
  const [reason, setReason] = useState<AssignmentChangeReason | ''>('');
  const [notes, setNotes] = useState('');

  // Start blank every time the dialog opens — a reason carried over from the
  // last removal would be silently attributed to a different teacher. Reset on
  // OPEN rather than on close so it holds however the dialog was dismissed
  // (cancel, Esc, overlay, or the caller closing it after a success).
  // Adjusting state during render is the documented alternative to an effect
  // here; an effect would re-render twice for no gain.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setNotes('');
    }
  }

  const notesRequired = reason === 'other';
  const blocked =
    termStarted && (!reason || (notesRequired && notes.trim().length === 0));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            {termStarted
              ? ' The school year has started, so this change is kept on the record.'
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {termStarted ? (
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="assignment-change-reason">
                Why is this changing?
              </FieldLabel>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as AssignmentChangeReason)}
                disabled={busy}
              >
                <SelectTrigger id="assignment-change-reason" className="w-full">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_CHANGE_REASON_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ASSIGNMENT_CHANGE_REASON_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="assignment-change-notes">
                {notesRequired ? 'Notes' : 'Notes (optional)'}
              </FieldLabel>
              <Textarea
                id="assignment-change-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={ASSIGNMENT_CHANGE_NOTES_MAX}
                rows={3}
                disabled={busy}
                placeholder={
                  notesRequired
                    ? 'Say what changed, in a sentence.'
                    : 'Anything the next person should know.'
                }
              />
              {notesRequired ? (
                <FieldDescription>
                  &quot;Other&quot; needs a sentence — otherwise the record says
                  nothing.
                </FieldDescription>
              ) : null}
            </Field>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={blocked || busy}
            onClick={(e) => {
              // Keep the dialog mounted while the request runs; the caller
              // closes it on success so a failure can be corrected in place
              // rather than losing the typed reason.
              e.preventDefault();
              void onConfirm(reason || null, notes.trim() || null);
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
