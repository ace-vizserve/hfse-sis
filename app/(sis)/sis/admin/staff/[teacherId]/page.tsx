import { BookOpen, CalendarClock, RefreshCw, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AssignmentReliefControl } from '@/components/sis/assignment-relief-control';
import {
  coverBadgeClass,
  formatCoverDate,
  formatCoverWindow,
  reliefStatus,
} from '@/lib/relief/display';
import { SisEmptyState } from '@/components/sis/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getTeacherList } from '@/lib/auth/staff-list';
import { getTeacherDetail } from '@/lib/sis/teacher-detail';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// The classes this teacher holds — and, on each row, who is standing in on it.
//
// This is where cover is arranged. "Ms Koh is away" is a statement about a
// PERSON, and this page is the only place that lists everything one person
// holds, so the five decisions it produces are five rows here. The same control
// appears on a class's own Teachers tab for the other direction.
//
// Session, role and staff.read are guarded by the layout.
export default async function TeacherClassesPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  // Deduped with the layout's call — one round trip between them.
  const [teacher, allTeachers, capabilities] = await Promise.all([
    getTeacherDetail(teacherId, ayCode),
    getTeacherList(),
    getSessionUser().then((u) =>
      u?.role ? getCapabilitiesForRole(u.role) : []
    ),
  ]);
  if (!teacher) notFound();

  // Arranging cover is narrower than editing assignments: the academic
  // coordinator staffs the year, a school admin decides who stands in.
  const canManageRelief = can(capabilities, 'staff.manage_relief');
  const reliefOptions = allTeachers.map((t) => ({ id: t.id, name: t.name }));

  const formClasses = teacher.classes.filter((c) => c.role === 'form_adviser');
  const subjectClasses = teacher.classes.filter(
    (c) => c.role === 'subject_teacher'
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Form class
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCheck className="size-4" />
              </div>
              Writes the report card comments
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {formClasses.length === 0 ? (
            <SisEmptyState
              icon={UserCheck}
              title="No form class this year"
              body={`${teacher.name} teaches subjects but does not run a form class, so there are no report card comments or write-ups for them to do.`}
            />
          ) : (
            <div className="divide-y divide-border">
              {formClasses.map((c) => (
                <ClassRow
                  key={c.assignmentId}
                  row={c}
                  teacherId={teacher.userId}
                  teacherName={teacher.name}
                  reliefOptions={reliefOptions}
                  canManageRelief={canManageRelief}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {subjectClasses.length}{' '}
            {subjectClasses.length === 1 ? 'class' : 'classes'}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <BookOpen className="size-4" />
              </div>
              Subject classes
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subjectClasses.length === 0 ? (
            <SisEmptyState
              icon={BookOpen}
              title="No subject classes this year"
              body={`Nobody has assigned ${teacher.name} a subject yet. Add one from the class's own Teachers tab.`}
            />
          ) : (
            <div className="divide-y divide-border">
              {subjectClasses.map((c) => (
                <ClassRow
                  key={c.assignmentId}
                  row={c}
                  teacherId={teacher.userId}
                  teacherName={teacher.name}
                  reliefOptions={reliefOptions}
                  canManageRelief={canManageRelief}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {teacher.coveringForOthers.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Standing in for colleagues
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber">
                  <RefreshCw className="size-4" />
                </div>
                Also covering
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {teacher.coveringForOthers.map((c) => (
                <div
                  key={c.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {c.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For {c.coveredTeacherName}
                    </p>
                  </div>
                  {/* ⚠ "Covering" is a claim about today, and since migration
                      123 a row here can be next week's. The badge reports the
                      window rather than the row's existence — otherwise this
                      teacher reads their own page as though they already have a
                      class they cannot open. */}
                  <Badge
                    variant="outline"
                    className={`h-6 ${coverBadgeClass(reliefStatus(c.startedOn, c.endedOn))}`}
                  >
                    {reliefStatus(c.startedOn, c.endedOn) === 'scheduled' ? (
                      <CalendarClock className="size-3" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    {reliefStatus(c.startedOn, c.endedOn) === 'scheduled'
                      ? `From ${formatCoverDate(c.startedOn)}`
                      : (formatCoverWindow(c.startedOn, c.endedOn) ??
                        'Covering')}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ClassRow({
  row,
  teacherId,
  teacherName,
  reliefOptions,
  canManageRelief,
}: {
  row: Awaited<ReturnType<typeof getTeacherDetail>> extends infer T
    ? T extends { classes: (infer R)[] }
      ? R
      : never
    : never;
  teacherId: string;
  teacherName: string;
  reliefOptions: Array<{ id: string; name: string }>;
  canManageRelief: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          href={`/sis/sections/${row.sectionId}?tab=teachers`}
          className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
        >
          {row.role === 'form_adviser'
            ? row.sectionName
            : `${row.subjectName ?? '—'} · ${row.sectionName}`}
        </Link>
        <p className="text-xs text-muted-foreground">
          {row.role === 'form_adviser' ? 'Form class' : row.levelLabel}
        </p>
      </div>
      {/* Names both people when cover is on. "Being covered" alone would leave
          the reader asking the only question that matters. */}
      <AssignmentReliefControl
        assignmentId={row.assignmentId}
        coveredTeacherId={teacherId}
        coveredTeacherName={teacherName}
        reliefTeacherName={row.cover?.reliefTeacherName ?? null}
        reliefTeacherId={row.cover?.reliefTeacherId ?? null}
        reliefStartedOn={row.cover?.startedOn ?? null}
        reliefEndedOn={row.cover?.endedOn ?? null}
        teacherOptions={reliefOptions}
        canManage={canManageRelief}
      />
    </div>
  );
}
