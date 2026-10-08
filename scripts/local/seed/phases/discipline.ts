// Phase "discipline" (plan phase 6): a student's disciplinary record.
//
// Production (prod-profile.md): one record, an incident. Locally: the same
// child gets an incident (filed by a subject teacher who was in the room) and,
// a few days later, the letter the school sent home about it — so both
// `record_type`s exist, and the letter carries the date the signed slip came
// back (`acknowledged_on`, letters only, never before the letter went out).
//
// Write path: POST /api/classroom/[sectionId]/students/[studentNumber]/
// discipline, mirrored (it gates on a cookie session): the filer's classroom
// capability over the section (`loadClassroomAccess` → `canReadRoster` — any
// teacher of the class may file, the school's rule), the child on THAT
// section's roster and not withdrawn, the body through
// `DisciplineRecordSchema`, the section's own academic year, the app's
// `createDisciplineRecord` with the filer's id, then the route's
// `discipline.record.file` audit row (`disciplineFileAuditContext` — lengths
// and presence, never the narrative) and its records cache bust.
//
// Idempotent: a record with the same child, type, date and nature is not
// filed again.

import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadRoster } from '@/lib/classroom/scope';
import { disciplineFileAuditContext } from '@/lib/discipline/audit';
import { createDisciplineRecord } from '@/lib/discipline/mutations';
import { DisciplineRecordSchema } from '@/lib/schemas/discipline';
import { findStudentByNumber } from '@/lib/sis/records-history';

import { must, service, sqlRows } from '../lib/local';
import { rng } from '../lib/random';

type Filer = { id: string; email: string; role: Role };

/** The day of the incident; the child was in school (Present) that day. */
const INCIDENT_DAY = '2026-09-17';

/** The child, the class and the two people who file. Stable on every run. */
export function disciplineTarget(): {
  sectionId: string;
  studentNumber: string;
  subjectTeacher: Filer;
  adviser: Filer;
} {
  // A Secondary class with a form adviser and a subject teacher who is not
  // the adviser; the child active on its list and in school (marked Present)
  // on the day of the incident. Drawn from a stable order.
  const rows = sqlRows(`
    select s.id, st.student_number, sub.id, sub.email, adv.id, adv.email
      from sections s
      join levels l on l.id = s.level_id and l.level_type = 'secondary'
      join academic_years a on a.id = s.academic_year_id and a.ay_code = 'AY2026'
      join teacher_assignments fa on fa.section_id = s.id and fa.role = 'form_adviser'
      join auth.users adv on adv.id = fa.teacher_user_id
      join lateral (select u.id, u.email from teacher_assignments ta join auth.users u on u.id = ta.teacher_user_id
                     where ta.section_id = s.id and ta.role = 'subject_teacher' and ta.teacher_user_id <> fa.teacher_user_id
                     order by u.email limit 1) sub on true
      join section_students ss on ss.section_id = s.id and ss.enrollment_status = 'active'
      join students st on st.id = ss.student_id
     where (select d.status from attendance_daily d
             where d.section_student_id = ss.id and d.date = '${INCIDENT_DAY}'
             order by d.recorded_at desc, d.id desc limit 1) = 'P'
     order by l.code, s.name, st.student_number`);
  if (rows.length === 0)
    throw new Error('discipline: no Secondary class to file in');
  const [sectionId, studentNumber, subId, subEmail, advId, advEmail] =
    rng('discipline:target').pick(rows);
  return {
    sectionId,
    studentNumber,
    subjectTeacher: { id: subId, email: subEmail, role: 'teacher' },
    adviser: { id: advId, email: advEmail, role: 'teacher' },
  };
}

const RECORDS = (
  who: ReturnType<typeof disciplineTarget>
): Array<{ filer: Filer; body: Record<string, unknown> }> => [
  {
    filer: who.subjectTeacher,
    body: {
      record_type: 'incident',
      occurred_on: INCIDENT_DAY,
      occurred_at_time: '10:40',
      nature: 'Pushing in the canteen queue',
      details:
        '<p>During recess the student pushed a Primary Four pupil out of the canteen queue. The younger pupil fell and grazed a knee; the canteen staff took them to the clinic.</p><p>The student apologised when asked and helped pick up the dropped tray.</p>',
      remarks:
        '<p>Spoken to after recess. Form adviser informed the same day.</p>',
      document_url: '',
    },
  },
  {
    filer: who.adviser,
    body: {
      record_type: 'letter',
      occurred_on: '2026-09-21',
      nature: 'Behaviour letter sent home',
      details:
        '<p>Letter to the parents about the incident in the canteen on 17 September, asking them to discuss safe conduct at recess at home.</p>',
      remarks: null,
      document_url:
        'https://hfse.sharepoint.com/sites/office/Shared%20Documents/letters/2026-09-21-behaviour.pdf',
      acknowledged_on: '2026-09-23',
      filed_by_office: 'Office of the Principal',
    },
  },
];

