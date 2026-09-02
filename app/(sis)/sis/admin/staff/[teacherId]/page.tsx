import { BookOpen, CalendarClock, RefreshCw, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { AssignmentReliefControl } from '@/components/sis/assignment-relief-control';
import {
  coverBadgeClass,
  formatCoverDate,
  formatCoverWindow,
  reliefStatus,
} from '@/lib/relief/display';
import { SisEmptyState } from '@/components/sis/empty-state';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { TeacherAssignmentEditorButton } from '@/components/sis/teacher-assignment-editor-button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getAssignableStaffList } from '@/lib/auth/staff-list';
import {
  ASSIGNMENT_ROLE_LABELS,
  isAdviserRole,
  isSubjectRole,
} from '@/lib/schemas/teacher-assignment';
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
  searchParams,
}: {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ ay?: string }>;
}) {
  const { teacherId } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  // Same `?ay=` contract as the staff list this page is reached from, so
  // clicking a teacher while looking at AY2025 keeps you in AY2025.
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(),
    listAyCodes(supabase),
  ]);
  const currentAyCode = currentAy?.ay_code;
  if (!currentAyCode) redirect('/sis');

  const ayCode =
    query.ay && ayCodes.includes(query.ay) ? query.ay : currentAyCode;

  // A finished year is a record, not a worksheet. A year still ahead stays
  // editable — staffing next year before it starts is the normal way to do it.
  const viewOnly = ayCode < currentAyCode;

  const [teacher, coverCandidates, capabilities] = await Promise.all([
    getTeacherDetail(teacherId, ayCode),
    // Everyone this page can offer as a substitute. Any staff role, matching
    // what POST /api/relief/book and PATCH /api/teacher-assignments/[id] will
    // accept — teaching admins cover lessons here, and a teacher-only list
    // could not record it.
    getAssignableStaffList(),
    getSessionUser().then((u) =>
      u?.role ? getCapabilitiesForRole(u.role) : []
    ),
  ]);
  if (!teacher) notFound();

  // Arranging cover is narrower than editing assignments: the academic
  // coordinator staffs the year, a school admin decides who stands in.
  //
  // Both are off in a closed year. Cover is a fact about a term that has
  // already run (KD #184) — booking a substitute into last April answers no
  // question anyone has.
  const canManageRelief = !viewOnly && can(capabilities, 'staff.manage_relief');
  const canEditAssignments =
    !viewOnly && can(capabilities, 'staff.edit_assignments');
  const reliefOptions = coverCandidates.map((t) => ({
    id: t.id,
    name: t.name,
  }));

  // Both role families (migration 124). A co-adviser or co-teacher really does
  // hold the class, so dropping them here left a co-teacher's own page empty.
  const formClasses = teacher.classes.filter((c) => isAdviserRole(c.role));
  const subjectClasses = teacher.classes.filter((c) => isSubjectRole(c.role));
  const coveredCount = teacher.classes.filter((c) => c.cover !== null).length;

  const whichYear =
    ayCode === currentAyCode
      ? 'This year'
      : ayCode < currentAyCode
        ? 'Earlier year'
        : 'A year ahead';

  return (
    <div className="space-y-4">
      <SisPageHeader
        group={`Staff · ${whichYear} · ${ayCode}`}
        title={teacher.name}
        description={teacher.email ?? 'No email address on record.'}
        backHref={
          ayCode === currentAyCode
            ? '/sis/admin/staff'
            : `/sis/admin/staff?ay=${ayCode}`
        }
        backLabel="Staff"
        chips={
          <div className="flex flex-wrap items-center gap-2">
            {teacher.coveringForOthers.length > 0 && (
              <Badge
                variant="outline"
                className="h-7 border-brand-amber bg-brand-amber-light px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink"
              >
                <RefreshCw className="mr-1.5 size-3" />
                Covering {teacher.coveringForOthers.length} for others
              </Badge>
            )}
            {viewOnly && (
              <Badge
                variant="outline"
                className="h-7 border-brand-indigo-soft bg-accent px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep"
              >
                View only
              </Badge>
            )}
            <div className="w-[150px]">
              <AySwitcher current={ayCode} options={ayCodes} />
            </div>
          </div>
        }
        actions={
          // Hidden outright in a closed year rather than disabled — a greyed
          // button asks the reader to work out why, and the "View only" badge
          // beside it already answers that once, in words.
          viewOnly ? undefined : (
            <TeacherAssignmentEditorButton
              teacher={{
                userId: teacher.userId,
                name: teacher.name,
                email: teacher.email ?? '',
              }}
              ayCode={ayCode}
              canEdit={canEditAssignments}
            />
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Form classes
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {formClasses.length}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Subject classes
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {subjectClasses.length}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <BookOpen className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        {/* Amber only when it is true. A permanently amber tile reading zero
            teaches the eye to ignore the colour. */}
        <Card
          data-slot="card"
          className={
            coveredCount > 0
              ? 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card'
              : 'bg-gradient-to-t from-primary/5 to-card'
          }
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Being covered
            </CardDescription>
            <CardTitle
              className={`font-serif text-3xl tabular-nums ${coveredCount > 0 ? 'text-brand-amber' : 'text-foreground'}`}
            >
              {coveredCount}
            </CardTitle>
            <CardAction>
              <div
                className={`flex size-9 items-center justify-center rounded-xl ${
                  coveredCount > 0
                    ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
                    : 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
                }`}
              >
                <RefreshCw className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>
      </div>

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
              title={`No form class in ${ayCode}`}
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
              title={`No subject classes in ${ayCode}`}
              body={
                viewOnly
                  ? `${teacher.name} was not assigned a subject in ${ayCode}.`
                  : `Nobody has assigned ${teacher.name} a subject yet. Add one from the class's own Teachers tab.`
              }
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
          {isAdviserRole(row.role)
            ? row.sectionName
            : `${row.subjectName ?? '—'} · ${row.sectionName}`}
        </Link>
        {/* A shared class says so in words. The teacher of record and the
            person sharing it look identical otherwise, and which one you are
            decides whose name reaches the report card. */}
        <p className="text-xs text-muted-foreground">
          {isAdviserRole(row.role) ? 'Form class' : row.levelLabel}
          {row.role === 'co_adviser' || row.role === 'co_teacher'
            ? ` · ${ASSIGNMENT_ROLE_LABELS[row.role]}`
            : ''}
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
