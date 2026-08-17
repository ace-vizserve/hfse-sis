'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';

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
};

type SubjectAssignment = {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
};

type SheetData = {
  fcaAssignments: FcaAssignment[];
  subjectAssignments: SubjectAssignment[];
  allSections: Section[];
  allSubjects: Subject[];
  /** Has this AY's first term begun? If so, a removal has to say why. */
  termStarted: boolean;
};

// What the confirm dialog is currently asking about. The adviser path carries
// the section being moved to, because confirming runs a remove-then-assign
// sequence rather than a plain delete.
// Both kinds now carry the row being removed. The form-adviser variant used to
// carry `targetSectionId` — the section being moved TO — because changing the
// adviser was one delete-then-create action. Adding and removing are separate
// now, so removal only ever needs to know what is going.
type PendingRemoval = {
  kind: 'subject' | 'fca';
  assignmentId: string;
  label: string;
};

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
  const run = useWriteAction();
  // One flag for all four writes — the sheet disables every control while any
  // of them is in flight, and they are mutually exclusive in practice.
  const [mutating, setMutating] = useState(false);
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [newFcaSectionId, setNewFcaSectionId] = useState('');
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
  // Form classes are a LIST, added and removed one at a time — not a single
  // dropdown that swaps one for another.
  //
  // The unique index behind them is on `(section_id)` alone (migration 003):
  // it enforces one adviser PER SECTION and says nothing about how many
  // sections a teacher may advise. The old single Select could not express
  // that, and its "change" path deleted whichever adviser row it happened to
  // be holding — so a two-class adviser lost one silently.
  //
  // Splitting it into add and remove also retires a fragile delete-then-create
  // sequence whose second half could fail after the first had succeeded.
  const addFcaMutation = useMutation({
    mutationFn: (sectionId: string) =>
      apiFetch<{ assignment?: { id: string } }>(
        '/api/teacher-assignments',
        jsonInit('POST', {
          teacher_user_id: teacher!.userId,
          section_id: sectionId,
          role: 'form_adviser',
        })
      ),
  });

  async function addFca(sectionId: string) {
    const section = data?.allSections.find((s) => s.id === sectionId);
    setMutating(true);
    await run(() => addFcaMutation.mutateAsync(sectionId), {
      pending: 'Adding form class…',
      success: 'Form class added',
      // The POST route turns the unique-index violation into "This section
      // already has a form adviser. Remove the existing one first."
      error: (err: unknown) => apiErrorField(err) ?? 'Failed to add form class',
      onResolved: (json) => {
        setData((d) =>
          d
            ? {
                ...d,
                fcaAssignments: [
                  ...d.fcaAssignments,
                  {
                    id: json.assignment!.id,
                    sectionId,
                    sectionName: section?.name ?? '',
                  },
                ].sort((x, y) => x.sectionName.localeCompare(y.sectionName)),
              }
            : d
        );
        setNewFcaSectionId('');
      },
    });
    setMutating(false);
  }

  const removeFcaMutation = useMutation({
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
  });

  async function removeFca(vars: {
    assignmentId: string;
    reason: AssignmentChangeReason | null;
    notes: string | null;
  }) {
    setMutating(true);
    await run(() => removeFcaMutation.mutateAsync(vars), {
      pending: 'Removing form class…',
      success: 'Form class removed',
      error: (err: unknown) =>
        apiErrorField(err) ?? 'Failed to remove form class',
      // Only closes on success — the dialog stays open on failure so the
      // typed reason survives.
      onResolved: () => {
        setPendingRemoval(null);
        setData((d) =>
          d
            ? {
                ...d,
                fcaAssignments: d.fcaAssignments.filter(
                  (a) => a.id !== vars.assignmentId
                ),
              }
            : d
        );
      },
    });
    setMutating(false);
  }

  function handleRemoveFca(assignmentId: string) {
    const assignment = data?.fcaAssignments.find((a) => a.id === assignmentId);
    setPendingRemoval({
      kind: 'fca',
      assignmentId,
      label: assignment?.sectionName ?? 'this form class',
    });
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
  });

  async function removeSubject(vars: {
    assignmentId: string;
    reason: AssignmentChangeReason | null;
    notes: string | null;
  }) {
    setMutating(true);
    await run(() => removeSubjectMutation.mutateAsync(vars), {
      pending: 'Removing subject assignment…',
      // This one reported NOTHING on success before — the row simply vanished
      // from the list. It says so now, like its form-class sibling above.
      success: 'Subject assignment removed',
      error: (err: unknown) =>
        apiErrorField(err) ?? 'Failed to remove assignment',
      // Only closes on success — the dialog stays open on failure so the
      // typed reason survives.
      onResolved: () => {
        setPendingRemoval(null);
        setData((d) =>
          d
            ? {
                ...d,
                subjectAssignments: d.subjectAssignments.filter(
                  (a) => a.id !== vars.assignmentId
                ),
              }
            : d
        );
      },
    });
    setMutating(false);
  }

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
  });

  async function handleAddSubject() {
    if (!teacher || !data || !newSubjectId || !newSectionId) return;
    const subjectId = newSubjectId;
    const sectionId = newSectionId;
    const subject = data.allSubjects.find((s) => s.id === subjectId);
    const section = data.allSections.find((s) => s.id === sectionId);

    setMutating(true);
    await run(() => addSubjectMutation.mutateAsync(), {
      pending: 'Adding subject assignment…',
      success: 'Subject assignment added',
      error: (err: unknown) => apiErrorField(err) ?? 'Failed to add subject',
      onResolved: (json) => {
        setData((d) =>
          d
            ? {
                ...d,
                subjectAssignments: [
                  ...d.subjectAssignments,
                  {
                    id: json.assignment!.id,
                    subjectId,
                    subjectCode: subject?.code ?? '',
                    subjectName: subject?.name ?? '',
                    sectionId,
                    sectionName: section?.name ?? '',
                  },
                ],
              }
            : d
        );
        setNewSubjectId('');
        setNewSectionId('');
      },
    });
    setMutating(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const sectionsByLevel = data ? groupByLevel(data.allSections) : {};
  const levelCodes = Object.keys(sectionsByLevel).sort();

  // Removal copy is now the same shape for both kinds — adding a form class is
  // its own action, so a removal is only ever a removal. The old "move adviser"
  // wording existed because changing the adviser was delete-then-create.
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
            {/* Form classes ------------------------------------------------ */}
            <section className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Form Classes
              </p>

              {data.fcaAssignments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Not a form class adviser this year.
                </p>
              )}

              {data.fcaAssignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm font-medium">{a.sectionName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={mutating}
                    onClick={() => handleRemoveFca(a.id)}
                    aria-label={`Remove ${a.sectionName}`}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}

              {/* A list plus an add, not a dropdown that swaps one for
                  another. One section has one adviser; one adviser may have
                  several sections. Sections that already have an adviser stay
                  in the list and are refused by the server with a message
                  naming the reason — hiding them would leave the admin
                  wondering where a class went. */}
              <div className="flex gap-2">
                <Select
                  value={newFcaSectionId}
                  onValueChange={setNewFcaSectionId}
                  disabled={mutating}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Add a form class" />
                  </SelectTrigger>
                  <SelectContent>
                    {levelCodes.map((lc) => (
                      <SelectGroup key={lc}>
                        <SelectLabel>{lc}</SelectLabel>
                        {sectionsByLevel[lc]!.filter(
                          (sec) =>
                            !data.fcaAssignments.some(
                              (a) => a.sectionId === sec.id
                            )
                        ).map((sec) => (
                          <SelectItem key={sec.id} value={sec.id}>
                            {sec.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={mutating || !newFcaSectionId}
                  onClick={() => void addFca(newFcaSectionId)}
                  aria-label="Add form class"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
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
            ? 'Remove this form class?'
            : 'Remove this subject?'
        }
        description={
          pendingRemoval?.kind === 'fca'
            ? `${pendingRemoval.label} will have no form class adviser until someone is assigned, so nobody will be able to write its report card comments.`
            : `${teacher?.name ?? 'This teacher'} will lose access to ${
                pendingRemoval?.label ?? 'this subject'
              }. Their marks stay on the class.`
        }
        confirmLabel="Remove"
        busy={mutating}
        onConfirm={(reason, notes) => {
          if (!pendingRemoval) return;
          if (pendingRemoval.kind === 'fca') {
            void removeFca({
              assignmentId: pendingRemoval.assignmentId,
              reason,
              notes,
            });
          } else {
            void removeSubject({
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
