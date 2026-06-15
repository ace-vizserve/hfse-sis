'use client';

import { GraduationCap, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// First-time class-section assignment for an enrolled applicant whose
// admissions row is missing a classSection (Chunk A backend at
// `app/api/sis/students/[enroleeNumber]/assign-section/route.ts`).
//
// The picker lists candidate sections at the applicant's levelApplied;
// the parent component is responsible for filtering down to the right
// level + including the live activeCount per section. Sections at
// capacity (≥ 50 active) render disabled with a "Full" badge.

export type AssignableSection = {
  id: string;
  name: string;
  activeCount: number;
};

export type AssignSectionDialogProps = {
  enroleeNumber: string;
  studentName: string;
  ayCode: string;
  levelApplied: string | null;
  availableSections: AssignableSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MAX_PER_SECTION = 50;

export function AssignSectionDialog({
  enroleeNumber,
  studentName,
  ayCode,
  levelApplied,
  availableSections,
  open,
  onOpenChange,
}: AssignSectionDialogProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  const sorted = React.useMemo(
    () =>
      [...availableSections]
        .map((s) => ({ ...s, isAtCapacity: s.activeCount >= MAX_PER_SECTION }))
        .sort(
          (a, b) =>
            Number(a.isAtCapacity) - Number(b.isAtCapacity) ||
            a.activeCount - b.activeCount ||
            a.name.localeCompare(b.name)
        ),
    [availableSections]
  );

  const assignMutation = useMutation({
    mutationFn: (sectionId: string) =>
      apiFetch<{ sectionName?: string }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/assign-section?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('POST', { sectionId })
      ),
    onSuccess: (body) => {
      toast.success(
        `Assigned ${studentName} to ${body.sectionName ?? 'their new section'}. Grading access is now active.`
      );
      onOpenChange(false);
      router.refresh();
    },
    onError: (err) => {
      // Preserve the original two-tier error copy: prefer the server's
      // `error` field, else a status-coded fallback; network errors fall back
      // to the generic message.
      if (err instanceof ApiError) {
        const serverError =
          err.body && typeof err.body === 'object'
            ? (err.body as { error?: string }).error
            : undefined;
        toast.error(
          serverError ?? `Couldn't assign the section (${err.status}).`
        );
        return;
      }
      toast.error(
        err instanceof Error ? err.message : "Couldn't assign the section."
      );
    },
  });
  const submitting = assignMutation.isPending;

  function submit() {
    if (!selectedId) return;
    assignMutation.mutate(selectedId);
  }

  const hasOptions = sorted.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <GraduationCap className="size-4 text-brand-indigo" />
            Assign to a class section
          </DialogTitle>
          <DialogDescription>
            {levelApplied ? (
              <>
                Pick a section for <strong>{studentName}</strong> at{' '}
                <strong>{levelApplied}</strong>. Once assigned, the grading
                roster will pick them up automatically.
              </>
            ) : (
              <>
                Pick a section for <strong>{studentName}</strong>. Once
                assigned, the grading roster will pick them up automatically.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {!hasOptions ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No sections available for {levelApplied ?? 'this level'} in{' '}
              {ayCode}. Create a section in{' '}
              <span className="font-mono text-xs">/sis/sections</span> first.
            </p>
          ) : (
            sorted.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.isAtCapacity || submitting}
                onClick={() => setSelectedId(s.id)}
                aria-pressed={selectedId === s.id}
                className={
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ' +
                  (selectedId === s.id
                    ? 'border-brand-indigo bg-accent'
                    : s.isAtCapacity
                      ? 'cursor-not-allowed border-border/60 bg-muted/30 opacity-60'
                      : 'border-border hover:border-brand-indigo-soft hover:bg-accent/40')
                }
              >
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {s.activeCount}/{MAX_PER_SECTION} students
                  </span>
                  {s.isAtCapacity && (
                    <Badge
                      variant="outline"
                      className="border-destructive/40 bg-destructive/10 px-1.5 font-mono text-[9px] uppercase tracking-wider text-destructive"
                    >
                      Full
                    </Badge>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!selectedId || submitting || !hasOptions}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Assign section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