/** The route's POST, mirrored for one record. */
async function fileRecord(
  sectionId: string,
  studentNumber: string,
  filer: Filer,
  body: Record<string, unknown>
): Promise<'filed' | 'already' | 'audit repaired'> {
  const sb = service();
  // 1. The caller's classroom capability over THIS section.
  const { capability } = await loadClassroomAccess(
    filer.role,
    filer.id,
    sectionId
  );
  if (!canReadRoster(capability))
    throw new Error(
      `discipline: ${filer.email} has no roster access (the route 404s)`
    );
  // 2. The student, on THIS section's roster, not withdrawn.
  const student = await findStudentByNumber(studentNumber);
  if (!student) throw new Error(`discipline: ${studentNumber} not found`);
  const enrolment = await must(
    'discipline: roster check',
    sb
      .from('section_students')
      .select('id')
      .eq('section_id', sectionId)
      .eq('student_id', student.studentId)
      .neq('enrollment_status', 'withdrawn')
  );
  if (enrolment.length !== 1)
    throw new Error(
      `discipline: ${studentNumber} not on the roster (the route 404s)`
    );

  const input = DisciplineRecordSchema.parse(body);

  const already = (await must(
    'discipline: existing',
    sb
      .from('student_discipline_records')
      .select('id')
      .eq('student_id', student.studentId)
      .eq('record_type', input.record_type)
      .eq('occurred_on', input.occurred_on)
      .eq('nature', input.nature)
  )) as Array<{ id: string }>;

  // The section's own academic year, never "now".
  const [section] = await must(
    'discipline: section',
    sb
      .from('sections')
      .select(
        'name, academic_year_id, academic_year:academic_years(ay_code), level:levels(label)'
      )
      .eq('id', sectionId)
  );
  const row = section as unknown as {
    name: string | null;
    academic_year_id: string;
    academic_year: { ay_code: string } | { ay_code: string }[] | null;
    level: { label: string | null } | { label: string | null }[] | null;
  };
  const ayCode =
    (Array.isArray(row.academic_year)
      ? row.academic_year[0]?.ay_code
      : row.academic_year?.ay_code) ?? null;
  const level = Array.isArray(row.level) ? row.level[0] : row.level;

  let recordId: string;
  let outcome: 'filed' | 'already' | 'audit repaired';
  if (already.length > 0) {
    // Filed by an earlier run. If that run died between the insert and the
    // route's audit row, the record has no trace — write it now.
    recordId = already[0].id;
    const logged = Number(
      sqlRows(`select count(*) from audit_log where action = 'discipline.record.file'
                and entity_id = '${recordId}'`)[0][0]
    );
    if (logged > 0) return 'already';
    outcome = 'audit repaired';
  } else {
    const result = await createDisciplineRecord(
      sb,
      {
        studentId: student.studentId,
        sectionId,
        academicYearId: row.academic_year_id,
      },
      filer.id,
      input
    );
    if (!result.ok) throw new Error(`discipline: insert: ${result.error}`);
    recordId = result.id;
    outcome = 'filed';
  }

  await logAction({
    service: sb,
    actor: { id: filer.id, email: filer.email, role: filer.role },
    action: 'discipline.record.file',
    entityType: 'student_discipline_record',
    entityId: recordId,
    context: disciplineFileAuditContext(
      {
        studentNumber,
        studentId: student.studentId,
        studentName:
          [student.firstName, student.lastName]
            .map((p) => p?.trim())
            .filter(Boolean)
            .join(' ') || null,
        sectionId,
        sectionName: row.name,
        levelLabel: level?.label ?? null,
      },
      input
    ),
  });
  if (ayCode) invalidateDrillTags('records', ayCode);
  return outcome;
}

export async function runDiscipline(): Promise<void> {
  const who = disciplineTarget();
  const out: string[] = [];
  for (const { filer, body } of RECORDS(who)) {
    const res = await fileRecord(who.sectionId, who.studentNumber, filer, body);
    out.push(`${body.record_type} by ${filer.email}: ${res}`);
  }
  console.log(`  ${who.studentNumber}: ${out.join('; ')}`);
}
