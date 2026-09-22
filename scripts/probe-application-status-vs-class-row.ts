// Does a student's admissions `applicationStatus` agree with the fact that
// they already sit in an active class? Read-only, re-runnable.
//
// WHY THIS EXISTS. Mr Ace, 2026-09-22: opening a student's "Edit Application"
// dialog and setting the status to Withdrawn/Cancelled required a "last day
// at school" — "the last day they actually attended" — for a student whose
// applicationStatus read something other than Enrolled. His reaction:
// "this doesnt make sense bruh".
//
// It traced to `lib/sis/withdrawal-cascade.ts::withdrawalDateRequiredError`,
// which asks for a last day whenever the student holds an ACTIVE or
// LATE_ENROLLEE `section_students` row for the target year — regardless of
// what `applicationStatus` says. That gate is not wrong on its own terms: a
// real class row would be silently orphaned without a last day. The question
// this script answers is whether the MISMATCH itself is real production data
// or a one-off.
//
// RESULT, 2026-09-22: it is real. AY2026 (the live year) has 15 students who
// are actively placed in a class while their applicationStatus still reads
// "Submitted" — the application record never got flipped to Enrolled even
// though the class-assignment step went ahead. For those 15, the dialog is
// asking a sensible question about a real class placement; what actually
// "doesn't make sense" is that the STATUS is stale, not that the gate fired.
// AY2025 (closed) shows ~100 such rows, many with no matching application row
// at all — a separate, likely pre-existing gap, not chased further here.
// AY2027 (not yet started, no term dates recorded) has exactly one active row
// and its status already agrees (Enrolled) — the "hasn't started yet" theory
// this script also tested does NOT explain the report.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-application-status-vs-class-row.ts

import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function main() {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code', { ascending: true });

  for (const ay of (ays ?? []) as { id: string; ay_code: string }[]) {
    const { data: rows } = await service
      .from('section_students')
      .select(
        'enrollment_status, student:students(student_number), section:sections!inner(academic_year_id)'
      )
      .eq('sections.academic_year_id', ay.id)
      .in('enrollment_status', ['active', 'late_enrollee'])
      .limit(3000);

    const studentNumbers = (
      (rows ?? []) as unknown as Array<{
        student: { student_number: string | null } | null;
      }>
    )
      .map((r) => r.student?.student_number)
      .filter((v): v is string => !!v);
    if (studentNumbers.length === 0) {
      console.log(`${ay.ay_code}: 0 active class rows`);
      continue;
    }

    const prefix = prefixFor(ay.ay_code);
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
      ).map((r) => [r.studentNumber, r.enroleeNumber])
    );
    const enrolees = Array.from(enroleeByStudent.values()).filter(
      (v): v is string => !!v
    );

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

    let mismatches = 0;
    const examples: string[] = [];
    for (const sn of studentNumbers) {
      const enrolee = enroleeByStudent.get(sn);
      const status = enrolee ? statusByEnrolee.get(enrolee) : undefined;
      if (status !== 'Enrolled' && status !== 'Enrolled (Conditional)') {
        mismatches++;
        if (examples.length < 20) {
          examples.push(
            `${enrolee ?? '(no application row for student ' + sn + ')'}: applicationStatus=${status ?? 'MISSING'}`
          );
        }
      }
    }
    console.log(
      `${ay.ay_code}: ${studentNumbers.length} active class rows, ${mismatches} with applicationStatus != Enrolled/Enrolled (Conditional)`
    );
    for (const ex of examples) console.log(`    ${ex}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
