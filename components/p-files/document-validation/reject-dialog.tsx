'use client';

import * as React from 'react';

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
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { proseLength } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

const REJECT_MIN_CHARS = 20;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotLabel: string;
  studentName: string;
  onConfirm: (reason: string) => Promise<void> | void;
};

export function RejectDialog({
  open,
  onOpenChange,
  slotLabel,
  studentName,
  onConfirm,
}: Props) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setBusy(false);
    }
  }, [open]);

  // Counted as writing, not as markup. The reason is typed in a formatting
  // editor now, so `reason.length` would let a single bolded word clear a
  // twenty-character minimum meant to stop one-word rejections reaching a
  // parent.
  const reasonLength = proseLength(reason);
  const canConfirm = reasonLength >= REJECT_MIN_CHARS;

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject {slotLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            {studentName} will be notified by email with the reason below. The
            parent can re-upload after seeing the message.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <RichTextEditor
            value={reason}
            onChange={setReason}
            placeholder="Why are you rejecting this document?"
            rows={4}
            aria-label="Reason for rejecting this document"
          />
          <p
            className={cn(
              'text-[11px]',
              canConfirm ? 'text-brand-mint' : 'text-muted-foreground'
            )}
          >
            {reasonLength} / {REJECT_MIN_CHARS} min characters
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={!canConfirm || busy}
          >
            {busy ? 'Rejecting…' : 'Reject document'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
