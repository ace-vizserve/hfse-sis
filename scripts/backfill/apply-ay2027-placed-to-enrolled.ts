// Flip AY2027 applications to Enrolled for children who already sit in an
// active AY2027 class. Dry-run by default; pass --apply to write.
//
// WHY. 2026-09-24: AY2027 showed 1 enrolled student while 4 children held an
// active class row — the class placement went ahead but the application
// status was never moved off "Submitted" (the same stale-status shape
// `scripts/probe-application-status-vs-class-row.ts` found in AY2026).
// Mr Ace: "flip the 3 placed ones to enrolled".
//
// Stamps `enrolledAt` only when it is still NULL — the column is write-once
// (migration 075), matching what the stage route does on enrolment.
//
// Usage: npx tsx --env-file=.env.local scripts/backfill/apply-ay2027-placed-to-enrolled.ts [--apply]

import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

const APPLY = process.argv.includes('--apply');

async function main() {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', 'AY2027')
    .single();
  if (!ay) throw new Error('AY2027 not found');

  const { data: rows, error } = await service
    .from('section_students')
    .select(
      'student:students(student_number), section:sections!inner(academic_year_id)'
    )
    .eq('sections.academic_year_id', ay.id)
    .in('enrollment_status', ['active', 'late_enrollee']);
  if (error) throw error;
  const studentNumbers = (
    (rows ?? []) as unknown as Array<{
      student: { student_number: string | null } | null;
    }>
  )
    .map((r) => r.student?.student_number)
    .filter((v): v is string => !!v);

  const { data: apps, error: appErr } = await admissions
    .from('ay2027_enrolment_applications')
    .select('studentNumber, enroleeNumber, lastName, firstName')
    .in('studentNumber', studentNumbers);
  if (appErr) throw appErr;

  const enrolees = (apps ?? [])
    .map((a) => a.enroleeNumber as string)
    .filter(Boolean);
  const { data: statuses, error: stErr } = await admissions
    .from('ay2027_enrolment_status')
    .select('enroleeNumber, applicationStatus, enrolledAt')
    .in('enroleeNumber', enrolees);
  if (stErr) throw stErr;
  const statusBy = new Map((statuses ?? []).map((s) => [s.enroleeNumber, s]));

  for (const sn of studentNumbers) {
    if (!(apps ?? []).some((a) => a.studentNumber === sn)) {
      console.log(`SKIP ${sn}: no AY2027 application row`);
    }
  }

  const targets = (apps ?? []).filter((a) => {
    const s = statusBy.get(a.enroleeNumber);
    return (
      s &&
      s.applicationStatus !== 'Enrolled' &&
      s.applicationStatus !== 'Enrolled (Conditional)'
    );
  });

  for (const a of apps ?? []) {
    const s = statusBy.get(a.enroleeNumber);
    const flip = targets.includes(a);
    console.log(
      `${flip ? 'FLIP' : 'keep'} ${a.enroleeNumber} ${a.studentNumber} ${a.lastName}, ${a.firstName}: ${s?.applicationStatus ?? 'NO STATUS ROW'}`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run — ${targets.length} to flip. Re-run with --apply.`);
    return;
  }

  const now = new Date().toISOString();
  for (const a of targets) {
    const s = statusBy.get(a.enroleeNumber)!;
    const patch: Record<string, unknown> = { applicationStatus: 'Enrolled' };
    if (!s.enrolledAt) patch.enrolledAt = now;
    const { error: upErr } = await admissions
      .from('ay2027_enrolment_status')
      .update(patch)
      .eq('enroleeNumber', a.enroleeNumber);
    if (upErr) throw upErr;
    console.log(`flipped ${a.enroleeNumber}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
