'use client';

import { useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { AssignmentReliefControl } from '@/components/sis/assignment-relief-control';
import { AssignmentRemovalDialog } from '@/components/sis/assignment-removal-dialog';
import { StaffAvatar } from '@/components/sis/staff-visuals';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { AssignmentChangeReason } from '@/lib/schemas/teacher-assignment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

type Teacher = { id: string; email: string | null; display_name: string };
type Subject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};

// Small inline tag for the examinable / non-examinable axis (KD #95). Numeric
// subjects use the WW+PT+QA pipeline; letter subjects skip the formula and
// render an A/B/C/IP letter per term. The badge lets registrars see at a
// glance which track a subject is on before assigning a teacher to it.
function ExaminableBadge({ isExaminable }: { isExaminable: boolean }) {
  return isExaminable ? (
    <Badge
      variant="secondary"
      className="font-mono text-[10px] uppercase tracking-wider"
    >
      Exam
    </Badge>
  ) : (
    <Badge
      variant="warning"
      className="font-mono text-[10px] uppercase tracking-wider"
    >
      Non-exam
    </Badge>
  );
}
type Assignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
  /** Who is standing in on this class, or null when nobody is. */
  relief_teacher_user_id: string | null;
  /** First day of the cover; null means it started when it was set. */
  relief_started_on: string | null;
  /** Last day of the cover, inclusive; null means open-ended. */
  relief_ended_on: string | null;
};

