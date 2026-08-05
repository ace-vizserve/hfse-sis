'use client';

import { GraduationCap, Loader2, Plus } from 'lucide-react';
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
import { NewSectionButton } from '@/components/markbook/new-section-button';
import { LateEnrolleePrompt } from '@/components/sis/late-enrollee-prompt';
import type { MidTermPayload } from '@/lib/sis/placement-completion';
import {
  MAX_ACTIVE_PER_SECTION,
  type AssignableLevel,
  type AssignableSection,
} from '@/lib/sis/class-assignment';

// First-time class-section assignment for an enrolled applicant whose
// admissions row is missing a classSection (Chunk A backend at
// `app/api/sis/students/[enroleeNumber]/assign-section/route.ts`).
//
// The picker lists candidate sections at the applicant's levelApplied;
// the parent component is responsible for filtering down to the right
// level + including the live activeCount per section. Sections at
// capacity (≥ 50 active) render disabled with a "Full" badge.

export type { AssignableSection };

export type AssignSectionDialogProps = {
  enroleeNumber: string;
  studentName: string;
  ayCode: string;
  level: AssignableLevel | null;
  availableSections: AssignableSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AssignSectionDialog({
  enroleeNumber,
  studentName,
  ayCode,
  level,
  availableSections,
  open,
  onOpenChange,
}: AssignSectionDialogProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  // Set when the student turns out to be joining after the year began; the
  // dialog then shows the late-enrollee prompt instead of closing.
  const [pendingMidTerm, setPendingMidTerm] =
    React.useState<MidTermPayload | null>(null);
  const [localSections, setLocalSections] = React.useState(availableSections);
  React.useEffect(() => {
    setLocalSections(availableSections);
  }, [availableSections]);

  React.useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setPendingMidTerm(null);
    }
  }, [open]);

  const sorted = React.useMemo(
    () =>
      [...localSections]
        .map((s) => ({
          ...s,
          isAtCapacity: s.activeCount >= MAX_ACTIVE_PER_SECTION,
        }))
        .sort(
          (a, b) =>
            Number(a.isAtCapacity) - Number(b.isAtCapacity) ||
            a.activeCount - b.activeCount ||
            a.name.localeCompare(b.name)
        ),
    [localSections]
  );

  const assignMutation = useMutation({
    mutationFn: (sectionId: string) =>
      apiFetch<{
        sectionName?: string;
        midTermEnrolment?: MidTermPayload | null;
      }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/assign-section?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('POST', { sectionId })
      ),
    onSuccess: (body) => {
      const where = body.sectionName ?? 'their new class';
      const late = body.midTermEnrolment;
      toast.success(
        // Don't promise a start date we're about to let them change — the
        // late-enrollee prompt can move it forward to a later term's first day.
        late
          ? `Assigned ${studentName} to ${where}. Grading access is now active.`
          : `Assigned ${studentName} to ${where}. Grading access is now active and attendance starts today.`
      );
      // Swap this dialog's body to the prompt rather than opening a second one.
      if (late?.sectionId) {
        setPendingMidTerm(late);
        return;
      }
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

  if (pendingMidTerm) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <LateEnrolleePrompt
            payload={pendingMidTerm}
            onDone={() => {
              setPendingMidTerm(null);
              onOpenChange(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <GraduationCap className="size-4 text-brand-indigo" />
            Assign to a class
          </DialogTitle>
          <DialogDescription>
            {level?.label ? (
              <>
                Pick a class for <strong>{studentName}</strong> at{' '}
                <strong>{level.label}</strong>. Once assigned they join the
                roster, and their attendance starts.
              </>
            ) : (
              <>
                Pick a class for <strong>{studentName}</strong>. Once assigned
                they join the roster, and their attendance starts.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {!hasOptions ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              There are no classes at {level?.label ?? 'this level'} in {ayCode}{' '}
              yet. Create one under SIS Admin → Section setup, then come back.
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
                    {s.activeCount}/{MAX_ACTIVE_PER_SECTION} students
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

        {level && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={submitting}
              className="w-full"
            >
              <Plus className="size-3.5" />
              Create a new section for {level.label}
            </Button>
            <NewSectionButton
              levels={[
                {
                  id: level.id,
                  code: level.code,
                  label: level.label,
                  level_type: level.levelType,
                },
              ]}
              ayCode={ayCode}
              open={createOpen}
              onOpenChange={setCreateOpen}
              initialLevelId={level.id}
              onCreated={(section) => {
                setLocalSections((prev) => [
                  ...prev,
                  { id: section.id, name: section.name, activeCount: 0 },
                ]);
                setSelectedId(section.id);
              }}
            />
          </>
        )}

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
