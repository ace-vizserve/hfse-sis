import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { getTeacherList } from '@/lib/auth/staff-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GenerateIndexButton } from '@/components/sis/generate-index-button';
import { sgToday } from '@/lib/dates';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { HubStat } from '@/components/sis/hub-stat';
import { SectionRenameDialog } from '@/components/sis/section-rename-dialog';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { TeacherAssignmentsPanel } from '@/components/sis/section-teachers-tab';
import {
  SectionRosterTable,
  type SectionRosterRow,
} from '@/components/sis/section-roster-table';
import type { SiblingSection } from '@/components/sis/section-transfer-dialog';
import { SCHEDULE_LABELS, type Schedule } from '@/lib/schemas/section';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type EnrolmentLite = {
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
};

const MAX_PER_SECTION = 50;

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
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = tab === 'teachers' ? 'teachers' : 'overview';

  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, schedule, academic_year_id, level:levels(id, code, label, level_type), academic_year:academic_years(ay_code, label)'
    )
    .eq('id', id)
    .single();
  if (!section) notFound();

  const schedule = (section as { schedule?: Schedule | null }).schedule ?? null;

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
  ] = await Promise.all([
    supabase
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, bus_no, classroom_officer_role, withdrawal_reason, withdrawal_notes, late_enrollee_term_number, student:students(id, student_number, last_name, first_name, middle_name)'
      )
      .eq('section_id', id)
      .order('index_number', { ascending: true }),
    level
      ? supabase
          .from('subject_configs')
          .select('subject:subjects(id, code, name, is_examinable)')
          .eq('academic_year_id', section.academic_year_id)
          .eq('level_id', level.id)
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
      .select('id, teacher_user_id, section_id, subject_id, role')
      .eq('section_id', id),
    // Terms for this AY — used to compute termStarted (the school year's first
    // term has started if today ≥ earliest term start_date). Conservative: a
    // null start_date is treated as "not yet started" (no false escalations
    // during initial AY setup). Uses sgToday() — KD #32.
    supabase
      .from('terms')
      .select('start_date')
      .eq('academic_year_id', section.academic_year_id)
      .order('start_date', { ascending: true }),
  ]);

  const today = sgToday();
  const earliestTermStart = (termRows ?? [])
    .map((t: { start_date: string | null }) => t.start_date)
    .filter((d): d is string => !!d)
    .sort()[0];
  const termStarted = !!earliestTermStart && earliestTermStart <= today;

  type RosterFetchRow = {
    id: string;
    index_number: number;
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    bus_no: string | null;
    classroom_officer_role: string | null;
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
  };
  const initialAssignments = (rawAssignments ?? []) as AssignmentRow[];

  // Sibling active-count query is sequential — it depends on rawSibRows.
  const sibList = (rawSibRows ?? []) as Array<{ id: string; name: string }>;
  let siblings: SiblingSection[] = [];
  if (sibList.length > 0) {
    const sibIds = sibList.map((s) => s.id);
    const { data: countRows } = await supabase
      .from('section_students')
      .select('section_id')
      .eq('enrollment_status', 'active')
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
          isAtCapacity: c >= MAX_PER_SECTION,
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
    withdrawalReason: s.withdrawal_reason ?? null,
    withdrawalNotes: s.withdrawal_notes ?? null,
    lateEnrolleTermNumber: s.late_enrollee_term_number ?? null,
  }));

  return (
    <PageShell>
      <Link
        href="/sis/sections"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sections
      </Link>

      <SisPageHeader
        group="This year"
        title={section.name}
        description={`${onRosterCount} on the roster${
          withdrawnCount > 0
            ? ` · ${withdrawnCount} withdrawn (kept for audit)`
            : ''
        }.`}
        chips={
          <>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
            {schedule && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {SCHEDULE_LABELS[schedule]}
              </Badge>
            )}
            {ay && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ay.ay_code}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <SectionRenameDialog
              sectionId={section.id}
              currentName={section.name}
            />
            <GenerateIndexButton
              sectionId={section.id}
              sectionName={section.name}
              termStarted={termStarted}
            />
            <GenerateSheetsDialog
              scope={{
                kind: 'section',
                sectionId: section.id,
                sectionLabel: section.name,
              }}
            />
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/markbook/sections/${section.id}`}>
                Roster &amp; grading
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
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

          {/* Pointer card to operational surface */}
          <Card className="border-dashed">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Operational surface
              </CardDescription>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
                Roster, grading sheets, report cards
              </CardTitle>
              <CardAction>
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <Users className="size-5" />
                </div>
              </CardAction>
            </CardHeader>
            <CardFooter>
              <Link
                href={`/markbook/sections/${section.id}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
              >
                Open in Markbook
                <ArrowUpRight className="size-3.5" />
              </Link>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="teachers" className="mt-4">
          <TeacherAssignmentsPanel
            sectionId={section.id}
            levelSubjects={levelSubjects}
            initialTeachers={initialTeachers}
            initialAssignments={initialAssignments}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
