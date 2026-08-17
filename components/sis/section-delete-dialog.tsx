'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, ApiError } from '@/lib/query/fetcher';
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

// Controlled-only (no own trigger) — embedded in the sections list page's
// per-row ⋯ menu. Undo-an-accidental-creation only: the server guards on
// zero section_students, so this never risks real academic history; the
// confirm copy names that guardrail explicitly rather than the generic
// "this can't be undone" boilerplate, since the boundary itself is the
// reassurance.
export function SectionDeleteDialog({
  sectionId,
  sectionName,
  open,
  onOpenChange,
}: {
  sectionId: string;
  sectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sections/${sectionId}`, { method: 'DELETE' }),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await run(() => deleteMutation.mutateAsync(), {
      pending: `Deleting ${sectionName}…`,
      success: `Deleted ${sectionName}`,
      error: (e) =>
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? ((e.body as { error?: string }).error ?? e.message)
          : e instanceof Error
            ? e.message
            : 'Could not delete this section',
      onResolved: () => onOpenChange(false),
    });
    setBusy(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {sectionName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only allowed because no student has ever been enrolled here —
            deletes the section and anything attached to it (subjects, grading
            sheets, adviser assignment). If a student has already joined this
            section, delete is blocked; use Rename instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void remove();
            }}
            className="gap-1.5"
          >
            {busy ? 'Deleting…' : 'Delete section'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
