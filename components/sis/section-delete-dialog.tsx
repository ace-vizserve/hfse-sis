'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  const router = useRouter();

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sections/${sectionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`Deleted ${sectionName}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      const message =
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? ((e.body as { error?: string }).error ?? e.message)
          : e instanceof Error
            ? e.message
            : 'Could not delete this section';
      toast.error(message);
    },
  });
  const busy = deleteMutation.isPending;

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
              deleteMutation.mutate();
            }}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Delete section
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
