'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type Props = {
  assignmentId: string;
  email: string;
  flowLabel: string;
};

export function ApproverRevokeButton({
  assignmentId,
  email,
  flowLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  const revokeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/admin/approvers/${assignmentId}`, jsonInit('DELETE')),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  async function revoke() {
    setSubmitting(true);
    await run(() => revokeMutation.mutateAsync(), {
      pending: `Removing ${email}…`,
      success: `${email} removed from ${flowLabel}`,
      error: (err) => (err instanceof Error ? err.message : 'Failed to revoke'),
      onResolved: () => setOpen(false),
    });
    setSubmitting(false);
  }

  function onConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    void revoke();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Trash2 className="mr-1 size-3" />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {email} as an approver?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll stop receiving new requests for {flowLabel} and
            won&apos;t see new ones in their inbox. Pending requests that
            already designated them as primary or secondary stay in their inbox
            until resolved — revocation only affects future teacher submissions.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={submitting}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
          >
            {submitting ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
