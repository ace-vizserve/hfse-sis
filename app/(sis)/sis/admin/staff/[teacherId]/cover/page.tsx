import { CalendarClock, History, RefreshCw } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';

import { SisEmptyState } from '@/components/sis/empty-state';
import { CoverRowActions } from '@/components/sis/cover-row-actions';
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
import { RELIEF_REASON_LABELS } from '@/lib/schemas/assignment-relief';
import { getTeacherDetail } from '@/lib/sis/teacher-detail';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Who is standing in on this teacher's classes, and who has.
//
// Cover is open-ended by design — you end it when the teacher is actually back,
// not when you hoped they would be. That is easy to forget, so what is running
// leads, with how long it has been going.
export default async function TeacherCoverPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser?.role) redirect('/login');
  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  const canManage = can(capabilities, 'staff.manage_relief');

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  const [teacher, allTeachers] = await Promise.all([
    getTeacherDetail(teacherId, ayCode),
    getTeacherList(),
  ]);
  if (!teacher) notFound();

  const running = teacher.classes.filter((c) => c.cover !== null);
  const scheduled = teacher.classes.filter(
    (c) => c.cover === null && c.scheduledCover !== null
  );
  const substitutes = Array.from(
    new Set(running.map((c) => c.cover!.reliefTeacherName))
  );

  return (
    <div className="space-y-4">
      {running.length > 0 && (
        // Advisory, not a hard stop — the reader can act around it, so §7.4's
        // gradient tile rather than §9.4's flat one.
        <div className="flex items-start gap-4 rounded-xl border border-brand-amber/30 bg-brand-amber/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber">
            <RefreshCw className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              {substitutes.length === 1
                ? `${substitutes[0]} is covering ${running.length} of ${teacher.name}'s ${running.length === 1 ? 'class' : 'classes'}.`
                : `${substitutes.length} teachers are covering ${running.length} of ${teacher.name}'s classes.`}
            </p>
            <p className="text-sm text-muted-foreground">
              End each one when {teacher.name} is back. Until then,{' '}
              {teacher.name} stays the teacher of record on every report card
              and mark sheet.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Running now
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber">
                <RefreshCw className="size-4" />
              </div>
              Cover in place
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {running.length === 0 ? (
            <SisEmptyState
              icon={RefreshCw}
              title={
                scheduled.length > 0
                  ? 'Cover is arranged, but has not started yet'
                  : 'Nobody is covering for this teacher'
              }
              body={
                scheduled.length > 0
                  ? `${teacher.name} is still running their own classes today. See "Starting later" below for what has been arranged.`
                  : `${teacher.name} is running all their own classes. If they go on leave, use "Arrange cover" above to hand the classes over.`
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {running.map((c) => (
                <div
                  key={c.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {c.cover!.reliefTeacherName} —{' '}
                      {c.role === 'form_adviser'
                        ? c.sectionName
                        : `${c.subjectName ?? '—'} · ${c.sectionName}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.role === 'form_adviser'
                        ? 'Form class'
                        : 'Subject class'}{' '}
                      ·{' '}
                      {RELIEF_REASON_LABELS[
                        c.cover!.reason as keyof typeof RELIEF_REASON_LABELS
                      ] ?? c.cover!.reason}{' '}
                      · since {formatDay(c.cover!.startedOn)}
                      {c.cover!.notes ? ` · ${c.cover!.notes}` : ''}
                    </p>
                  </div>
                  <CoverRowActions
                    reliefId={c.cover!.reliefId}
                    assignmentId={c.assignmentId}
                    classLabel={
                      c.role === 'form_adviser'
                        ? c.sectionName
                        : `${c.subjectName ?? '—'} · ${c.sectionName}`
                    }
                    currentSubstituteName={c.cover!.reliefTeacherName}
                    currentReason={c.cover!.reason}
                    teacherOptions={allTeachers
                      .filter(
                        (t) =>
                          t.id !== teacher.userId &&
                          t.id !== c.cover!.reliefTeacherId
                      )
                      .map((t) => ({ id: t.id, name: t.name }))}
                    canManage={canManage}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {scheduled.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Starting later
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <CalendarClock className="size-4" />
                </div>
                Arranged, not started
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Not amber. Nothing is happening yet — the class is still with
                its own teacher today, so colouring this the same as live cover
                would say something untrue at a glance. */}
            <div className="divide-y divide-border">
              {scheduled.map((c) => (
                <div
                  key={c.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {c.scheduledCover!.reliefTeacherName} —{' '}
                      {c.role === 'form_adviser'
                        ? c.sectionName
                        : `${c.subjectName ?? '—'} · ${c.sectionName}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Starts {formatDay(c.scheduledCover!.startedOn)} ·{' '}
                      {RELIEF_REASON_LABELS[
                        c.scheduledCover!
                          .reason as keyof typeof RELIEF_REASON_LABELS
                      ] ?? c.scheduledCover!.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="h-6">
                      Not started
                    </Badge>
                    <CoverRowActions
                      reliefId={c.scheduledCover!.reliefId}
                      assignmentId={c.assignmentId}
                      classLabel={
                        c.role === 'form_adviser'
                          ? c.sectionName
                          : `${c.subjectName ?? '—'} · ${c.sectionName}`
                      }
                      currentSubstituteName={
                        c.scheduledCover!.reliefTeacherName
                      }
                      currentReason={c.scheduledCover!.reason}
                      teacherOptions={allTeachers
                        .filter(
                          (t) =>
                            t.id !== teacher.userId &&
                            t.id !== c.scheduledCover!.reliefTeacherId
                        )
                        .map((t) => ({ id: t.id, name: t.name }))}
                      canManage={canManage}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {teacher.pastCover.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Earlier this year
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <History className="size-4" />
                </div>
                Who has run these classes
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {teacher.pastCover.map((c) => (
                <div
                  key={c.reliefId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {c.reliefTeacherName} — {c.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {RELIEF_REASON_LABELS[
                        c.reason as keyof typeof RELIEF_REASON_LABELS
                      ] ?? c.reason}{' '}
                      · {formatDay(c.startedOn)}
                      {c.endedOn ? ` – ${formatDay(c.endedOn)}` : ''}
                    </p>
                  </div>
                  <Badge variant="secondary" className="h-6">
                    Finished
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

/** "12 Aug" — short enough for a line of detail, precise enough to act on. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]}`;
}
