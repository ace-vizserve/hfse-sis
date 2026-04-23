'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, UserCheck, UserCog, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Teacher = { id: string; email: string | null; display_name: string };
type Subject = { id: string; code: string; name: string };
type Assignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
};

// Teachers tab on /sis/sections/[id]. Moved from
// components/admin/teacher-assignments-panel.tsx during the 2026-04-22 SIS
// Admin consolidation sprint — same logic, new home, unchanged exported
// name so callers don't need a rename.
export function TeacherAssignmentsPanel({
  sectionId,
  levelSubjects,
}: {
  sectionId: string;
  levelSubjects: Subject[];
}) {
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<'form_adviser' | 'subject_teacher'>('subject_teacher');
  const [teacherId, setTeacherId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tRes, aRes] = await Promise.all([
        fetch('/api/users/teachers'),
        fetch(`/api/teacher-assignments?section_id=${sectionId}`),
      ]);
      const tBody = await tRes.json();
      const aBody = await aRes.json();
      if (!tRes.ok) throw new Error(tBody.error ?? 'failed to load teachers');
      if (!aRes.ok) throw new Error(aBody.error ?? 'failed to load assignments');
      setTeachers(tBody.teachers ?? []);
      setAssignments(aBody.assignments ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load teacher assignments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [sectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createAssignment() {
    if (!teacherId) {
      toast.error('Pick a teacher');
      return;
    }
    if (role === 'subject_teacher' && !subjectId) {
      toast.error('Pick a subject');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/teacher-assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teacher_user_id: teacherId,
          section_id: sectionId,
          subject_id: role === 'subject_teacher' ? subjectId : null,
          role,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      setTeacherId('');
      setSubjectId('');
      toast.success('Assignment added');
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add assignment');
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher-assignments/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      toast.success('Assignment removed');
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove assignment');
    } finally {
      setBusy(false);
    }
  }

  const teachersById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const subjectsById = useMemo(
    () => new Map(levelSubjects.map((s) => [s.id, s])),
    [levelSubjects],
  );

  const formAdviser = assignments.find((a) => a.role === 'form_adviser');
  const subjectTeachers = assignments
    .filter((a) => a.role === 'subject_teacher')
    .sort((a, b) => {
      const sa = subjectsById.get(a.subject_id ?? '')?.name ?? '';
      const sb = subjectsById.get(b.subject_id ?? '')?.name ?? '';
      return sa.localeCompare(sb);
    });

  return (
    <div className="space-y-5">
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
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div>
                <div className="font-medium text-foreground">
                  {teachersById.get(formAdviser.teacher_user_id)?.display_name ?? '(unknown user)'}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {teachersById.get(formAdviser.teacher_user_id)?.email ??
                    formAdviser.teacher_user_id}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPendingRemoveId(formAdviser.id)}
                disabled={busy}
                aria-label="Remove form adviser"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-5 text-center text-xs text-muted-foreground">
              No form adviser assigned yet. Use the form below to assign one.
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
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-5 text-center text-xs text-muted-foreground">
              No subject teachers assigned yet. Use the form below to assign one.
            </div>
          ) : (
            <ul className="space-y-2">
              {subjectTeachers.map((a) => {
                const t = teachersById.get(a.teacher_user_id);
                const s = subjectsById.get(a.subject_id ?? '');
                return (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {s?.code ?? '—'}
                        </Badge>
                        <span className="font-medium text-foreground">
                          {s?.name ?? '(unknown subject)'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t?.display_name ?? '(unknown user)'}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingRemoveId(a.id)}
                      disabled={busy}
                      aria-label="Remove subject teacher"
                      className="text-muted-foreground hover:text-destructive"
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

      {/* Add assignment */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            New assignment
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Assign a teacher
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <UserCog className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[200px_1fr_1fr]">
            <Field>
              <FieldLabel htmlFor="ta-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as 'form_adviser' | 'subject_teacher')}
              >
                <SelectTrigger id="ta-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subject_teacher">Subject teacher</SelectItem>
                  <SelectItem value="form_adviser">Form class adviser</SelectItem>
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
                      {t.email && t.email !== t.display_name ? ` (${t.email})` : ''}
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
                    <SelectValue placeholder="— pick a subject —" />
                  </SelectTrigger>
                  <SelectContent>
                    {levelSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
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
              <AlertDescription>
                No teacher users found. Create users in the Supabase dashboard and set{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">app_metadata.role</code>{' '}
                to <code className="rounded bg-muted px-1 py-0.5 text-xs">&quot;teacher&quot;</code>
                .
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button
            onClick={createAssignment}
            disabled={busy || !teacherId || (role === 'subject_teacher' && !subjectId)}
            size="sm"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {busy ? 'Adding…' : 'Add assignment'}
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog
        open={pendingRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              The teacher will immediately lose access to this section. You can re-assign them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                const id = pendingRemoveId;
                setPendingRemoveId(null);
                if (id) await removeAssignment(id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
