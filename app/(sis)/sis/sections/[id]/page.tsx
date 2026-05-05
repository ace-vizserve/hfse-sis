import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, UserCheck, UserMinus, Users } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { SectionRenameDialog } from '@/components/sis/section-rename-dialog';
import { TeacherAssignmentsPanel } from '@/components/sis/section-teachers-tab';
import {
  SectionRosterTable,
  type SectionRosterRow,
} from '@/components/sis/section-roster-table';
import type { SiblingSection } from '@/components/sis/section-transfer-dialog';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };
type EnrolmentLite = { enrollment_status: 'active' | 'late_enrollee' | 'withdrawn' };

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
    .select('id, name, academic_year_id, level:levels(id, code, label, level_type), academic_year:academic_years(ay_code, label)')
    .eq('id', id)
    .single();
  if (!section) notFound();

  const { data: rows } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)',
    )
    .eq('section_id', id)
    .order('index_number', { ascending: true });
  type RosterFetchRow = {
    id: string;
    index_number: number;
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    student:
      | { id: string; student_number: string; last_name: string; first_name: string; middle_name: string | null }
      | { id: string; student_number: string; last_name: string; first_name: string; middle_name: string | null }[]
      | null;
  };
  const enrolments = (rows ?? []) as RosterFetchRow[];
  const activeCount = enrolments.filter((e) => e.enrollment_status === 'active').length;
  const lateCount = enrolments.filter((e) => e.enrollment_status === 'late_enrollee').length;
  const withdrawnCount = enrolments.filter((e) => e.enrollment_status === 'withdrawn').length;
  const onRosterCount = activeCount + lateCount;

  const level = (Array.isArray(section.level) ? section.level[0] : section.level) as LevelLite | null;
  const ay = (Array.isArray(section.academic_year) ? section.academic_year[0] : section.academic_year) as
    | { ay_code: string; label: string }
    | null;

  // Subjects enabled for this level × AY — drives the subject-teacher dropdown
  // in the Teachers tab.
  const { data: configs } = level
    ? await supabase
        .from('subject_configs')
        .select('subject:subjects(id, code, name)')
        .eq('academic_year_id', section.academic_year_id)
        .eq('level_id', level.id)
    : { data: [] };
  type CfgRow = {
    subject:
      | { id: string; code: string; name: string }
      | { id: string; code: string; name: string }[]
      | null;
  };
  const levelSubjects = ((configs ?? []) as CfgRow[])
    .map((c) => (Array.isArray(c.subject) ? c.subject[0] : c.subject))
    .filter((s): s is { id: string; code: string; name: string } => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Sibling sections at the same level + AY for the Move dialog. Only used
  // when this section has a level; sections without one can't be the target
  // of a same-level transfer regardless. Active counts inform the capacity
  // hint + disabled state in the dialog.
  let siblings: SiblingSection[] = [];
  if (level && ay) {
    const { data: sibRows } = await supabase
      .from('sections')
      .select('id, name')
      .eq('academic_year_id', section.academic_year_id)
      .eq('level_id', level.id)
      .neq('id', id);
    const sibList = (sibRows ?? []) as Array<{ id: string; name: string }>;
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
          return { id: s.id, name: s.name, activeCount: c, isAtCapacity: c >= MAX_PER_SECTION };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }
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
      for (const a of (appRows ?? []) as Array<{ enroleeNumber: string; studentNumber: string }>) {
        if (a.studentNumber) enroleeByStudentNumber.set(a.studentNumber, a.enroleeNumber);
      }
    }
  }

  function composeName(last: string, first: string, middle: string | null): string {
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

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · Section
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
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
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {onRosterCount} on the roster
            {withdrawnCount > 0 && ` · ${withdrawnCount} withdrawn (kept for audit)`}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SectionRenameDialog sectionId={section.id} currentName={section.name} />
          <GenerateSheetsDialog
            scope={{ kind: 'section', sectionId: section.id, sectionLabel: section.name }}
          />
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={`/markbook/sections/${section.id}`}>
              Roster &amp; grading
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

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
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
              <StatCard
                description="Active"
                value={activeCount}
                icon={UserCheck}
                footerTitle="On the roster"
                footerDetail="Currently enrolled"
              />
              <StatCard
                description="Late enrollees"
                value={lateCount}
                icon={Users}
                footerTitle={lateCount === 0 ? 'None' : 'Started after term began'}
                footerDetail="Pre-enrolment scores marked N/A"
              />
              <StatCard
                description="Withdrawn"
                value={withdrawnCount}
                icon={UserMinus}
                footerTitle={withdrawnCount === 0 ? 'None this year' : 'Retained for audit'}
                footerDetail="Kept in the roster permanently"
              />
            </div>
          </div>

          {/* Roster — admin lens with the Move action. The full grading
              roster (with edit-enrolment metadata: bus, classroom officer,
              status flips) lives at /markbook/sections/[id]; this surface
              focuses on section-level admin moves. */}
          {ay && (
            <SectionRosterTable
              rows={rosterRows}
              ayCode={ay.ay_code}
              sectionName={section.name}
              siblings={siblings}
            />
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
          <TeacherAssignmentsPanel sectionId={section.id} levelSubjects={levelSubjects} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
