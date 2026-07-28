import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Calendar,
  MessageSquare,
} from 'lucide-react';

import { ClassroomRosterTable } from '@/components/classroom/classroom-roster-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { loadAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import {
  canReadAttendance,
  canReadWriteups,
  capabilityForSection,
  resolveClassroomScope,
} from '@/lib/classroom/scope';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

type EnrolmentRow = {
  id: string;
  index_number: number;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  student: {
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  } | null;
};

export default async function ClassroomDetailPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  // Authorization — the ROUTE_ACCESS row only gates the /classroom prefix,
  // not individual classes. A teacher must not be able to open a class
  // they have no assignment for by typing the URL.
  const assignments =
    role === 'teacher'
      ? await loadAssignmentsForUser(createServiceClient(), userId)
      : [];
  const scope = resolveClassroomScope(role, assignments);
  const capability = capabilityForSection(scope, sectionId);
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, name, level:levels(id, code, label, level_type)')
    .eq('id', sectionId)
    .single();
  if (!section) notFound();

  const { data: rows } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(student_number, last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn')
    .order('index_number');

  const level = (
    Array.isArray(section.level) ? section.level[0] : section.level
  ) as LevelLite | null;

  const enrolments = (rows ?? []) as unknown as EnrolmentRow[];
  const rosterRows = enrolments.map((e) => {
    const s = e.student;
    return {
      id: e.id,
      index_number: e.index_number,
      student_number: s?.student_number ?? '',
      student_name: s
        ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
        : '(missing student)',
      enrollment_status: e.enrollment_status as 'active' | 'late_enrollee',
    };
  });

  const showAttendance = canReadAttendance(capability);
  const showWriteups = canReadWriteups(capability);

  return (
    <PageShell>
      <Link
        href="/classroom"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to classes
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {rosterRows.length} on the roster.
            {capability === 'subject'
              ? ' You teach a subject in this class — attendance and write-ups are visible to the form adviser only.'
              : ''}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {/* Capability-aware links out — never an inline role check. RLS
            returns empty for a subject-teacher-only viewer, so offering
            attendance/write-up links to them would be a dead end. */}
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/markbook/grading?grading.section=${encodeURIComponent(section.name)}`}
          >
            <BookOpen className="h-4 w-4" />
            Grading sheets
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </Button>
        {showWriteups && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/evaluation/sections/${section.id}`}>
              <MessageSquare className="h-4 w-4" />
              Write-ups
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        )}
        {showAttendance && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/attendance/${section.id}`}>
              <Calendar className="h-4 w-4" />
              Attendance
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Roster
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
            {rosterRows.length}
          </span>
        </h2>
        <ClassroomRosterTable data={rosterRows} />
      </div>
    </PageShell>
  );
}
