import { notFound, redirect } from 'next/navigation';

import { ClassroomRosterTable } from '@/components/classroom/classroom-roster-table';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

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

// Students — the class roster. Not term-scoped (a roster is a section-wide
// fact, not a per-term one); the ?term_id= in the URL is only there because
// the tab nav preserves it when switching tabs.
export default async function ClassroomStudentsPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(student_number, last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn')
    .order('index_number');

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

  return (
    <div className="space-y-3">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Roster
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {rosterRows.length}
        </span>
      </h2>
      <ClassroomRosterTable sectionId={sectionId} data={rosterRows} />
    </div>
  );
}
