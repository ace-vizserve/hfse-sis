// The students who are IN A CLASS but whose application still says it never
// finished. Read-only, re-runnable.
//
// WHY. Mr Ace, 2026-09-22, on the Edit Application dialog: withdrawing a
// student whose applicationStatus is not Enrolled asked for "the last day
// they actually attended" — "this doesnt make sense bruh". It is not the gate
// that is wrong (a real class row would be orphaned without a last day); it
// is the STATUS that is stale. `probe-application-status-vs-class-row.ts`
// found 15 such students in AY2026.
//
// This prints each one in full — their class, index number, enrolment status,
// and every stage status on the record — so the office can see WHY each one
// stalled before anything is changed. `apply-stale-submitted-with-class.ts`
// is the writer; this is the look-first half.
//
// Usage: npx tsx --env-file=.env.local scripts/audit-stale-submitted-with-class.ts [AY2026]

import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

const ENROLLED = ['Enrolled', 'Enrolled (Conditional)'];

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

export type StaleRow = {
  enroleeNumber: string;
  studentNumber: string;
  studentName: string;
  applicationStatus: string | null;
  sectionName: string;
  levelCode: string | null;
  indexNumber: number | null;
  enrollmentStatus: string;
  enrolmentDate: string | null;
};

export async function findStaleEnrolledStatuses(
  ayCode: string
): Promise<StaleRow[]> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return [];

  const { data: rows } = await service
    .from('section_students')
    .select(
      'index_number, enrollment_status, enrollment_date, ' +
        'student:students(student_number, first_name, middle_name, last_name), ' +
        'section:sections!inner(name, academic_year_id, level:levels(code))'
    )
    .eq('sections.academic_year_id', (ay as { id: string }).id)
    .in('enrollment_status', ['active', 'late_enrollee'])
    .limit(3000);

  type Row = {
    index_number: number | null;
    enrollment_status: string;
    enrollment_date: string | null;
    student: {
      student_number: string | null;
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
    } | null;
    section: {
      name: string;
      level: { code: string } | { code: string }[] | null;
    } | null;
  };

  const classRows = (rows ?? []) as unknown as Row[];
  const byStudentNumber = new Map<string, Row>();
  for (const r of classRows) {
    const sn = r.student?.student_number;
    if (sn) byStudentNumber.set(sn, r);
  }
  const studentNumbers = [...byStudentNumber.keys()];
  if (studentNumbers.length === 0) return [];

  const prefix = prefixFor(ayCode);
  const { data: appRows } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber, enroleeNumber')
    .in('studentNumber', studentNumbers);
  const enroleeByStudent = new Map(
    (
      (appRows ?? []) as Array<{
        studentNumber: string | null;
        enroleeNumber: string | null;
      }>
    )
      .filter((r) => r.studentNumber && r.enroleeNumber)
      .map((r) => [r.studentNumber!, r.enroleeNumber!])
  );

  const enrolees = [...enroleeByStudent.values()];
  if (enrolees.length === 0) return [];

  const { data: statusRows } = await admissions
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus')
    .in('enroleeNumber', enrolees);
  const statusByEnrolee = new Map(
    (
      (statusRows ?? []) as Array<{
        enroleeNumber: string | null;
        applicationStatus: string | null;
      }>
    ).map((r) => [r.enroleeNumber, r.applicationStatus])
  );

  const out: StaleRow[] = [];
  for (const [studentNumber, classRow] of byStudentNumber) {
    const enroleeNumber = enroleeByStudent.get(studentNumber);
    if (!enroleeNumber) continue; // no application row — a different gap
    const applicationStatus = statusByEnrolee.get(enroleeNumber) ?? null;
    if (applicationStatus && ENROLLED.includes(applicationStatus)) continue;
    // ⚠ A TERMINAL STATUS IS NOT STALE, IT IS A CONTRADICTION OF ANOTHER KIND.
    // Cancelled/Withdrawn beside an ACTIVE class row means the withdrawal
    // never cascaded, which is the opposite problem and must not be "fixed"
    // by marking them Enrolled. Reported, never rewritten.
    const section = classRow.section;
    const level = Array.isArray(section?.level)
      ? section?.level[0]
      : section?.level;
    out.push({
      enroleeNumber,
      studentNumber,
      studentName:
        [
          classRow.student?.first_name,
          classRow.student?.middle_name,
          classRow.student?.last_name,
        ]
          .map((p) => (p ?? '').trim())
          .filter(Boolean)
          .join(' ') || studentNumber,
      applicationStatus,
      sectionName: section?.name ?? '(unknown)',
      levelCode: level?.code ?? null,
      indexNumber: classRow.index_number,
      enrollmentStatus: classRow.enrollment_status,
      enrolmentDate: classRow.enrollment_date,
    });
  }
  return out.sort((a, b) => a.enroleeNumber.localeCompare(b.enroleeNumber));
}

async function main() {
  const ayCode = process.argv[2] ?? 'AY2026';
  const stale = await findStaleEnrolledStatuses(ayCode);

  console.log(
    `${ayCode}: ${stale.length} students hold an ACTIVE class row while their application says otherwise.\n`
  );
  const byStatus = new Map<string, StaleRow[]>();
  for (const r of stale) {
    const key = r.applicationStatus ?? 'MISSING';
    byStatus.set(key, [...(byStatus.get(key) ?? []), r]);
  }
  for (const [status, rows] of byStatus) {
    console.log(`  applicationStatus = ${status}  (${rows.length})`);
    for (const r of rows) {
      console.log(
        `    ${r.enroleeNumber}  ${r.studentNumber.padEnd(9)}  ` +
          `${[r.levelCode, r.sectionName].filter(Boolean).join(' ').padEnd(22)}  ` +
          `#${String(r.indexNumber ?? '—').padEnd(3)}  ` +
          `${r.enrollmentStatus.padEnd(13)}  enrolled ${r.enrolmentDate ?? '—'}  ${r.studentName}`
      );
    }
    console.log('');
  }

  const terminal = stale.filter(
    (r) =>
      r.applicationStatus === 'Cancelled' || r.applicationStatus === 'Withdrawn'
  );
  if (terminal.length > 0) {
    console.log(
      `⚠ ${terminal.length} of these are Cancelled/Withdrawn beside an ACTIVE class row.\n` +
        `  That is the OPPOSITE problem — a withdrawal that never reached the class\n` +
        `  roster — and marking them Enrolled would be wrong. They need a decision,\n` +
        `  not a backfill.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
