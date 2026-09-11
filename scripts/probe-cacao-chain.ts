// scripts/probe-cacao-chain.ts
// Read-only. Traces Karl Miguel Cacao end to end through every table that
// could place him, and sanity-checks that the admissions/records alignment
// audit is comparing real values rather than passing trivially.
//
// Run: npx tsx --env-file=.env.local scripts/probe-cacao-chain.ts
import { createServiceClient } from '../lib/supabase/service';

const AY_CODE = 'AY2026';

async function main() {
  const svc = createServiceClient();

  console.log('=== admissions: status row ===');
  const { data: st } = await svc
    .from('ay2026_enrolment_status')
    .select(
      '"enroleeNumber", "enroleeName", "applicationStatus", "classStatus", "classAY", "classLevel", "classSection", "levelApplied", "enroleeType", "enrolmentDate"'
    )
    .ilike('enroleeName', '%KARL MIGUEL%');
  for (const r of (st ?? []) as any[]) console.log(' ', JSON.stringify(r));

  console.log('\n=== admissions: application row ===');
  const { data: app } = await svc
    .from('ay2026_enrolment_applications')
    .select('"enroleeNumber", "studentNumber", "applicationStatus"')
    .ilike('enroleeNumber', 'E260309');
  for (const r of (app ?? []) as any[]) console.log(' ', JSON.stringify(r));

  const sn = (app as any[])?.[0]?.studentNumber ?? null;
  console.log('\n  studentNumber from the application:', sn);

  console.log('\n=== students table: any Cacao ===');
  const { data: stu } = await svc
    .from('students')
    .select('id, student_number, last_name, first_name, middle_name, is_active')
    .ilike('last_name', '%CACAO%');
  for (const r of (stu ?? []) as any[]) console.log(' ', JSON.stringify(r));

  console.log('\n=== section_students for every Cacao, all academic years ===');
  const ids = ((stu ?? []) as any[]).map((s) => s.id);
  if (ids.length) {
    const { data: ss } = await svc
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, student_id, sections!inner(name, academic_year_id, levels!inner(code, label), academic_years!inner(ay_code))'
      )
      .in('student_id', ids);
    for (const r of (ss ?? []) as any[])
      console.log(
        `  ${r.sections.academic_years.ay_code}  ${r.sections.levels.code} ${r.sections.name} #${r.index_number}  ${r.enrollment_status}  student_id=${r.student_id}`
      );
    if (!(ss ?? []).length) console.log('  (none)');
  }

  // --- is the alignment audit actually comparing anything? ---
  console.log('\n=== sanity: are the admissions class columns populated? ===');
  const { data: all } = await svc
    .from('ay2026_enrolment_status')
    .select('"applicationStatus", "classLevel", "classSection"');
  const rows = (all ?? []) as any[];
  const enrolled = rows.filter((r) => r.applicationStatus === 'Enrolled');
  const withLevel = enrolled.filter(
    (r) => r.classLevel && String(r.classLevel).trim()
  );
  const withSection = enrolled.filter(
    (r) => r.classSection && String(r.classSection).trim()
  );
  console.log(`  enrolled rows:        ${enrolled.length}`);
  console.log(`  classLevel filled:    ${withLevel.length}`);
  console.log(`  classSection filled:  ${withSection.length}`);
  const levels = new Map<string, number>();
  for (const r of enrolled)
    levels.set(
      r.classLevel ?? '(null)',
      (levels.get(r.classLevel ?? '(null)') ?? 0) + 1
    );
  console.log('  distinct classLevel values:');
  for (const [k, v] of [...levels].sort()) console.log(`    ${k}: ${v}`);
  const sections = new Set(enrolled.map((r) => r.classSection));
  console.log(`  distinct classSection values: ${sections.size}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