// Teachers tab on /sis/sections/[id]. Moved from
// components/admin/teacher-assignments-panel.tsx during the 2026-04-22 SIS
// Admin consolidation sprint — same logic, new home, unchanged exported
// name so callers don't need a rename.
export function TeacherAssignmentsPanel({
  sectionId,
  levelSubjects,
  initialTeachers,
  initialAssignments,
  canManageRelief,
  termStarted,
}: {
  sectionId: string;
  levelSubjects: Subject[];
  initialTeachers: Teacher[];
  initialAssignments: Assignment[];
  /** May this user put someone on cover? Narrower than editing assignments. */
  canManageRelief: boolean;
  /** Has the school year begun? If so, a removal has to say why. */
  termStarted: boolean;
}) {
  const [teachers, setTeachers] = useState<Teacher[]>(initialTeachers);
  const [assignments, setAssignments] =
    useState<Assignment[]>(initialAssignments);
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState<'form_adviser' | 'subject_teacher'>(
    'subject_teacher'
  );
  const [teacherId, setTeacherId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  // Two parallel reads to refresh in-component state. Kept inline (no query
  // key) but routed through apiFetch so no raw fetch remains; preserves the
  // original per-response error messages.
  async function load() {
    setLoading(true);
    try {
      const [tBody, aBody] = await Promise.all([
        apiFetch<{ teachers?: Teacher[] }>('/api/users/teachers').catch(() => {
          throw new Error('failed to load teachers');
        }),
        apiFetch<{ assignments?: Assignment[] }>(
          `/api/teacher-assignments?section_id=${sectionId}`
        ).catch(() => {
          throw new Error('failed to load assignments');
        }),
      ]);
      setTeachers(tBody.teachers ?? []);
      setAssignments(aBody.assignments ?? []);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to load teacher assignments'
      );
    } finally {
      setLoading(false);
    }
  }

  // The payload travels as mutation variables rather than being read off state
  // inside onSuccess: state has already been cleared by then, and the toast
  // names a teacher and a subject. Reading it from `vars` means the sentence
  // always describes what was actually sent.
  const createMutation = useMutation({
    mutationFn: (vars: {
      teacher_user_id: string;
      subject_id: string | null;
      role: 'form_adviser' | 'subject_teacher';
    }) =>
      apiFetch(
        '/api/teacher-assignments',
        jsonInit('POST', { ...vars, section_id: sectionId })
      ),
    onError: (e) => {
      toast.error(
        e instanceof Error
          ? e.message
          : 'That teacher could not be assigned. Try again.'
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({
      id,
      reason,
      notes,
    }: {
      id: string;
      reason: AssignmentChangeReason | null;
      notes: string | null;
    }) =>
      apiFetch(
        `/api/teacher-assignments/${id}`,
        jsonInit('DELETE', { change_reason: reason, change_notes: notes })
      ),
  });

  const run = useWriteAction();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const busy = creating || removing;

  function createAssignment() {
    if (!teacherId) {
      toast.error('Choose a teacher first.');
      return;
    }
    if (role === 'subject_teacher' && !subjectId) {
      toast.error('Choose which subject they teach.');
      return;
    }
    // The payload is captured here rather than read back off state inside the
    // resolver: state is cleared by then, and the message names a teacher and
    // a subject, so it would otherwise drift from what was actually sent.
    const vars = {
      teacher_user_id: teacherId,
      subject_id: role === 'subject_teacher' ? subjectId : null,
      role,
    };
    const who =
      teachers.find((t) => t.id === vars.teacher_user_id)?.display_name ??
      'That teacher';

    setCreating(true);
    void run(() => createMutation.mutateAsync(vars), {
      pending: `Assigning ${who}…`,
      // Say who now does what, not that a row was written.
      success:
        vars.role === 'form_adviser'
          ? `${who} is now the form adviser for this class.`
          : `${who} now teaches ${subjectsById.get(vars.subject_id ?? '')?.name ?? 'this subject'} to this class.`,
      error: (e: unknown) =>
        e instanceof Error ? e.message : 'Failed to create assignment',
      onResolved: () => {
        setTeacherId('');
        setSubjectId('');
        setAssignOpen(false);
        void load();
      },
    }).finally(() => setCreating(false));
  }

  async function removeAssignment(
    id: string,
    reason: AssignmentChangeReason | null,
    notes: string | null
  ) {
    setRemoving(true);
    await run(() => removeMutation.mutateAsync({ id, reason, notes }), {
      pending: 'Taking them off this class…',
      success: 'Taken off this class.',
      error: (e: unknown) =>
        e instanceof Error ? e.message : 'Failed to remove assignment',
      // Only closes on success — a failure leaves the dialog open so the
      // reason the user typed isn't lost.
      onResolved: () => {
        setPendingRemoveId(null);
        void load();
      },
    });
    setRemoving(false);
  }

  const teachersById = useMemo(
    () => new Map(teachers.map((t) => [t.id, t])),
    [teachers]
  );
  const subjectsById = useMemo(
    () => new Map(levelSubjects.map((s) => [s.id, s])),
    [levelSubjects]
  );

  const formAdviser = assignments.find((a) => a.role === 'form_adviser');

  // Both "one per class" rules, applied to what the dialog offers rather than
  // left for the save to refuse. A dropdown that lists a subject already taken
  // is an invitation to an error message.
  const takenSubjectIds = new Set(
    assignments
      .filter((a) => a.role === 'subject_teacher' && a.subject_id)
      .map((a) => a.subject_id as string)
  );
  const openSubjects = levelSubjects.filter((s) => !takenSubjectIds.has(s.id));
  const subjectTeachers = assignments
    .filter((a) => a.role === 'subject_teacher')
    .sort((a, b) => {
      const sa = subjectsById.get(a.subject_id ?? '')?.name ?? '';
      const sb = subjectsById.get(b.subject_id ?? '')?.name ?? '';
      return sa.localeCompare(sb);
    });

  return (
    <div className="space-y-5">
      {/* The tab's one primary action (§9.2). It sits above the two lists
          rather than inside either, because it can add to both. */}
      <div className="flex justify-end">
        <Button onClick={() => setAssignOpen(true)}>
          <Plus className="h-4 w-4" />
          Assign a teacher
        </Button>
      </div>

      {/* Form Class Adviser */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Assignment
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Form class adviser
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <UserCheck className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : formAdviser ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <StaffAvatar
                name={
                  teachersById.get(formAdviser.teacher_user_id)?.display_name ??
                  ''
                }
                size={9}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {teachersById.get(formAdviser.teacher_user_id)
                    ?.display_name ?? '(unknown user)'}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {teachersById.get(formAdviser.teacher_user_id)?.email ??
                    formAdviser.teacher_user_id}
                </div>
              </div>
              <AssignmentReliefControl
                assignmentId={formAdviser.id}
                coveredTeacherId={formAdviser.teacher_user_id}
                coveredTeacherName={
                  teachersById.get(formAdviser.teacher_user_id)?.display_name ??
                  'this teacher'
                }
                reliefTeacherName={
                  formAdviser.relief_teacher_user_id
                    ? (teachersById.get(formAdviser.relief_teacher_user_id)
                        ?.display_name ?? 'Someone')
                    : null
                }
                teacherOptions={teachers.map((t) => ({
                  id: t.id,
                  name: t.display_name,
                }))}
                reliefTeacherId={formAdviser.relief_teacher_user_id}
                reliefStartedOn={formAdviser.relief_started_on}
                reliefEndedOn={formAdviser.relief_ended_on}
                canManage={canManageRelief}
                onChanged={load}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPendingRemoveId(formAdviser.id)}
                disabled={busy}
                aria-label="Remove form adviser"
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UserPlus className="size-4" />
              </span>
              <p className="text-xs text-muted-foreground">
                No form adviser assigned yet. Use the form below to assign one.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subject Teachers */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Assignments
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Subject teachers{' '}
            <span className="ml-1 font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
              {subjectTeachers.length}
            </span>
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Users className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : subjectTeachers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <UserPlus className="size-4" />
              </span>
              <p className="text-xs text-muted-foreground">
                No subject teachers assigned yet. Use the form below to assign
                one.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {subjectTeachers.map((a) => {
                const t = teachersById.get(a.teacher_user_id);
                const s = subjectsById.get(a.subject_id ?? '');
                return (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
                  >
                    <StaffAvatar name={t?.display_name ?? ''} size={9} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {s?.code ?? '—'}
                        </Badge>
                        <span className="font-medium text-foreground">
                          {s?.name ?? '(unknown subject)'}
                        </span>
                        {s && (
                          <ExaminableBadge isExaminable={s.is_examinable} />
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t?.display_name ?? '(unknown user)'}
                      </div>
                    </div>
                    <AssignmentReliefControl
                      assignmentId={a.id}
                      coveredTeacherId={a.teacher_user_id}
                      coveredTeacherName={t?.display_name ?? 'this teacher'}
                      reliefTeacherName={
                        a.relief_teacher_user_id
                          ? (teachersById.get(a.relief_teacher_user_id)
                              ?.display_name ?? 'Someone')
                          : null
                      }
                      teacherOptions={teachers.map((x) => ({
                        id: x.id,
                        name: x.display_name,
                      }))}
                      reliefTeacherId={a.relief_teacher_user_id}
                      reliefStartedOn={a.relief_started_on}
                      reliefEndedOn={a.relief_ended_on}
                      canManage={canManageRelief}
                      onChanged={load}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingRemoveId(a.id)}
                      disabled={busy}
                      aria-label="Remove subject teacher"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Assigning is a DIALOG, not a third card sitting under the two lists.
          As a card it was permanent furniture: three dropdowns on screen at all
          times, below the answer they change, on a tab you mostly open to read.
          Behind a button it appears when you want it and gets out of the way
          when you don't — the same shape arranging cover already uses. */}
      <Dialog
        open={assignOpen}
        onOpenChange={(next) => {
          setAssignOpen(next);
          if (next) {
            // The adviser option is hidden once the class has one. Without this
            // reset, someone who assigned an adviser a moment ago reopens the
            // dialog with a Role box showing a choice no longer on the list.
            if (formAdviser) setRole('subject_teacher');
          } else {
            setTeacherId('');
            setSubjectId('');
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif">Assign a teacher</DialogTitle>
            <DialogDescription>
              Give this class a form adviser, or a teacher for one of its
              subjects.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[200px_1fr_1fr]">
            <Field>
              <FieldLabel htmlFor="ta-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) =>
                  setRole(v as 'form_adviser' | 'subject_teacher')
                }
              >
                <SelectTrigger id="ta-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subject_teacher">
                    Subject teacher
                  </SelectItem>
                  {/* A class has one adviser. Once it has one, the only way to
                      change who it is, is to take the current one off — which
                      is a decision with a reason attached, not a dropdown. */}
                  {!formAdviser && (
                    <SelectItem value="form_adviser">
                      Form class adviser
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ta-teacher">Teacher</FieldLabel>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger id="ta-teacher">
                  <SelectValue placeholder="— pick a teacher —" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.display_name}
                      {t.email && t.email !== t.display_name
                        ? ` (${t.email})`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ta-subject">Subject</FieldLabel>
              {role === 'subject_teacher' ? (
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger id="ta-subject">
                    <SelectValue
                      placeholder={
                        openSubjects.length === 0
                          ? 'Every subject already has a teacher'
                          : '— pick a subject —'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {openSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="inline-flex items-center gap-2">
                          <span>{s.name}</span>
                          <ExaminableBadge isExaminable={s.is_examinable} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                  N/A for form adviser
                </div>
              )}
            </Field>
          </div>

          {teachers.length === 0 && !loading && (
            <Alert className="mt-4">
              {/* Was: "create users in the Supabase dashboard and set
                  app_metadata.role". Account creation has been in the UI since
                  KD #87 — that text told a school admin to open a developer
                  console for a job the app already does. */}
              <AlertDescription>
                Nobody has a teacher account yet. Create one on the Staff page,
                then come back and assign them.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={createAssignment}
              disabled={
                busy || !teacherId || (role === 'subject_teacher' && !subjectId)
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {busy ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignmentRemovalDialog
        open={pendingRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null);
        }}
        termStarted={termStarted}
        title="Remove this assignment?"
        description="The teacher will immediately lose access to this class. You can re-assign them later."
        busy={removing}
        onConfirm={async (reason, notes) => {
          const id = pendingRemoveId;
          if (!id) return;
          await removeAssignment(id, reason, notes);
        }}
      />
    </div>
  );
}
