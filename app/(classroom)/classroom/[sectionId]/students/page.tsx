import { notFound, redirect } from 'next/navigation';

import { ClassroomRosterTable } from '@/components/classroom/classroom-roster-table';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { listHouses } from '@/lib/sis/houses';
import { canOpenStudentRecord, canReadReportCard } from '@/lib/classroom/scope';
import { createClient, getSessionUser } from '@/lib/supabase/server';

type EnrolmentRow = {
  id: string;
  index_number: number;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  student: {
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
    house_id: string | null;
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

  const { capability, substantiveCapability } = await loadClassroomAccess(
    role,
    userId,
    sectionId
  );
  if (!capability) notFound();

  const supabase = await createClient();
  // The class's own name, for the details drawer's header — a teacher who
  // advises one class and teaches four should not have to work out which
  // roster the open panel came from.
  const { data: section } = await supabase
    .from('sections')
    .select('name')
    .eq('id', sectionId)
    .maybeSingle();
  const sectionName = (section as { name: string } | null)?.name ?? null;

  const { data: rows } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name, house_id)'
    )
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn')
    .order('index_number');

  const enrolments = (rows ?? []) as unknown as EnrolmentRow[];
  // A house spans P1-S4, so an adviser looking at their own class cannot infer
  // it from anything else on this screen. The join above already reaches
  // `students`, so this costs one extra column, not a query.
  const houses = await listHouses();
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const rosterRows = enrolments.map((e) => {
    const s = e.student;
    return {
      id: e.id,
      student_id: s?.id ?? null,
      index_number: e.index_number,
      student_number: s?.student_number ?? '',
      student_name: s
        ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
        : '(missing student)',
      enrollment_status: e.enrollment_status as 'active' | 'late_enrollee',
      house_name: s?.house_id
        ? (houseById.get(s.house_id)?.name ?? null)
        : null,
      house_colour_token: s?.house_id
        ? (houseById.get(s.house_id)?.colourToken ?? null)
        : null,
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
      {/* The report-card link is adviser/oversight only — a subject teacher's
          card would be structurally hollow, so the page 404s for them and the
          row must not offer it. Same predicate the page itself enforces. */}
      {/* The student record is registrar-and-above, so a teacher clicking a
          name here used to be bounced to `/`. The link asks the same question
          the page does. */}
      {/* showReportCard takes substantiveCapability, not capability: the card
          carries the adviser's own comment, so it stays with the regular
          adviser while a substitute is covering the class. */}
      <ClassroomRosterTable
        sectionId={sectionId}
        sectionName={sectionName}
        data={rosterRows}
        showReportCard={canReadReportCard(substantiveCapability)}
        showRecordLink={canOpenStudentRecord(capability)}
      />
    </div>
  );
}
