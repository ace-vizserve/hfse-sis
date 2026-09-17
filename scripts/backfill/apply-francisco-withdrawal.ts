// scripts/backfill/apply-francisco-withdrawal.ts
// Marks Francisco, Jelenna Rei Rojas (H250916) withdrawn from AY2026
// P2 Humility #10, last day of attendance 2026-02-26.
//
// THE REQUEST, AND WHY IT IS NOT DONE AS ASKED. Mr Wai Chung, FCA of
// P2 Humility, 2026-09-17: _"please remove index number 10, Francisco, Jelenna
// Rei Rojas from the attendance sheet and all grading sheets of P2-Humility.
// This student has left our school a long time ago."_
//
// Hard Rule #6 forbids removing her: a withdrawn student KEEPS their
// `section_students` row and their retired index number. Nothing here deletes
// anything. What it does instead produces exactly the effect he asked for:
//
//   * ATTENDANCE — `lib/attendance/daily-entry.ts:110`, `if (e.withdrawn)
//     return false`. She stops being markable and drops off the sheet.
//   * GRADING SHEETS — `app/api/grading-sheets/route.ts:241` builds a sheet's
//     roster with `.in('enrollment_status', ENROLLED_STATUSES)`, so she is
//     excluded from new sheets.
//
// So "withdrawn" IS "removed" from a teacher's side of the screen, while #10
// and her history survive.
//
// ✅ THREE THINGS INDEPENDENTLY AGREE SHE LEFT:
//   1. ZERO attendance marks on her AY2026 roster row — nobody ever marked her
//      present or absent, which matches "left a long time ago".
//   2. The school's own class list has a BLANK at #10 in P2 Humility. They
//      removed her from their list and left the hole.
//   3. Mr Wai Chung teaches the class.
//
// THE DATE. Supplied by the office via Mr Ace, 2026-09-17: _"was last seen on
// Thu26Feb2026."_ Since migration 163 `withdrawal_date` means LAST DAY OF
// ATTENDANCE, which is precisely what "last seen" is. Checked three ways
// before writing: 2026-02-26 IS a Thursday as stated, `school_calendar` has it
// as `day_type = 'school_day'` with `is_holiday = false`, and it falls inside
// Term 1 (2026-01-08 → 2026-03-13). A date that failed any of those would more
// likely be a typo than a fact.
//
// ⚠ `withdrawal_approved_date` IS LEFT NULL. Migration 163 added it for the
// date the school APPROVED the withdrawal, which nobody has given. Approval
// after departure is ordinary, so there is no check that it follows the last
// day — but inventing one would put a date on the record that no one observed.
//
// 🔴 ADMISSIONS STILL SAYS SHE IS ENROLLED, and this does not change that.
// `ay2026_enrolment_status` reads `Enrolled` for E260471, and `ay2025` reads
// `Enrolled` for E250916. That is the office's record to correct; until they
// do, anything reading admissions rather than the roster will still count her.
//
// ⚠ Service-role write, so NO `audit_log` row. The reasoning lives here.
//
// Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-francisco-withdrawal.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-francisco-withdrawal.ts --apply

import { createServiceClient } from '../../lib/supabase/service';

const STUDENT_NUMBER = 'H250916';
const AY = 'AY2026';
const SECTION = { levelCode: 'P2', name: 'Humility' };
const INDEX = 10;
const LAST_DAY = '2026-02-26';
const APPLY = process.argv.includes('--apply');

async function main() {
  const supabase = createServiceClient();

  const { data: students, error: stErr } = await supabase
    .from('students')
    .select('id, last_name, first_name, middle_name')
    .eq('student_number', STUDENT_NUMBER);
  if (stErr) throw new Error(`students read failed: ${stErr.message}`);
  const student = (students ?? [])[0] as Record<string, string> | undefined;
  if (!student) throw new Error(`no students row for ${STUDENT_NUMBER}`);

  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const { data: levels } = await supabase
    .from('levels')
    .select('id, code')
    .eq('code', SECTION.levelCode);
  const levelId = ((levels ?? [])[0] as { id: string } | undefined)?.id;

  const { data: sections } = await supabase
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', (ayRow as { id: string }).id)
    .eq('level_id', levelId)
    .eq('name', SECTION.name);
  const section = (sections ?? [])[0] as { id: string } | undefined;
  if (!section)
    throw new Error(`no section ${SECTION.levelCode} ${SECTION.name}`);

  const { data: rows, error: rErr } = await supabase
    .from('section_students')
    .select('id, index_number, enrollment_status, withdrawal_date')
    .eq('section_id', section.id)
    .eq('student_id', student.id);
  if (rErr) throw new Error(`roster read failed: ${rErr.message}`);
  const row = (rows ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error(
      `${student.last_name}, ${student.first_name} is not on the ${SECTION.levelCode} ${SECTION.name} roster`
    );
  }

  // The index number is the only thing identifying her in the teacher's
  // request. If it has moved, this is not the row he means.
  if (row.index_number !== INDEX) {
    throw new Error(
      `expected #${INDEX}, found #${row.index_number} — refusing, the request named #${INDEX}`
    );
  }

  console.log(
    `${student.last_name}, ${student.first_name} ${student.middle_name ?? ''} (${STUDENT_NUMBER})`
  );
  console.log(
    `  ${SECTION.levelCode} ${SECTION.name} #${row.index_number}  ${row.enrollment_status} → withdrawn`
  );
  console.log(
    `  withdrawal_date ${row.withdrawal_date ?? 'null'} → ${LAST_DAY}  (last day of attendance)`
  );

  if (
    row.enrollment_status === 'withdrawn' &&
    row.withdrawal_date === LAST_DAY
  ) {
    console.log('\n  already done — nothing to change.');
    return;
  }

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }

  const { error } = await supabase
    .from('section_students')
    .update({ enrollment_status: 'withdrawn', withdrawal_date: LAST_DAY })
    .eq('id', row.id);
  if (error) throw new Error(`update failed: ${error.message}`);

  const { data: after } = await supabase
    .from('section_students')
    .select(
      'index_number, enrollment_status, withdrawal_date, withdrawal_approved_date'
    )
    .eq('id', row.id);
  const check = (after ?? [])[0] as Record<string, unknown> | undefined;
  console.log('\nRead-back:');
  console.log(
    `  #${check?.index_number}  ${check?.enrollment_status}  last day ${check?.withdrawal_date}  approved ${check?.withdrawal_approved_date ?? 'null'}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
