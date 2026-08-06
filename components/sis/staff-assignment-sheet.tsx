'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { AssignmentRemovalDialog } from '@/components/sis/assignment-removal-dialog';
import type { AssignmentChangeReason } from '@/lib/schemas/teacher-assignment';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// ── Types ────────────────────────────────────────────────────────────────────

type Section = { id: string; name: string; levelCode: string };
type Subject = { id: string; code: string; name: string };

type FcaAssignment = {
  id: string;
  sectionId: string;
  sectionName: string;
} | null;

type SubjectAssignment = {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
};

type SheetData = {
  fcaAssignment: FcaAssignment;
  subjectAssignments: SubjectAssignment[];
  allSections: Section[];
  allSubjects: Subject[];
  /** Has this AY's first term begun? If so, a removal has to say why. */
  termStarted: boolean;
};

// What the confirm dialog is currently asking about. The adviser path carries
// the section being moved to, because confirming runs a remove-then-assign
// sequence rather than a plain delete.
type PendingRemoval =
  | { kind: 'subject'; assignmentId: string; label: string }
  | { kind: 'fca'; targetSectionId: string };

export type StaffSheetTeacher = {
  userId: string;
  name: string;
  email: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByLevel(sections: Section[]): Record<string, Section[]> {
  return sections.reduce<Record<string, Section[]>>((acc, s) => {
    (acc[s.levelCode] ??= []).push(s);
    return acc;
  }, {});
}

// ── Component ────────────────────────────────────────────────────────────────

export function StaffAssignmentSheet({
  teacher,
  ayCode,
  open,
  onOpenChange,
}: {
  teacher: StaffSheetTeacher | null;
  ayCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newSectionId, setNewSectionId] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(
    null
  );

  // Fetch on open; reset on close. Read (no query key) routed through apiFetch.
  useEffect(() => {
    if (!open || !teacher) {
      setData(null);
      setNewSubjectId('');
      setNewSectionId('');
      return;
    }
    setLoading(true);
    apiFetch<SheetData>(
      `/api/teacher-assignments/by-teacher?teacherId=${encodeURIComponent(teacher.userId)}&ayCode=${encodeURIComponent(ayCode)}`
    )
      .then((json) => setData(json))
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, [open, teacher, ayCode]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  // Reads a server `error` field off an ApiError body, else undefined.
  function apiErrorField(err: unknown): string | undefined {
    return err instanceof ApiError && err.body && typeof err.body === 'object'
      ? (err.body as { error?: string }).error
      : undefined;
  }

  // FCA change is a DELETE-then-POST sequence (clear existing, then assign the
  // new section). Sequencing + per-step error copy preserved; the local-state
  // update + success toast happen on the resolved result.
  const fcaMutation = useMutation({
    mutationFn: async ({
      sectionId,
      reason,
      notes,
    }: {
      sectionId: string;
      reason: AssignmentChangeReason | null;
      notes: string | null;
    }): Promise<
      | { kind: 'cleared' }
      | { kind: 'assigned'; assignmentId: string; sectionId: string }
    > => {
      // Remove existing FCA if present. Tag a failure so onError can show the
      // 'Failed to remove existing FCA' copy distinctly.
      if (data!.fcaAssignment) {
        try {
          await apiFetch(
            `/api/teacher-assignments/${data!.fcaAssignment.id}`,
            jsonInit('DELETE', { change_reason: reason, change_notes: notes })
          );
        } catch (err) {
          throw new ApiError(
            err instanceof ApiError ? err.status : 0,
            err instanceof ApiError ? err.body : undefined,
            apiErrorField(err) ?? 'Failed to remove existing FCA'
          );
        }
      }

      if (sectionId === '__none__') {
        return { kind: 'cleared' };
      }

      const json = await apiFetch<{ assignment?: { id: string } }>(
        '/api/teacher-assignments',
        jsonInit('POST', {
          teacher_user_id: teacher!.userId,
          section_id: sectionId,
          role: 'form_adviser',
        })
      ).catch((err) => {
        throw new ApiError(
          err instanceof ApiError ? err.status : 0,
          err instanceof ApiError ? err.body : undefined,
          apiErrorField(err) ?? 'Failed to save FCA'
        );
      });
      return {
        kind: 'assigned',
        assignmentId: json.assignment!.id,
        sectionId,
      };
    },
    onSuccess: (result) => {
      setPendingRemoval(null);
      if (result.kind === 'cleared') {
        setData((d) => (d ? { ...d, fcaAssignment: null } : d));
        toast.success('FCA assignment cleared');
        router.refresh();
        return;
      }
      const sectionName =
        data!.allSections.find((s) => s.id === result.sectionId)?.name ?? '';
      setData((d) =>
        d
          ? {
              ...d,
              fcaAssignment: {
                id: result.assignmentId,
                sectionId: result.sectionId,
                sectionName,
              },
            }
          : d
      );
      toast.success('FCA assignment saved');
      router.refresh();
    },
    onError: (err) => {
      // The mutationFn already normalized the per-step message onto err.message.
      toast.error(err instanceof Error ? err.message : 'Failed to save FCA');
    },
  });

  // Changing the adviser removes the old assignment before creating the new
  // one, so mid-year it has to be explained just like a plain removal. Ask
  // first, then run the sequence. Clearing to "no class" is the same story.
  function handleFcaChange(sectionId: string) {
    if (!teacher || !data) return;
    if (data.termStarted && data.fcaAssignment) {
      setPendingRemoval({ kind: 'fca', targetSectionId: sectionId });
      return;
    }
    fcaMutation.mutate({ sectionId, reason: null, notes: null });
  }

  const removeSubjectMutation = useMutation({
    mutationFn: ({
      assignmentId,
      reason,
      notes,
    }: {
      assignmentId: string;
      reason: AssignmentChangeReason | null;
      notes: string | null;
    }) =>
      apiFetch(
        `/api/teacher-assignments/${assignmentId}`,
        jsonInit('DELETE', { change_reason: reason, change_notes: notes })
      ),
    onSuccess: (_data, { assignmentId }) => {
      setPendingRemoval(null);
      setData((d) =>
        d
          ? {
              ...d,
              subjectAssignments: d.subjectAssignments.filter(
                (a) => a.id !== assignmentId
              ),
            }
          : d
      );
      router.refresh();
    },
    onError: (err) => {
      // Dialog stays open so the typed reason survives a failure.
      toast.error(apiErrorField(err) ?? 'Failed to remove assignment');
    },
  });

  function handleRemoveSubject(assignmentId: string) {
    const assignment = data?.subjectAssignments.find(
      (a) => a.id === assignmentId
    );
    setPendingRemoval({
      kind: 'subject',
      assignmentId,
      label: assignment
        ? `${assignment.subjectName} · ${assignment.sectionName}`
        : 'this subject',
    });
  }

  const addSubjectMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ assignment?: { id: string } }>(
        '/api/teacher-assignments',
        jsonInit('POST', {
          teacher_user_id: teacher!.userId,
          section_id: newSectionId,
          subject_id: newSubjectId,
          role: 'subject_teacher',
        })
      ),
    onSuccess: (json) => {
      const subject = data!.allSubjects.find((s) => s.id === newSubjectId);
      const section = data!.allSections.find((s) => s.id === newSectionId);
      setData((d) =>
        d
          ? {
              ...d,
              subjectAssignments: [
                ...d.subjectAssignments,
                {
                  id: json.assignment!.id,
                  subjectId: newSubjectId,
                  subjectCode: subject?.code ?? '',
                  subjectName: subject?.name ?? '',
                  sectionId: newSectionId,
                  sectionName: section?.name ?? '',
                },
              ],
            }
          : d
      );
      setNewSubjectId('');
      setNewSectionId('');
      toast.success('Subject assignment added');
      router.refresh();
    },
    onError: (err) => {
      toast.error(apiErrorField(err) ?? 'Failed to add subject');
    },
  });

  function handleAddSubject() {
    if (!teacher || !data || !newSubjectId || !newSectionId) return;
    addSubjectMutation.mutate();
  }

  const mutating =
    fcaMutation.isPending ||
    removeSubjectMutation.isPending ||
    addSubjectMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  const sectionsByLevel = data ? groupByLevel(data.allSections) : {};
  const levelCodes = Object.keys(sectionsByLevel).sort();

  // Moving an adviser to another class and taking them off one entirely are the
  // same operation underneath, but they are not the same thing to the person
  // doing it — so name each one for what it does.
  const fcaTargetName =
    pendingRemoval?.kind === 'fca' &&
    pendingRemoval.targetSectionId !== '__none__'
      ? (data?.allSections.find((s) => s.id === pendingRemoval.targetSectionId)
          ?.name ?? null)
      : null;
  const fcaDialogCopy = fcaTargetName
    ? {
        title: 'Move this form class adviser?',
        description: `${teacher?.name ?? 'This teacher'} will take over ${fcaTargetName} and leave ${data?.fcaAssignment?.sectionName ?? 'their current class'}.`,
        confirmLabel: 'Move adviser',
      }
    : {
        title: 'Remove this form class adviser?',
        description: `${data?.fcaAssignment?.sectionName ?? 'This class'} will have no form class adviser until someone is assigned.`,
        confirmLabel: 'Remove',
      };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight">
            {teacher?.name ?? '—'}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {teacher?.email}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <div className="mt-6 space-y-8">
            {/* FCA Section -------------------------------------------------- */}
            <section className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Form Class Adviser
              </p>
              <Select
                value={data.fcaAssignment?.sectionId ?? '__none__'}
                onValueChange={(v) => void handleFcaChange(v)}
                disabled={mutating}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {levelCodes.map((lc) => (
                    <SelectGroup key={lc}>
                      <SelectLabel>{lc}</SelectLabel>
                      {sectionsByLevel[lc]!.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <Separator />

            {/* Subject Teaching ---------------------------------------------- */}
            <section className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Subject Teaching
              </p>

              {data.subjectAssignments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No subjects assigned.
                </p>
              )}

              <ul className="space-y-2">
                {data.subjectAssignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2"
                  >
                    <span className="text-sm">
                      <span className="font-mono text-xs font-semibold text-brand-indigo-deep">
                        {a.subjectCode}
                      </span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      {a.sectionName}
                    </span>
                    <button
                      type="button"
                      disabled={mutating}
                      onClick={() => void handleRemoveSubject(a.id)}
                      aria-label={`Remove ${a.subjectCode} in ${a.sectionName}`}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Add form */}
              <div className="flex items-center gap-2 pt-1">
                <Select
                  value={newSubjectId}
                  onValueChange={setNewSubjectId}
                  disabled={mutating}
                >
                  <SelectTrigger className="flex-1 text-sm">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.allSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={newSectionId}
                  onValueChange={setNewSectionId}
                  disabled={mutating}
                >
                  <SelectTrigger className="flex-1 text-sm">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>
                    {levelCodes.map((lc) => (
                      <SelectGroup key={lc}>
                        <SelectLabel>{lc}</SelectLabel>
                        {sectionsByLevel[lc]!.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="icon"
                  variant="outline"
                  disabled={mutating || !newSubjectId || !newSectionId}
                  onClick={() => void handleAddSubject()}
                  aria-label="Add subject assignment"
                >
                  {mutating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>

      <AssignmentRemovalDialog
        open={pendingRemoval !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRemoval(null);
        }}
        termStarted={data?.termStarted ?? false}
        title={
          pendingRemoval?.kind === 'fca'
            ? fcaDialogCopy.title
            : 'Remove this subject?'
        }
        description={
          pendingRemoval?.kind === 'fca'
            ? fcaDialogCopy.description
            : `${teacher?.name ?? 'This teacher'} will lose access to ${
                pendingRemoval?.kind === 'subject'
                  ? pendingRemoval.label
                  : 'this subject'
              }. Their marks stay on the class.`
        }
        confirmLabel={
          pendingRemoval?.kind === 'fca' ? fcaDialogCopy.confirmLabel : 'Remove'
        }
        busy={mutating}
        onConfirm={(reason, notes) => {
          if (!pendingRemoval) return;
          if (pendingRemoval.kind === 'fca') {
            fcaMutation.mutate({
              sectionId: pendingRemoval.targetSectionId,
              reason,
              notes,
            });
          } else {
            removeSubjectMutation.mutate({
              assignmentId: pendingRemoval.assignmentId,
              reason,
              notes,
            });
          }
        }}
      />
    </Sheet>
  );
}
