import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, UserCheck, UserMinus, Users } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { getTeacherList } from '@/lib/auth/staff-list';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GenerateIndexButton } from '@/components/sis/generate-index-button';
import {
  SectionSubjectsPanel,
  type SectionSubjectChip,
} from '@/components/sis/section-subjects-panel';
import { sgToday } from '@/lib/dates';
import { hasTermStarted } from '@/lib/sis/current-term';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { HubStat } from '@/components/sis/hub-stat';
import { SectionRenameDialog } from '@/components/sis/section-rename-dialog';
import { SectionScheduleDialog } from '@/components/sis/section-schedule-dialog';
import { SectionTrackDialog } from '@/components/sis/section-track-dialog';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { TeacherAssignmentsPanel } from '@/components/sis/section-teachers-tab';
import {
  SectionRosterTable,
  type SectionRosterRow,
} from '@/components/sis/section-roster-table';
import type { SiblingSection } from '@/components/sis/section-transfer-dialog';
import {
  SCHEDULE_LABELS,
  type Schedule,
  type SectionClassType,
} from '@/lib/schemas/section';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type EnrolmentLite = {
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
};

// SIS Admin section detail. Tabs: Overview + Teachers.
// Bite 4 (2026-04-22) pulled the teacher-assignments editor out of
// /markbook/sections/[id] and into this surface; Markbook's detail page
// now shows Roster only. The editor component (imported below) is still
// at its original components/admin/ path; a cosmetic rename to
// components/sis/ may happen in polish.
export default async function SisSectionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  // Arranging cover is narrower than editing assignments: the academic
  // coordinator staffs the year, a school admin decides who stands in.
  const canManageRelief = can(
    await getCapabilitiesForRole(sessionUser.role),
    'staff.manage_relief'
  );

  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = tab === 'teachers' ? 'teachers' : 'overview';

  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, schedule, class_type, academic_year_id, level:levels(id, code, label, level_type), academic_year:academic_years(ay_code, label)'
    )
    .eq('id', id)
    .single();
  if (!section) notFound();

  const schedule = (section as { schedule?: Schedule | null }).schedule ?? null;
  const classType =
    (section as { class_type?: SectionClassType | null }).class_type ?? null;

  // Synchronous derivations from the already-resolved section row.
  const level = (
    Array.isArray(section.level) ? section.level[0] : section.level
  ) as LevelLite | null;
  const ay = (
    Array.isArray(section.academic_year)
      ? section.academic_year[0]
      : section.academic_year
  ) as { ay_code: string; label: string } | null;

  // Roster, subject configs, sibling section list, teacher list, term list,
  // and assignments are all independent after section resolves — run in parallel.
  const [
    { data: rows },
    { data: configs },
    { data: rawSibRows },
    teacherList,
    { data: rawAssignments },
    { data: termRows },
    { data: sectionSubjectRows },
  ] = await Promise.all([
    supabase
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, bus_no, classroom_officer_role, academics_notes, admin_notes, withdrawal_reason, withdrawal_notes, late_enrollee_term_number, student:students(id, student_number, last_name, first_name, middle_name)'
      )
      .eq('section_id', id)
      .order('index_number', { ascending: true }),
    // Migration 080 dropped subject_configs.level_id, so "which subjects
    // are configured at this level" (Pattern A) and "the real
    // subject_configs.id + subject embed for each" (Pattern B) are two
    // separate lookups now — the config `id` is still needed downstream
    // as `subject_config_id` (section_subjects FK, migration 079), so this
    // can't be a single-table swap. Resolve the level's subject_ids from
    // subject_level_offerings, then fetch their subject_configs rows
    // (unique per subject × AY post-collapse) by subject_id IN (...).
    level
      ? (async () => {
          const { data: offeringRows } = await supabase
            .from('subject_level_offerings')
            .select('subject_id')
            .eq('academic_year_id', section.academic_year_id)
            .eq('level_id', level.id);
          const subjectIds = (
            (offeringRows ?? []) as Array<{ subject_id: string }>
          ).map((o) => o.subject_id);
          if (subjectIds.length === 0) return { data: [] as unknown[] };
          return supabase
            .from('subject_configs')
            .select('id, subject:subjects(id, code, name, is_examinable)')
            .eq('academic_year_id', section.academic_year_id)
            .in('subject_id', subjectIds);
        })()
      : Promise.resolve({ data: [] as unknown[] }),
    level && ay
      ? supabase
          .from('sections')
          .select('id, name')
          .eq('academic_year_id', section.academic_year_id)
          .eq('level_id', level.id)
          .neq('id', id)
      : Promise.resolve({ data: [] as unknown[] }),
    getTeacherList(),
    supabase
      .from('teacher_assignments')
      .select(
        'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id'
      )
      .eq('section_id', id),
    // Terms for this AY — used to compute termStarted (see hasTermStarted in
    // lib/sis/current-term.ts). Gates both the escalated Generate-index warning
    // and the "why was this teacher removed?" prompt on the Teachers tab.
    supabase
      .from('terms')
      .select('start_date')
      .eq('academic_year_id', section.academic_year_id),
    // Per-section subject overrides (migration 079) — which of the level's
    // configured subjects apply to THIS section.
    supabase
      .from('section_subjects')
      .select('subject_config_id')
      .eq('section_id', id),
  ]);

  const termStarted = hasTermStarted(
    (termRows ?? []) as Array<{ start_date: string | null }>,
    sgToday()
  );

  type RosterFetchRow = {
    id: string;
    index_number: number;
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    bus_no: string | null;
    classroom_officer_role: string | null;
    academics_notes: string | null;
    admin_notes: string | null;
    withdrawal_reason: string | null;
    withdrawal_notes: string | null;
    late_enrollee_term_number: number | null;
    student:
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }[]
      | null;
  };
  const enrolments = (rows ?? []) as RosterFetchRow[];
  const activeCount = enrolments.filter(
    (e) => e.enrollment_status === 'active'
  ).length;
  const lateCount = enrolments.filter(
    (e) => e.enrollment_status === 'late_enrollee'
  ).length;
  const withdrawnCount = enrolments.filter(
    (e) => e.enrollment_status === 'withdrawn'
  ).length;
  const onRosterCount = activeCount + lateCount;

  type CfgRow = {
    id: string;
    subject:
      | { id: string; code: string; name: string; is_examinable: boolean }
      | { id: string; code: string; name: string; is_examinable: boolean }[]
      | null;
  };
  const levelSubjects = ((configs ?? []) as CfgRow[])
    .map((c) => (Array.isArray(c.subject) ? c.subject[0] : c.subject))
    .filter(
      (
        s
      ): s is {
        id: string;
        code: string;
        name: string;
        is_examinable: boolean;
      } => !!s
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per-section subject overrides (KD ... section_subjects, migration 079)
  // — every subject configured at this level, split into assigned vs.
  // available-to-add by whether a section_subjects row exists for it.
  const levelSubjectConfigs: SectionSubjectChip[] = (
    (configs ?? []) as CfgRow[]
  )
    .map((c) => {
      const s = Array.isArray(c.subject) ? c.subject[0] : c.subject;
      if (!s) return null;
      return {
        subjectConfigId: c.id,
        code: s.code,
        name: s.name,
        isExaminable: s.is_examinable,
      };
    })
    .filter((c): c is SectionSubjectChip => !!c)
    .sort((a, b) => a.name.localeCompare(b.name));
  const assignedConfigIds = new Set(
    ((sectionSubjectRows ?? []) as Array<{ subject_config_id: string }>).map(
      (r) => r.subject_config_id
    )
  );
  const assignedSubjectChips = levelSubjectConfigs.filter((c) =>
    assignedConfigIds.has(c.subjectConfigId)
  );
  const availableSubjectChips = levelSubjectConfigs.filter(
    (c) => !assignedConfigIds.has(c.subjectConfigId)
  );

  // Map StaffMember.name → display_name to match the Teacher type in the component.
  const initialTeachers = teacherList.map((t) => ({
    id: t.id,
    email: t.email,
    display_name: t.name,
  }));
  type AssignmentRow = {
    id: string;
    teacher_user_id: string;
    section_id: string;
    subject_id: string | null;
    role: 'form_adviser' | 'subject_teacher';
    relief_teacher_user_id: string | null;
  };
  const initialAssignments = (rawAssignments ?? []) as AssignmentRow[];

  // Sibling active-count query is sequential — it depends on rawSibRows.
  const sibList = (rawSibRows ?? []) as Array<{ id: string; name: string }>;
  let siblings: SiblingSection[] = [];
  if (sibList.length > 0) {
    const sibIds = sibList.map((s) => s.id);
    // Sibling-section headcounts include late enrollees — they are on that
    // roster, and this number sits next to the capacity the write path
    // enforces (lib/sis/class-assignment.ts), which now counts both.
    const { data: countRows } = await supabase
      .from('section_students')
      .select('section_id')
      .in('enrollment_status', ENROLLED_STATUSES)
      .in('section_id', sibIds);
    const counts = new Map<string, number>();
    for (const r of (countRows ?? []) as Array<{ section_id: string }>) {
      counts.set(r.section_id, (counts.get(r.section_id) ?? 0) + 1);
    }
    siblings = sibList
      .map((s) => {
        const c = counts.get(s.id) ?? 0;
        return {
          id: s.id,
          name: s.name,
          activeCount: c,
          isAtCapacity: c >= MAX_ACTIVE_PER_SECTION,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Resolve enroleeNumber per active student in this AY's admissions roster
  // — needed so the transfer dialog can POST to the correct API path. Lookup
  // by student_number (Hard Rule #4 — the stable cross-AY ID).
  const rosterStudents = enrolments
    .map((r) => {
      const s = Array.isArray(r.student) ? r.student[0] : r.student;
      if (!s) return null;
      return {
        enrolmentId: r.id,
        indexNumber: r.index_number,
        status: r.enrollment_status,
        bus_no: r.bus_no,
        classroom_officer_role: r.classroom_officer_role,
        academics_notes: r.academics_notes,
        admin_notes: r.admin_notes,
        withdrawal_reason: r.withdrawal_reason,
        withdrawal_notes: r.withdrawal_notes,
        late_enrollee_term_number: r.late_enrollee_term_number,
        student_number: s.student_number,
        last_name: s.last_name,
        first_name: s.first_name,
        middle_name: s.middle_name,
      };
    })
    .filter((s): s is NonNullable<typeof s> => !!s);
  const enroleeByStudentNumber = new Map<string, string>();
  if (ay && rosterStudents.length > 0) {
    const studentNumbers = rosterStudents
      .map((r) => r.student_number)
      .filter((sn): sn is string => !!sn);
    if (studentNumbers.length > 0) {
      const year = ay.ay_code.replace(/^AY/i, '').toLowerCase();
      const admissions = createAdmissionsClient();
      const { data: appRows } = await admissions
        .from(`ay${year}_enrolment_applications`)
        .select('enroleeNumber, studentNumber')
        .in('studentNumber', studentNumbers);
      for (const a of (appRows ?? []) as Array<{
        enroleeNumber: string;
        studentNumber: string;
      }>) {
        if (a.studentNumber)
          enroleeByStudentNumber.set(a.studentNumber, a.enroleeNumber);
      }
    }
  }

  function composeName(
    last: string,
    first: string,
    middle: string | null
  ): string {
    const m = middle?.trim() ? ` ${middle.trim().charAt(0)}.` : '';
    return `${last}, ${first}${m}`.trim();
  }
  const rosterRows: SectionRosterRow[] = rosterStudents.map((s) => ({
    enrolmentId: s.enrolmentId,
    indexNumber: s.indexNumber,
    studentName: composeName(s.last_name, s.first_name, s.middle_name),
    studentNumber: s.student_number,
    enroleeNumber: enroleeByStudentNumber.get(s.student_number) ?? null,
    enrollmentStatus: s.status,
    busNo: s.bus_no,
    classroomOfficerRole: s.classroom_officer_role,
    academicsNotes: s.academics_notes,
    adminNotes: s.admin_notes,
    withdrawalReason: s.withdrawal_reason ?? null,
    withdrawalNotes: s.withdrawal_notes ?? null,
    lateEnrolleTermNumber: s.late_enrollee_term_number ?? null,
  }));

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title={section.name}
        description={`${onRosterCount} on the roster${
          withdrawnCount > 0
            ? ` · ${withdrawnCount} withdrawn (kept for audit)`
            : ''
        }.`}
        backHref="/sis/sections"
        backLabel="Sections"
        chips={
          <>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
            {schedule && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {SCHEDULE_LABELS[schedule]}
              </Badge>
            )}
            {classType && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {classType}
              </Badge>
            )}
            {ay && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ay.ay_code}
              </Badge>
            )}
          </>
        }
        actions={
          // Order + weight are frequency-driven, not arbitrary (layout
          // redesign pass, Serial Position/Pareto) — the cross-link to the
          // class's operational view is the daily-work destination and is the
          // one default-variant (primary) button, first; Rename is the rarest
          // of the four and moves last. Generate sheets/index keep their
          // own components' outline styling unchanged.
          //
          // Points straight at Classroom. It used to read "Roster & grading"
          // and link to /markbook/sections/[id], which KD #160 turned into a
          // redirect stub to this same place — so the button already landed
          // here, via a wasted hop, under a label naming a page that no longer
          // exists. The label now names where you actually arrive.
          <>
            <Button asChild size="sm" className="gap-1.5">
              <Link href={`/classroom/${section.id}`}>
                Open in Classroom
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
            <GenerateSheetsDialog
              scope={{
                kind: 'section',
                sectionId: section.id,
                sectionLabel: section.name,
                ayId: section.academic_year_id,
              }}
            />
            <GenerateIndexButton
              sectionId={section.id}
              sectionName={section.name}
              termStarted={termStarted}
            />
            {level?.level_type === 'secondary' && (
              <SectionTrackDialog
                sectionId={section.id}
                sectionName={section.name}
                currentTrack={classType}
              />
            )}
            {/* Sits beside Track because it's the same kind of thing: one
                shared section attribute, registrar+, set rarely. Until this
                shipped `schedule` had no editor at all — AY rollover stamped
                it and nothing could correct it, so a hand-created section
                showed no schedule permanently. */}
            <SectionScheduleDialog
              sectionId={section.id}
              sectionName={section.name}
              currentSchedule={schedule}
            />
            <SectionRenameDialog
              sectionId={section.id}
              currentName={section.name}
            />
          </>
        }
      />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Users className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="teachers">
            <UserCheck className="h-3.5 w-3.5" />
            Teachers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HubStat
              label="Active"
              value={activeCount}
              icon={UserCheck}
              tone="mint"
              subtext="On the roster, currently enrolled"
            />
            <HubStat
              label="Late enrollees"
              value={lateCount}
              icon={Users}
              tone={lateCount > 0 ? 'amber' : 'muted'}
              subtext={
                lateCount === 0
                  ? 'None'
                  : 'Started after term began — pre-enrolment scores N/A'
              }
            />
            <HubStat
              label="Withdrawn"
              value={withdrawnCount}
              icon={UserMinus}
              tone={withdrawnCount > 0 ? 'amber' : 'muted'}
              subtext="Kept in the roster permanently for audit"
            />
          </div>

          {/* Per-section subject overrides — decides which of the level's
              configured subjects apply to THIS section (migration 079).
              Grading-sheet generation reads this list, so it sits above the
              roster: get subjects right before generating sheets. */}
          <SectionSubjectsPanel
            sectionId={section.id}
            levelLabel={level?.label ?? null}
            assigned={assignedSubjectChips}
            availableToAdd={availableSubjectChips}
          />

          {/* Roster — admin lens with the Move action. The full grading
              roster (with edit-enrolment metadata: bus, classroom officer,
              status flips) lives at /markbook/sections/[id]; this surface
              focuses on section-level admin moves. */}
          {ay && (
            <div className="space-y-3">
              <SectionRosterTable
                rows={rosterRows}
                ayCode={ay.ay_code}
                sectionName={section.name}
                sectionId={section.id}
                siblings={siblings}
              />
            </div>
          )}

          {/* The former "Operational surface" pointer card (dashed Card
              linking to /markbook/sections/[id]) was removed here (layout
              redesign pass, Law of Proximity) — it pointed at the exact same
              destination as the header's "Roster & grading" button above,
              which is now the page's one primary action instead of a low-
              weight outline button, so this second path added nothing. */}
        </TabsContent>

        <TabsContent value="teachers" className="mt-4">
          <TeacherAssignmentsPanel
            sectionId={section.id}
            levelSubjects={levelSubjects}
            initialTeachers={initialTeachers}
            initialAssignments={initialAssignments}
            canManageRelief={canManageRelief}
            termStarted={termStarted}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
