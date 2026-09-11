// scripts/backfill/apply-force-enrol-cacao.ts
// Force-enrols Karl Miguel Cacao (H170072 / E260309) into AY2026 S4 Excellence
// and imports his Term 3 attendance.
//
// WHY FORCED. His application sits at "Submitted" with no class assigned, yet
// his contract is Signed and his fees are Paid (HFSE052023, 12 Nov) and he has
// been in class since the first day of Term 3. The registration, assessment,
// supplies and orientation stages have no data and the school does not hold
// it, so the normal pipeline cannot be walked. Mr Ace, 2026-09-12: "i think we
// should force enroll cacao since i dont have details regarding his
// registration, assessment, supplies and orientation".
//
// WHAT IS AND IS NOT WRITTEN
//   written:     applicationStatus -> Enrolled, classLevel, classSection,
//                a section_students row, and his 34 attendance marks
//   NOT written: registration / assessment / supplies / orientation stages.
//                They stay null, which is the ordinary shape here — 283 of the
//                406 enrolled children have a null classStatus too.
//
// ⚠ This bypasses the Admissions module, so no audit_log row is written for
// the stage change. That is the cost of forcing it and is the reason the
// reasoning above is recorded in this file.
//
// index_number 39 appends at the bottom of the section (KD #136). The free
// numbers below it (4, 11, 20) are NOT reused — the register simply numbers
// that class one ahead of the SIS.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-force-enrol-cacao.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-force-enrol-cacao.ts --apply
import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbookT3 } from '../../lib/sis/backfill/attendance/attendance-workbook-t3';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 3;
const YEAR = 2026;
const WORKBOOK = 'AY2026 Term 3 Attendance Latest.xlsx';
const APPLY = process.argv.includes('--apply');

const STUDENT_NUMBER = 'H170072';
const ENROLEE_NUMBER = 'E260309';
const LEVEL_CODE = 'S4';
const SECTION_NAME = 'Excellence';
const CLASS_LEVEL_LABEL = 'Secondary Four';
const REGISTER_SHEET = 'S4 Excellence';
const REGISTER_INDEX = 5;
const NEW_INDEX = 39;

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};
const VALID = new Set(['P', 'A', 'EX', 'L']);

function isoFor(raw: string): string | null {
  const [d, mon] = raw.split('-');
  const m = MONTHS[mon];
  return m ? `${YEAR}-${m}-${d.padStart(2, '0')}` : null;
}

