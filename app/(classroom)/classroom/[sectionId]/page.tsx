import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowUpRight,
  BookOpen,
  CalendarCheck,
  MessageSquare,
  UserX,
  Users,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ClassroomAtRiskPanel,
  ClassroomHealthChecklist,
  type ClassroomHealthRow,
} from '@/components/classroom/classroom-health';
import {
  getRollupForSection,
  getSectionAttendanceSummary,
} from '@/lib/attendance/queries';
import {
  getClassroomHealth,
  selectAtRiskStudents,
  type AtRiskStudent,
} from '@/lib/classroom/health';
import {
  canOpenStudentRecord,
  canReadAttendance,
  canReadWriteups,
} from '@/lib/classroom/scope';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import {
  getSectionRoster,
  getWriteupProgressByTerm,
} from '@/lib/evaluation/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Overview — the class at a glance for the selected term. A compact
// per-term summary + links out to the other tabs; the full roster lives on
// the Students tab. The Health strip below the stat grid (Phase 5) answers
// "what needs doing" for this (section, term) — sourced entirely from
// computePublishReadiness, the same evaluator the report-card publish
// dialog uses, plus a students-at-risk list derived from the attendance
// rollup. See lib/classroom/health.ts for both.

export default async function ClassroomOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  // Belt-and-braces re-check (see the layout for the section-level gate);
  // Overview itself has no RLS-restricted data, but capability drives which
  // stat cards below are meaningful to show.
  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, academic_year:academic_years(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();
  const ayNode = Array.isArray(section.academic_year)
    ? section.academic_year[0]
    : section.academic_year;
  const ayCode = (ayNode as { ay_code: string } | null)?.ay_code ?? null;

  const terms = await getTermsForAy(section.academic_year_id);
  const selectedTermId = resolveSelectedTermId(terms, sp.term_id);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;
  const isT4 = selectedTerm?.term_number === 4;

  const { count: activeCount } = await supabase
    .from('section_students')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn');

  let sheetsCount = 0;
  let lockedCount = 0;
  if (selectedTermId) {
    const { data: sheets } = await supabase
      .from('grading_sheets')
      .select('id, is_locked')
      .eq('section_id', sectionId)
      .eq('term_id', selectedTermId);
    sheetsCount = sheets?.length ?? 0;
    lockedCount = (sheets ?? []).filter((s) => s.is_locked).length;
  }

  const showAttendance = canReadAttendance(capability);
  const showWriteups = canReadWriteups(capability);

  const attendanceSummary =
    showAttendance && selectedTermId
      ? await getSectionAttendanceSummary(sectionId, selectedTermId)
      : null;

  // KD #120/#126 submitted+non-empty predicate is baked into this loader
  // already — see lib/evaluation/queries.ts::getWriteupProgressByTerm.
  const writeupProgress =
    showWriteups && selectedTermId && !isT4
      ? (await getWriteupProgressByTerm(selectedTermId, [sectionId]))[sectionId]
      : null;

  const termQuery = selectedTermId ? `?term_id=${selectedTermId}` : '';

  // ── Health (Phase 5) ──────────────────────────────────────────────────
  // computePublishReadiness — cached, see lib/classroom/health.ts. No term
  // resolvable, or no ay_code (shouldn't happen but guards the cache-tag
  // shape) → skip the strip entirely rather than render a hollow one.
  const readiness =
    selectedTermId && ayCode
      ? await getClassroomHealth(sectionId, selectedTermId, ayCode)
      : null;

  const healthRows: ClassroomHealthRow[] = [];
  if (readiness) {
    // Grading — a class-wide, subject-agnostic signal (not gated by
    // capability: a subject-teacher viewer already sees this same
    // class-wide sheet count on the "Grading sheets" stat card above; RLS
    // restricts per-subject SCORE visibility, not this aggregate). The
    // `no_grading_sheets` hard blocker is the readiness engine's own
    // vacuous-pass-hole signal (KD #139) — reused here so "not started" is
    // never confused with a real "0 missing."
    const noSheetsAtAll = readiness.hardBlockers.some(
      (b) => b.code === 'no_grading_sheets'
    );
    if (noSheetsAtAll) {
      healthRows.push({
        key: 'grading',
        icon: BookOpen,
        title: 'Grading',
        detail: isT4
          ? 'No grading sheets recorded for this class yet.'
          : 'No grading sheets for this term yet.',
        tone: 'info',
        href: `/classroom/${sectionId}/grades${termQuery}`,
      });
    } else {
      const missing = isT4
        ? (readiness.t4_readiness?.missing_annual_count ?? 0) +
          (readiness.t4_readiness?.non_examinable_readiness.missing_count ?? 0)
        : readiness.grading_sheets.total - readiness.grading_sheets.locked;
      healthRows.push({
        key: 'grading',
        icon: BookOpen,
        title: 'Grading',
        detail: isT4
          ? missing === 0
            ? 'All annual grades recorded.'
            : `${missing} annual grade${missing === 1 ? '' : 's'} still missing.`
          : missing === 0
            ? `All ${readiness.grading_sheets.total} sheet${readiness.grading_sheets.total === 1 ? '' : 's'} locked.`
            : `${missing} of ${readiness.grading_sheets.total} sheet${readiness.grading_sheets.total === 1 ? '' : 's'} still open.`,
        tone: missing === 0 ? 'ok' : 'warn',
        href: `/classroom/${sectionId}/grades${termQuery}`,
      });
    }

    // Write-ups — adviser/oversight only (capability gate, non-negotiable
    // per the brief), T1–T3 only. T4 is omitted entirely rather than
    // showing 0-of-N — readiness.evaluations is structurally zeroed on T4
    // (KD #49: no FCA write-up for the final term), so a 0-of-N there would
    // read as "all done" when it actually means "not applicable."
    if (showWriteups && !isT4 && readiness.evaluations.total_active > 0) {
      const missing = readiness.evaluations.missing.length;
      const total = readiness.evaluations.total_active;
      healthRows.push({
        key: 'writeups',
        icon: MessageSquare,
        title: 'Write-ups',
        detail:
          missing === 0
            ? `All ${total} write-up${total === 1 ? '' : 's'} submitted.`
            : `${missing} of ${total} still outstanding.`,
        tone: missing === 0 ? 'ok' : 'warn',
        href: `/classroom/${sectionId}/write-ups${termQuery}`,
      });
    }

    // Attendance gaps — adviser/oversight only. "Missing" here means no
    // rollup recorded yet for that student, not a low attendance rate
    // (that's the separate at-risk list below).
    if (showAttendance && readiness.attendance.total_active > 0) {
      const missing = readiness.attendance.missing.length;
      const total = readiness.attendance.total_active;
      healthRows.push({
        key: 'attendance',
        icon: CalendarCheck,
        title: 'Attendance',
        detail:
          missing === 0
            ? 'Attendance fully recorded for the term so far.'
            : `${missing} of ${total} student${total === 1 ? '' : 's'} missing a recorded rollup.`,
        tone: missing === 0 ? 'ok' : 'warn',
        href: `/classroom/${sectionId}/attendance${termQuery}`,
      });
    }

    // No form adviser — visible to every capability (it's a section-setup
    // fact, not RLS-restricted data). The FIX surface lives in SIS Admin, and
    // who can open it splits exactly on capability: `oversight` is
    // academic_coordinator | school_admin | superadmin, which is precisely the
    // role set /sis/sections/[id] gates on — so the link can never dead-end.
    // Teachers can't go there, so they get the action they actually have
    // (ask the coordinator) rather than a pointer to a page they'd be bounced
    // from. Previously neither group got a link and both were told to "set one
    // from SIS Admin," which was wrong advice for a teacher and a needless
    // dead end for the one person who could act on it.
    if (!readiness.form_adviser.assigned) {
      const canAssignAdviser = capability === 'oversight';
      healthRows.push({
        key: 'adviser',
        icon: UserX,
        title: 'No form adviser assigned',
        detail: canAssignAdviser
          ? 'Report cards and FCA write-ups need one. Assign an adviser in section setup.'
          : 'Report cards and FCA write-ups need one. Ask the academic coordinator to assign one.',
        tone: 'warn',
        href: canAssignAdviser
          ? `/sis/sections/${sectionId}?tab=teachers`
          : undefined,
      });
    }
  }

  // Students at risk — attendance-percentage view, distinct from the
  // "Attendance" completeness row above. null = no rollup data recorded
  // yet this term (hidden entirely by <ClassroomAtRiskPanel>, never shown
  // as a fabricated "0 at risk").
  let atRiskStudents: AtRiskStudent[] | null = null;
  if (showAttendance && selectedTermId) {
    const [rollups, roster] = await Promise.all([
      getRollupForSection(sectionId, selectedTermId),
      getSectionRoster(sectionId, selectedTermId),
    ]);
    if (rollups.length > 0) {
      atRiskStudents = selectAtRiskStudents(
        rollups.map((r) => ({
          sectionStudentId: r.sectionStudentId,
          attendancePct: r.attendancePct,
        })),
        roster.map((r) => ({
          sectionStudentId: r.section_student_id,
          indexNumber: r.index_number,
          studentNumber: r.student_number,
          name: r.student_name,
        }))
      );
    }
  }

  return (
    <div className="space-y-6">
      {selectedTerm && (
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {selectedTerm.label}
          {selectedTerm.is_current ? ' · Current term' : ''}
        </p>
      )}

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @4xl/main:grid-cols-4">
          <LinkStatCard
            description="Students"
            value={(activeCount ?? 0).toLocaleString('en-SG')}
            icon={Users}
            footerTitle="Open the roster"
            footerDetail="Active + late enrollees"
            href={`/classroom/${sectionId}/students${termQuery}`}
          />
          <LinkStatCard
            description="Grading sheets"
            value={sheetsCount.toLocaleString('en-SG')}
            icon={BookOpen}
            footerTitle={
              sheetsCount === 0
                ? 'None yet this term'
                : `${lockedCount} locked, ${sheetsCount - lockedCount} open`
            }
            footerDetail="This term"
            href={`/classroom/${sectionId}/grades${termQuery}`}
          />
          {showAttendance && (
            <LinkStatCard
              description="Attendance"
              value={
                attendanceSummary?.averageAttendancePct != null
                  ? `${attendanceSummary.averageAttendancePct.toFixed(1)}%`
                  : '—'
              }
              icon={CalendarCheck}
              footerTitle={
                attendanceSummary && attendanceSummary.schoolDays > 0
                  ? `${attendanceSummary.schoolDays} school days`
                  : 'No data yet'
              }
              footerDetail="Average, this term"
              href={`/classroom/${sectionId}/attendance${termQuery}`}
            />
          )}
          {showWriteups && (
            <LinkStatCard
              description="Write-ups"
              value={
                isT4
                  ? '—'
                  : `${writeupProgress?.submitted_count ?? 0}/${writeupProgress?.active_count ?? 0}`
              }
              icon={MessageSquare}
              footerTitle={isT4 ? 'No FCA write-up for Term 4' : 'Submitted'}
              footerDetail={isT4 ? 'Final term has no comment' : 'This term'}
              href={`/classroom/${sectionId}/write-ups${termQuery}`}
            />
          )}
        </div>
      </div>

      <ClassroomHealthChecklist rows={healthRows} />
      <ClassroomAtRiskPanel
        students={atRiskStudents}
        canOpenRecord={canOpenStudentRecord(capability)}
      />
    </div>
  );
}

function LinkStatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
  href,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block transition-all hover:-translate-y-0.5 focus-visible:outline-none"
    >
      <Card className="@container/card h-full transition-all group-hover:border-brand-indigo/40 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-indigo/40">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {description}
          </CardDescription>
          <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
            {value}
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <p className="inline-flex items-center gap-1 font-medium text-foreground">
            {footerTitle}
            <ArrowUpRight className="size-3 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
          </p>
          <p className="text-xs text-muted-foreground">{footerDetail}</p>
        </CardFooter>
      </Card>
    </Link>
  );
}
