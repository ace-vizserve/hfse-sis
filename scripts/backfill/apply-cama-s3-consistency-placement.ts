// scripts/backfill/apply-cama-s3-consistency-placement.ts
// Puts Ashley Rae Climacosa Cama (H260359 / E260359) on the AY2026
// S3 Consistency roster as a WITHDRAWN row at index #5.
//
// WHY SHE IS MISSING, AND WHY IT IS WORSE THAN JANNAT AJMAL'S CASE. Ajmal had
// a `students` row and was merely absent from the roster. Cama has NO
// `students` ROW AT ALL — she exists only in admissions. So nothing in the SIS
// knows this child, and she is invisible on every screen in every module, not
// just on her class register.
//
// Her AY2026 `ay2026_enrolment_status` row reads `applicationStatus =
// Withdrawn`, `levelApplied = Secondary Three`, enrolled 2025-10-15, fees paid,
// contract signed. So she enrolled, was placed, and then left — exactly the
// shape Hard Rule #6 covers: a withdrawn student KEEPS their
// `section_students` row with `enrollment_status = 'withdrawn'` rather than
// disappearing.
//
// ⚠ THE ADMISSIONS TABLES DISAGREE WITH EACH OTHER, AND `_enrolment_status`
// IS THE ONE TO READ. `ay2026_enrolment_applications.applicationStatus` still
// says "Registered" for her; `ay2026_enrolment_status.applicationStatus` says
// "Withdrawn", and that is what the SIS shows and what the office sees. This
// cost a wrong answer twice during the 2026-09-16 session before Mr Ace
// corrected it — read `_enrolment_status` for a stage, never `_applications`.
//
// WHY #5, AND WHY NO SHIFT. Mr Ace supplied the slot from the masterlist, and
// the alphabet agrees exactly — so unlike the Ajmal placement, nobody else
// moves:
//
//   #3 Calimbas, Audrey       (active)
//   #4 Calvo, Jarred Nyl      (active)
//   #5 Cama, Ashley Rae       <- vacant, and where the alphabet puts her
//   #6 Chuatingco, Hugh       (active)
//
// #5 has been an unexplained hole in this section since the AY2026 roster was
// built. It was hers.
//
// WITHDRAWAL DATE — 2026-04-26, and it took a second look to find.
//
// ⚠ IT IS NOT IN A DATE COLUMN. `ay2026_enrolment_status` has no withdrawal
// date field at all; the office writes it as prose in `applicationRemarks`:
//
//   "<p>Withdrawal approved 11 May 2026<br>Last Day: 26 April 2026</p>"
//
// The LAST DAY is what `section_students.withdrawal_date` means — the day the
// child stopped attending — not the day the withdrawal was approved. The two
// are two weeks apart here, and using the approval date would give her two
// weeks of attendance she did not attend.
//
// ⚠ THIS IS NOT JUST HER. 23 AY2026 rows are Withdrawn and most carry a last
// day in the same prose field, in at least five different wordings ("Last Day:",
// "Last Day", "last Day of attendance", "Last Day of Attendance:") and one with
// no year at all. Ajmal (E260401) has one too — "Last Day of Attendance: 8 May
// 2026" — which contradicts the note recorded on 2026-09-15 saying the school
// held no date for her. Parsing all 23 is a separate job and is NOT done here;
// this script sets one date that was read by eye and is unambiguous.
//
// ⚠ `enrollment_date` is taken from admissions (`enrolmentDate` 2025-10-15).
// AY2026 Term 1 starts 2026-01-08, so that date puts her in the ON-TIME bucket
// of `generate_section_index_numbers` — correct, she was an original member of
// this class, not a late arrival.
//
// WHAT IS AND IS NOT WRITTEN
//   written:     one `students` row, one `section_students` row (withdrawn, #5)
//   NOT written: her admissions record, which is correct as it stands. No
//                grades and no attendance — she has none, and this creates none.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW EXISTS for this change.
// The reasoning above is the record. Same as the Ajmal and Cacao placements.
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill/apply-cama-s3-consistency-placement.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/backfill/apply-cama-s3-consistency-placement.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';
const SECTION_NAME = 'Consistency';
const LEVEL_CODE = 'S3';
const INDEX_NUMBER = 5;

const STUDENT_NUMBER = 'H260359';
const LAST_NAME = 'Cama';
const FIRST_NAME = 'Ashley Rae';
const MIDDLE_NAME = 'Climacosa';
/** From `ay2026_enrolment_status.enrolmentDate`. Before T1 start, so on-time. */
const ENROLLMENT_DATE = '2025-10-15';
/** Her LAST DAY, read out of `applicationRemarks` — not the 11 May approval. */
const WITHDRAWAL_DATE = '2026-04-26';