async function main() {
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: term, error: tErr } = await svc
    .from('terms')
    .select('id')
    .eq('academic_year_id', (ay as any).id)
    .eq('term_number', TERM_NUMBER)
    .single();
  if (tErr) throw tErr;

  const { data: student, error: sErr } = await svc
    .from('students')
    .select('id, student_number, last_name, first_name')
    .eq('student_number', STUDENT_NUMBER)
    .single();
  if (sErr) throw sErr;

  const { data: section, error: secErr } = await svc
    .from('sections')
    .select('id, name, levels!inner(code)')
    .eq('academic_year_id', (ay as any).id)
    .eq('name', SECTION_NAME)
    .eq('levels.code', LEVEL_CODE)
    .single();
  if (secErr) throw secErr;

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);
  console.log(
    `  student:  ${(student as any).student_number} "${(student as any).last_name}, ${(student as any).first_name}"`
  );
  console.log(
    `  section:  ${LEVEL_CODE} ${SECTION_NAME} (${(section as any).id})`
  );

  // --- guards ---
  const { data: existing } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, sections!inner(academic_year_id)'
    )
    .eq('student_id', (student as any).id)
    .eq('sections.academic_year_id', (ay as any).id);
  if ((existing ?? []).length > 0) {
    console.log('\n  already placed this year:');
    for (const e of existing as any[])
      console.log(`    #${e.index_number} ${e.enrollment_status}`);
    console.log('  nothing to do');
    return;
  }

  const { data: taken } = await svc
    .from('section_students')
    .select('index_number')
    .eq('section_id', (section as any).id)
    .eq('index_number', NEW_INDEX);
  if ((taken ?? []).length > 0)
    throw new Error(`index ${NEW_INDEX} is already taken in ${SECTION_NAME}`);
  console.log(`  index:    ${NEW_INDEX} (appended at the bottom, KD #136)`);

  // --- his register row ---
  const sheets = parseWorkbookT3(WORKBOOK);
  const sheet = sheets.find((s) => s.section.sheetName === REGISTER_SHEET);
  if (!sheet) throw new Error(`sheet "${REGISTER_SHEET}" not found`);
  const row = sheet.section.students.find(
    (s) => Number.parseInt(s.indexNo, 10) === REGISTER_INDEX
  );
  if (!row) throw new Error(`no register row #${REGISTER_INDEX}`);
  if (!row.fullName.toUpperCase().includes('CACAO, KARL'))
    throw new Error(
      `register row #${REGISTER_INDEX} reads "${row.fullName}" — not Cacao; recheck before running`
    );

  const { data: cal, error: cErr } = await svc
    .from('school_calendar')
    .select('date, day_type')
    .eq('term_id', (term as any).id);
  if (cErr) throw cErr;
  const teaching = new Set(
    (cal as any[]).filter((c) => c.day_type === 'school_day').map((c) => c.date)
  );

  const marks: { date: string; status: string }[] = [];
  for (const [rawDate, rawMark] of Object.entries(row.marks)) {
    const iso = isoFor(rawDate);
    if (!iso || !teaching.has(iso)) continue;
    const m = rawMark.trim().toUpperCase();
    if (!m || !VALID.has(m)) continue;
    marks.push({ date: iso, status: m });
  }
  const tally = new Map<string, number>();
  for (const m of marks) tally.set(m.status, (tally.get(m.status) ?? 0) + 1);
  console.log(
    `  register: "${row.fullName}" — ${marks.length} marks on teaching days (${[...tally].map(([k, v]) => `${k}=${v}`).join(' ')})`
  );
  console.log(
    `            ${marks[0]?.date} .. ${marks[marks.length - 1]?.date}`
  );

  console.log('\n  admissions changes:');
  console.log('    applicationStatus  Submitted -> Enrolled');
  console.log(`    classLevel         (null) -> ${CLASS_LEVEL_LABEL}`);
  console.log(`    classSection       (null) -> ${SECTION_NAME}`);
  console.log(
    '    registration / assessment / supplies / orientation: LEFT NULL (no data held)'
  );

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  // --- 1. place him ---
  const { data: placed, error: pErr } = await svc
    .from('section_students')
    .insert({
      section_id: (section as any).id,
      student_id: (student as any).id,
      index_number: NEW_INDEX,
      enrollment_status: 'active',
      // left NULL deliberately: every other child in this section has it null,
      // and a non-null date makes the rollup prorate from it.
      enrollment_date: null,
    })
    .select('id')
    .single();
  if (pErr)
    throw new Error(
      `placement failed: ${pErr.message ?? JSON.stringify(pErr)}`
    );
  const ssId = (placed as any).id;
  console.log(`\n  placed — section_students ${ssId}`);

  // --- 2. admissions ---
  const { error: aErr } = await svc
    .from('ay2026_enrolment_status')
    .update({
      applicationStatus: 'Enrolled',
      classLevel: CLASS_LEVEL_LABEL,
      classSection: SECTION_NAME,
    })
    .eq('enroleeNumber', ENROLEE_NUMBER);
  if (aErr)
    throw new Error(
      `admissions update failed: ${aErr.message ?? JSON.stringify(aErr)}`
    );
  console.log('  admissions updated');

  // --- 3. his attendance ---
  const { error: mErr } = await svc.from('attendance_daily').insert(
    marks.map((m) => ({
      section_student_id: ssId,
      term_id: (term as any).id,
      date: m.date,
      status: m.status,
      ex_reason: null,
      ex_note: null,
      period_id: null,
      recorded_by: null,
    }))
  );
  if (mErr)
    throw new Error(`marks failed: ${mErr.message ?? JSON.stringify(mErr)}`);
  console.log(`  imported ${marks.length} marks`);

  const { error: rErr } = await svc.rpc('recompute_attendance_rollup', {
    p_term_id: (term as any).id,
    p_section_student_id: ssId,
  });
  if (rErr)
    throw new Error(`rollup failed: ${rErr.message ?? JSON.stringify(rErr)}`);

  // --- verify ---
  console.log('\nverifying...');
  const { data: check } = await svc
    .from('attendance_records')
    .select(
      'school_days, days_present, days_late, days_excused, days_absent, attendance_pct'
    )
    .eq('term_id', (term as any).id)
    .eq('section_student_id', ssId)
    .single();
  console.log(`  rollup: ${JSON.stringify(check)}`);

  const { data: adm } = await svc
    .from('ay2026_enrolment_status')
    .select('"applicationStatus", "classLevel", "classSection"')
    .eq('enroleeNumber', ENROLEE_NUMBER)
    .single();
  console.log(`  admissions: ${JSON.stringify(adm)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
