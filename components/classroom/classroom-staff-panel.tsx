import { ArrowUpRight, Users } from 'lucide-react';
import Link from 'next/link';

import { StaffAvatar } from '@/components/sis/staff-visuals';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { SectionStaff } from '@/lib/classroom/staff';
import { formatCoverDate } from '@/lib/relief/display';

// Who runs this class. A directory, not a control panel — assigning happens in
// section setup, and this links there for the one role that can open it rather
// than growing a second copy of that surface.
//
// WHY THE GAPS ARE IN HERE and not in the Health strip above: Mr Ace, 2026-08-21
// — a subject with nobody teaching it reads best on the same line as the
// subject. A separate to-do row would name the problem somewhere other than
// where you look for the answer.
//
// ⚠ THE GAP IS INDIGO, NOT RED. AY2026 has almost no assignments yet, so a
// destructive treatment would paint most classes entirely red on day one and
// stop meaning anything by the second class you opened. Same wording and same
// tone as "Not yet" on the discipline list: outstanding, not alarming.

function Outstanding({ children }: { children: string }) {
  return (
    <span className="font-mono text-xs font-semibold text-brand-indigo-deep">
      {children}
    </span>
  );
}

/**
 * One person, linked to their staff page when the reader can open it.
 *
 * `/sis/admin/staff/[teacherId]` is coordinator-and-above — the same role set
 * `canManage` resolves to — so a teacher gets plain text rather than a link
 * that would bounce them to `/` (KD #173).
 */
function Person({
  name,
  id,
  canManage,
}: {
  name: string;
  id: string | null;
  canManage: boolean;
}) {
  if (!canManage || !id) return <>{name}</>;
  return (
    <Link
      href={`/sis/admin/staff/${id}`}
      className="rounded-sm underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-primary hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {name}
    </Link>
  );
}

/** "Ms Fernandez · Ms Tan covering" — the holder first, always. */
function TeacherName({
  name,
  id,
  covering,
  coveringId,
  scheduledCovering,
  scheduledFrom,
  canManage,
}: {
  name: string;
  id: string | null;
  covering: string | null;
  coveringId: string | null;
  /** Booked to cover, but not yet — they have no access to this class today. */
  scheduledCovering?: string | null;
  scheduledFrom?: string | null;
  canManage: boolean;
}) {
  return (
    <span className="text-sm text-foreground">
      <Person name={name} id={id} canManage={canManage} />
      {covering && (
        <span className="text-muted-foreground">
          {' · '}
          <Person name={covering} id={coveringId} canManage={canManage} />
          {' covering'}
        </span>
      )}
      {/* ⚠ Deliberately NOT the word "covering". This panel answers "who runs
          this class", and somebody who starts next week does not run it yet —
          reading their name as cover would send a coordinator to the wrong
          person today. `from` is the whole distinction, so it is never
          dropped. */}
      {!covering && scheduledCovering && (
        <span className="text-muted-foreground">
          {' · '}
          {scheduledCovering} covers from{' '}
          {formatCoverDate(scheduledFrom) || 'a later date'}
        </span>
      )}
    </span>
  );
}

export function ClassroomStaffPanel({
  sectionId,
  staff,
  canManage,
}: {
  sectionId: string;
  staff: SectionStaff;
  /**
   * Oversight only — the caller decides via `capability === 'oversight'`, which
   * is exactly the role set /sis/sections/[id] gates on, so the link can never
   * dead-end. A teacher gets no link because they cannot open that page.
   */
  canManage: boolean;
}) {
  const withTeacher = staff.subjects.filter((s) => s.teacherName).length;
  const total = staff.subjects.length;

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Staff
        </CardDescription>
        <CardTitle className="font-serif text-[22px]">
          Who runs this class
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Users className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      {/* The adviser sits apart from the subject list because they are not a
          subject — they are the person responsible for the class itself. */}
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-6 py-4">
        <StaffAvatar name={staff.adviserName ?? '?'} size={9} />
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Form adviser
          </p>
          <p className="pt-0.5">
            {staff.adviserName ? (
              <TeacherName
                name={staff.adviserName}
                id={staff.adviserId}
                covering={staff.adviserCoveringName}
                coveringId={staff.adviserCoveringId}
                scheduledCovering={staff.adviserScheduledCoveringName}
                scheduledFrom={staff.adviserScheduledCoverFrom}
                canManage={canManage}
              />
            ) : (
              <Outstanding>Not assigned</Outstanding>
            )}
          </p>
        </div>
      </div>

      {staff.noSubjectsConfigured ? (
        <div className="px-6 py-8 text-center">
          <p className="font-serif text-base font-semibold text-foreground">
            No subjects set up yet
          </p>
          <p className="mx-auto max-w-[44ch] pt-1 text-sm text-muted-foreground">
            {canManage
              ? 'Choose the subjects this class takes in section setup, then assign a teacher to each.'
              : 'The academic coordinator sets which subjects this class takes.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {staff.subjects.map((s) => (
            <li
              key={s.subjectId}
              className="flex items-center justify-between gap-4 px-6 py-3"
            >
              <span className="min-w-0">
                <span className="text-sm font-medium text-foreground">
                  {s.name}
                </span>
                {s.code && (
                  <span className="pl-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {s.code}
                  </span>
                )}
              </span>
              {s.teacherName ? (
                <TeacherName
                  name={s.teacherName}
                  id={s.teacherId}
                  covering={s.coveringName}
                  scheduledCovering={s.scheduledCoveringName}
                  scheduledFrom={s.scheduledCoverFrom}
                  coveringId={s.coveringId}
                  canManage={canManage}
                />
              ) : (
                <Outstanding>No teacher</Outstanding>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {total === 0
            ? 'No subjects'
            : `${withTeacher} of ${total} subject${total === 1 ? '' : 's'} covered`}
        </p>
        {canManage && (
          <Link
            href={`/sis/sections/${sectionId}?tab=teachers`}
            className="group inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Manage teachers
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}
