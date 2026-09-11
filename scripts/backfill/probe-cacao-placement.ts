// scripts/backfill/probe-cacao-placement.ts
// Read-only. Answers one question: what AY2026 section is Karl Miguel Cacao
// in? Reports every source that has an opinion — Records, Admissions, the
// paper register — plus which Secondary Four sections exist and what index
// numbers are free, so placing him is a decision with the facts in front of it.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-cacao-placement.ts
import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';

const AY_CODE = 'AY2026';
const WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';
const STUDENT_NUMBER = 'H170072';

async function main() {
  const svc = createServiceClient();

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code');
  const ayById = new Map((years as any[]).map((y) => [y.id, y.ay_code]));
  const ay2026 = (years as any[]).find((y) => y.ay_code === AY_CODE)!.id;

  const { data: stu } = await svc
    .from('students')
    .select('id, student_number, last_name, first_name, middle_name')
    .eq('student_number', STUDENT_NUMBER)
    .single();
  console.log(
    `student record: ${(stu as any).student_number}  "${(stu as any).last_name}, ${(stu as any).first_name} ${(stu as any).middle_name ?? ''}"`
  );

  console.log('\n=== RECORDS — every placement he holds, any year ===');
  const { data: ss } = await svc
    .from('section_students')
    .select(
      'index_number, enrollment_status, sections!inner(name, academic_year_id, levels!inner(code, label))'
    )
    .eq('student_id', (stu as any).id);
  const rows = (ss ?? []) as any[];
  if (rows.length === 0) console.log('  (none)');
  for (const r of rows)
    console.log(
      `  ${ayById.get(r.sections.academic_year_id)}  ${r.sections.levels.code} ${r.sections.name} #${r.index_number}  ${r.enrollment_status}`
    );
  const thisYear = rows.filter((r) => r.sections.academic_year_id === ay2026);
  console.log(
    `  -> AY2026 section: ${thisYear.length ? thisYear.map((r) => `${r.sections.levels.code} ${r.sections.name}`).join(', ') : 'NONE — he is not placed this year'}`
  );

  console.log('\n=== ADMISSIONS ===');
  const { data: app } = await svc
    .from('ay2026_enrolment_applications')
    .select('"enroleeNumber", "studentNumber"')
    .eq('studentNumber', STUDENT_NUMBER);
  for (const a of (app ?? []) as any[]) {
    const { data: st } = await svc
      .from('ay2026_enrolment_status')
      .select(
        '"enroleeNumber", "enroleeName", "applicationStatus", "levelApplied", "classStatus", "classLevel", "classSection"'
      )
      .eq('enroleeNumber', a.enroleeNumber)
      .maybeSingle();
    const s = st as any;
    console.log(
      `  ${a.enroleeNumber}  "${s?.enroleeName}"  status=${s?.applicationStatus}`
    );
    console.log(`    levelApplied: ${s?.levelApplied ?? '-'}`);
    console.log(
      `    class assigned: ${s?.classLevel ?? '-'} / ${s?.classSection ?? '-'} (${s?.classStatus ?? '-'})`
    );
  }

  console.log('\n=== THE PAPER REGISTER ===');
  for (const sec of parseWorkbookT3(WORKBOOK)) {
    const hit = sec.section.students.filter((s) =>
      s.fullName.toUpperCase().includes('CACAO, KARL')
    );
    for (const h of hit) {
      const filled = Object.entries(h.marks).filter(([, v]) => v.trim());
      console.log(
        `  sheet "${sec.section.sheetName}" #${h.indexNo} "${h.fullName}" — ${filled.length} marks, ${filled[0]?.[0]} .. ${filled[filled.length - 1]?.[0]}`
      );
    }
  }

  console.log('\n=== Secondary Four sections that exist in AY2026 ===');
  const { data: secs } = await svc
    .from('sections')
    .select('id, name, class_type, levels!inner(code, label)')
    .eq('academic_year_id', ay2026)
    .eq('levels.code', 'S4');
  for (const s of (secs ?? []) as any[]) {
    const { count } = await svc
      .from('section_students')
      .select('*', { count: 'exact', head: true })
      .eq('section_id', s.id);
    const { data: idx } = await svc
      .from('section_students')
      .select('index_number')
      .eq('section_id', s.id)
      .order('index_number');
    const used = new Set(((idx ?? []) as any[]).map((r) => r.index_number));
    const free: number[] = [];
    for (let i = 1; i <= Math.max(...used, 0) + 1; i++)
      if (!used.has(i)) free.push(i);
    console.log(
      `  ${s.levels.label} "${s.name}" (${s.class_type ?? '-'}) — ${count} students, highest index ${Math.max(...used, 0)}`
    );
    console.log(
      `    free index numbers: ${free.length ? free.join(', ') : '(none below the top)'}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
