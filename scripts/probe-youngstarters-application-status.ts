// Is the whole Youngstarters cohort outside the admissions funnel, or are
// these 15 individual slips? Read-only.
//
// WHY. `audit-stale-submitted-with-class.ts` found 15 AY2026 students in an
// active class whose applicationStatus still reads "Submitted" — and every
// one of them is in YS Youngstarters. 15 out of 15 from a single section is a
// cohort-wide pattern, not fifteen accidents, so the fix is NOT to bulk-flip
// them to Enrolled until this is settled.
//
// Prints every AY2026 section's active roster against the application
// statuses those students hold, so the answer is visible rather than inferred.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-youngstarters-application-status.ts

import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

async function main() {
  const ayCode = process.argv[2] ?? 'AY2026';
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) throw new Error(`No such academic year: ${ayCode}`);

  const { data: rows } = await service
    .from('section_students')
    .select(
      'enrollment_status, student:students(student_number), ' +
        'section:sections!inner(name, academic_year_id, level:levels(code))'
    )
    .eq('sections.academic_year_id', (ay as { id: string }).id)
    .in('enrollment_status', ['active', 'late_enrollee'])
    .limit(3000);

  type Row = {
    enrollment_status: string;
    student: { student_number: string | null } | null;
    section: {
      name: string;
      level: { code: string } | { code: string }[] | null;
    } | null;
  };

  const classRows = (rows ?? []) as unknown as Row[];
  const studentNumbers = classRows
    .map((r) => r.student?.student_number)
    .filter((v): v is string => !!v);

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
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

  const { data: statusRows } = await admissions
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationStatus')
    .in('enroleeNumber', [...enroleeByStudent.values()]);
  const statusByEnrolee = new Map(
    (
      (statusRows ?? []) as Array<{
        enroleeNumber: string | null;
        applicationStatus: string | null;
      }>
    ).map((r) => [r.enroleeNumber, r.applicationStatus])
  );

  // section → { status → count }
  const bySection = new Map<string, Map<string, number>>();
  for (const r of classRows) {
    const level = Array.isArray(r.section?.level)
      ? r.section?.level[0]
      : r.section?.level;
    const key =
      [level?.code, r.section?.name].filter(Boolean).join(' ') || '(unknown)';
    const sn = r.student?.student_number;
    const enrolee = sn ? enroleeByStudent.get(sn) : undefined;
    const status = enrolee
      ? (statusByEnrolee.get(enrolee) ?? 'MISSING')
      : 'NO APPLICATION ROW';
    const inner = bySection.get(key) ?? new Map<string, number>();
    inner.set(status, (inner.get(status) ?? 0) + 1);
    bySection.set(key, inner);
  }

  console.log(
    `${ayCode} — active roster by section, against the application status each student holds:\n`
  );
  for (const [section, statuses] of [...bySection.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const total = [...statuses.values()].reduce((s, n) => s + n, 0);
    const parts = [...statuses.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([s, n]) => `${s}=${n}`)
      .join('  ');
    console.log(
      `  ${section.padEnd(24)} ${String(total).padStart(3)} active   ${parts}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