async function main() {
  const apply = process.argv.includes('--apply');
  const svc = createServiceClient();

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: section, error: secErr } = await svc
    .from('sections')
    .select('id, name, levels!inner(code)')
    .eq('academic_year_id', (ay as { id: string }).id)
    .eq('name', SECTION_NAME)
    .eq('levels.code', LEVEL_CODE)
    .single();
  if (secErr) throw secErr;
  const sectionId = (section as { id: string }).id;

  // ---- Refuse rather than duplicate -------------------------------------
  const { data: existing } = await svc
    .from('students')
    .select('id, student_number')
    .eq('student_number', STUDENT_NUMBER)
    .maybeSingle();
  if (existing) {
    // She was placed by an earlier run of this script, before her last day had
    // been found in `applicationRemarks`. Fill that in and stop — re-running
    // must never create a second row.
    const studentId = (existing as { id: string }).id;
    const { data: row } = await svc
      .from('section_students')
      .select('id, index_number, withdrawal_date')
      .eq('student_id', studentId)
      .eq('section_id', sectionId)
      .maybeSingle();

    if (!row) {
      throw new Error(
        `${STUDENT_NUMBER} has a students row but no ${LEVEL_CODE} ${SECTION_NAME} enrolment. Stop and look.`
      );
    }
    const current = row as { id: string; withdrawal_date: string | null };
    if (current.withdrawal_date === WITHDRAWAL_DATE) {
      console.log(
        `${STUDENT_NUMBER} already placed, withdrawal_date already ${WITHDRAWAL_DATE}. Nothing to do.`
      );
      return;
    }

    console.log(
      `${STUDENT_NUMBER} already placed. withdrawal_date ${current.withdrawal_date ?? 'null'} -> ${WITHDRAWAL_DATE}`
    );
    if (!apply) {
      console.log('\nDry run. Re-run with --apply to write.');
      return;
    }
    const { error: updErr } = await svc
      .from('section_students')
      .update({ withdrawal_date: WITHDRAWAL_DATE })
      .eq('id', current.id);
    if (updErr) throw updErr;
    console.log('  withdrawal_date set.');
    return;
  }

  // ---- The slot must still be free --------------------------------------
  // `unique (section_id, index_number)` is non-deferrable, so a taken slot is
  // a hard failure at insert. Checking first turns that into a clear message.
  const { data: occupant } = await svc
    .from('section_students')
    .select('id, index_number, student:students(last_name, first_name)')
    .eq('section_id', sectionId)
    .eq('index_number', INDEX_NUMBER)
    .maybeSingle();
  if (occupant) {
    const s = occupant as unknown as {
      student: { last_name: string; first_name: string } | null;
    };
    throw new Error(
      `#${INDEX_NUMBER} is no longer free — it holds ${s.student?.last_name}, ${s.student?.first_name}. Stop and re-check the masterlist.`
    );
  }

  console.log(`${LEVEL_CODE} ${SECTION_NAME} (${AY_CODE})`);
  console.log(
    `  create students row       ${STUDENT_NUMBER}  ${LAST_NAME}, ${FIRST_NAME} ${MIDDLE_NAME}`
  );
  console.log(
    `  create section_students   #${INDEX_NUMBER}  withdrawn  enrollment_date=${ENROLLMENT_DATE}  withdrawal_date=${WITHDRAWAL_DATE}`
  );

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  const { data: inserted, error: insErr } = await svc
    .from('students')
    .insert({
      student_number: STUDENT_NUMBER,
      last_name: LAST_NAME,
      first_name: FIRST_NAME,
      middle_name: MIDDLE_NAME,
      // She has left. `is_active` is the student-level flag; the roster row
      // below carries the enrolment-level truth.
      is_active: false,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  const studentId = (inserted as { id: string }).id;
  console.log(`  students row created: ${studentId}`);

  const { error: ssErr } = await svc.from('section_students').insert({
    section_id: sectionId,
    student_id: studentId,
    index_number: INDEX_NUMBER,
    enrollment_status: 'withdrawn',
    enrollment_date: ENROLLMENT_DATE,
    withdrawal_date: null,
  });
  if (ssErr) throw ssErr;
  console.log(`  section_students row created at #${INDEX_NUMBER}`);

  // ---- Read it back ------------------------------------------------------
  const { data: check } = await svc
    .from('section_students')
    .select(
      'index_number, enrollment_status, student:students(student_number, last_name, first_name)'
    )
    .eq('section_id', sectionId)
    .gte('index_number', 3)
    .lte('index_number', 7)
    .order('index_number');
  console.log('\nAfter:');
  for (const r of (check ?? []) as unknown as Array<{
    index_number: number;
    enrollment_status: string;
    student: { student_number: string; last_name: string; first_name: string };
  }>) {
    console.log(
      `  #${r.index_number}  ${r.student.last_name}, ${r.student.first_name}  ${r.enrollment_status}  ${r.student.student_number}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
