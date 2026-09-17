// scripts/backfill/apply-youngstarters-ay2026.ts
// Puts the YoungStarters class on the AY2026 roster: one section, 15 children.
//
// WHY. `levels` has carried a `YS` row ("Youngstarters") since the schema was
// created, but NO academic year has ever had a YS section — AY2025, AY2026 and
// AY2027 all have zero. So the school's youngest class does not exist in any
// module: no register, no P-File, no adviser, nothing. Every one of these 15
// children sits in admissions at `applicationStatus = 'Submitted'` with
// `classStatus` null, which is where the pipeline left them.
//
// ── WHERE THE ROSTER CAME FROM ─────────────────────────────────────────────
//
// `List of Students.xlsx` → sheet "Class Lists", the first block. It has the
// same shape as every other section in that sheet: an index column, names, and
// student numbers, with literal blank rows at the holes (#4, #7, #9). The
// parallel "YoungStarters" photo sheet lists the same 15 children in the same
// order and adds the adviser (Ms Nisha) and each child's tier.
//
// 🔴 THE STUDENT NUMBERS COME FROM THE CLASS LIST, NOT FROM ADMISSIONS — and
// this is the opposite of the rule adopted on 2026-09-17 for P1–S4, so here is
// the evidence. Admissions gives these children `H26…` numbers minted from
// their enrolee number by the New-student rule (E260357 → H260357). The class
// list gives them `Y…` numbers. The Y numbers are the real ones:
//
//   * The SIS ALREADY HOLDS TEN Y-NUMBERED STUDENTS — Y210003…Y230016 — and
//     every one is a former YoungStarter now in Primary (Y230007 Ocampo, Clay
//     Elijah was YS in AY2025 and is P1 in AY2026, under the SAME number).
//     So `Y` is HFSE's prefix for a child who started in YoungStarters, and it
//     is carried into Primary unchanged. That is exactly what Hard Rule #4
//     asks a studentNumber to do.
//   * THE INTAKE YEAR IN THE PREFIX MATCHES EACH CHILD'S FIRST YS YEAR, one
//     for one. Mathusudhanan Brianna is Y240006 and was already YS in AY2025;
//     Bedico (Y250006), Infante (Y250004), Sia (Y250007) and Vergara (Y250005)
//     all appear in AY2025 admissions as Youngstarters; the nine children who
//     are new this year are Y26xxxx. A fifteen-for-fifteen fit is not a
//     coincidence.
//   * NONE OF THE FIFTEEN COLLIDES with a number already in `students`, so
//     unlike the P1–S4 case there is nothing to fuse. That was the whole
//     reason for refusing the school's numbers there; the reason is absent
//     here.
//
//   ⚠ CONSEQUENCE: admissions is carrying the WRONG studentNumber for all 15,
//   the same defect class as Santos Kairo Alonzo. Not fixed here — the fix
//   belongs on the admissions row and would need its own pass.
//
// ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//
// 🔴 NO TEACHER IS ASSIGNED. Neither candidate has an account: a sweep of all
// 1,092 auth users finds no Khim and no Nisha. And the two sources disagree —
// `Teachers Deployment_Updated 29 Jun 26` gives the YoungStarters column to
// Ms. Khim, while the September class list's photo sheet heads the block
// "Ms Nisha". `sections.form_class_adviser` is display-only text, so the
// September name is recorded there; the real `teacher_assignments` row needs
// an account first.
//
// 🔴 TWO LIVE YS APPLICANTS ARE NOT ON THE CLASS LIST and are NOT placed:
// PANULAYA, Via Cristina Matilda (E260352, Junior Star) and MAGAT, Skyler Jae
// (E260485, Little Star), both `Submitted`. The list has three holes (#4, #7,
// #9) and two unlisted children — the counts DIFFER, so the holes do not
// explain them and a guess would put a child under the wrong number.
//
// ⚠ The tier (Little / Junior / Senior Star) is NOT stored. It lives only in
// the admissions `levelApplied` string, in four different spellings, and the
// SIS has one YS level with nowhere to put it. The class list disagrees with
// admissions on one child anyway (Canta: list says Junior, admissions says
// Little), so it is not a fact this script can settle.
//
// ⚠ `enrollment_date` IS LEFT NULL, matching all 376 active AY2026 rows. A
// stamp of today would be a date nobody observed, and a wrong one breaks the
// attendance rollups.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default. Re-runnable: it refuses anything already present.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-youngstarters-ay2026.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-youngstarters-ay2026.ts --apply

import { createServiceClient } from '../../lib/supabase/service';

const AY = 'AY2026';
const LEVEL_CODE = 'YS';
const SECTION_NAME = 'Youngstarters';
// From the September class list's photo sheet. The June deployment says
// Ms. Khim — see the header. Display-only either way.
const FORM_CLASS_ADVISER = 'Ms Nisha';

const APPLY = process.argv.includes('--apply');

type Child = {
  index: number;
  studentNumber: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  /** The AY2026 admissions row this child was matched to. Recorded so the
   *  match is checkable, and so the wrong `H…` number stays visible. */
  enroleeNumber: string;
  admissionsStudentNumber: string;
};

/** "Class Lists" block 1, in its own order. Middle names come from the
 *  admissions `enroleeFullName`, which spells them out; the class list only
 *  carries the initial. */
const ROSTER: Child[] = [
  // prettier-ignore
  { index: 1,  studentNumber: 'Y250006', lastName: 'Bedico',        firstName: 'Miguel Zion',        middleName: 'Cabigting', enroleeNumber: 'E260357', admissionsStudentNumber: 'H260357' },
  // prettier-ignore
  { index: 2,  studentNumber: 'Y240009', lastName: 'Alvarez',       firstName: 'Jianna Ava Elisse',  middleName: 'Briones',   enroleeNumber: 'E260420', admissionsStudentNumber: 'H260420' },
  // prettier-ignore
  { index: 3,  studentNumber: 'Y260001', lastName: 'Canta',         firstName: 'Juliam Lukas',       middleName: 'Quigao',    enroleeNumber: 'E260379', admissionsStudentNumber: 'H260379' },
  // prettier-ignore
  { index: 5,  studentNumber: 'Y250004', lastName: 'Infante',       firstName: 'Myles Gabrielle',    middleName: 'Aquino',    enroleeNumber: 'E260369', admissionsStudentNumber: 'H260369' },
  // prettier-ignore
  { index: 6,  studentNumber: 'Y260003', lastName: 'Jaramilla',     firstName: 'Zed Adriel',         middleName: 'Rodriguez', enroleeNumber: 'E260475', admissionsStudentNumber: 'H260475' },
  // prettier-ignore
  { index: 8,  studentNumber: 'Y240006', lastName: 'Mathusudhanan', firstName: 'Brianna',            middleName: 'Balocos',   enroleeNumber: 'E260470', admissionsStudentNumber: 'H233414' },
  // prettier-ignore
  { index: 10, studentNumber: 'Y260005', lastName: 'Rosales',       firstName: 'Janella Marielle',   middleName: 'De Guzman', enroleeNumber: 'E260011', admissionsStudentNumber: 'H260011' },
  // prettier-ignore
  { index: 11, studentNumber: 'Y260006', lastName: 'Semodio',       firstName: 'Aeron Kryztofer',    middleName: 'Reyes',     enroleeNumber: 'E260407', admissionsStudentNumber: 'H260407' },
  // prettier-ignore
  { index: 12, studentNumber: 'Y250007', lastName: 'Sia',           firstName: 'Atarah Isabelle',    middleName: 'Enrera',    enroleeNumber: 'E260385', admissionsStudentNumber: 'H260385' },
  // prettier-ignore
  { index: 13, studentNumber: 'Y250005', lastName: 'Vergara',       firstName: 'Xaria Lia Elena',    middleName: 'Co',        enroleeNumber: 'E260373', admissionsStudentNumber: 'H260373' },
  // prettier-ignore
  { index: 14, studentNumber: 'Y260007', lastName: 'Sencir',        firstName: 'Jalen Alyxander',    middleName: 'Flojo',     enroleeNumber: 'E260487', admissionsStudentNumber: 'H260487' },
  // prettier-ignore
  { index: 15, studentNumber: 'Y260008', lastName: 'Abdon',         firstName: 'Reika Mei',          middleName: 'Bautista',  enroleeNumber: 'E260484', admissionsStudentNumber: 'H260484' },
  // prettier-ignore
  { index: 16, studentNumber: 'Y260009', lastName: 'Borromeo',      firstName: 'Angelie Cloud',      middleName: 'Quiapo',    enroleeNumber: 'E260424', admissionsStudentNumber: 'H260424' },
  // prettier-ignore
  { index: 17, studentNumber: 'Y260010', lastName: 'Gabaldon',      firstName: 'Gerard Marqael',     middleName: 'Bondoc',    enroleeNumber: 'E260523', admissionsStudentNumber: 'H260523' },
  // ⚠ The photo sheet calls her "GONZALES Alicia". The Class Lists tab — the
  // same workbook, the authoritative roster block — calls her "GONZALES,
  // ALLYSHA AJ", and she is the only Gonzales anywhere in the YS band, with
  // the tier agreeing. Admissions has her as Allysha Aj, dob 2020-11-22. The
  // photo sheet is the outlier; the roster name wins.
  // prettier-ignore
  { index: 18, studentNumber: 'Y260011', lastName: 'Gonzales',      firstName: 'Allysha Aj',         middleName: null,        enroleeNumber: 'E260534', admissionsStudentNumber: 'H260534' },
];

async function main() {
  const supabase = createServiceClient();

  const { data: ayRow, error: ayErr } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  if (ayErr || !ayRow) throw new Error(`no ${AY}: ${ayErr?.message}`);
  const ayId = (ayRow as { id: string }).id;

  const { data: levelRow, error: lvErr } = await supabase
    .from('levels')
    .select('id, label')
    .eq('code', LEVEL_CODE)
    .single();
  if (lvErr || !levelRow)
    throw new Error(`no ${LEVEL_CODE} level: ${lvErr?.message}`);
  const levelId = (levelRow as { id: string }).id;

  // ── 1. The section ────────────────────────────────────────────────────────
  const { data: existingSection } = await supabase
    .from('sections')
    .select('id, name, form_class_adviser')
    .eq('academic_year_id', ayId)
    .eq('level_id', levelId)
    .maybeSingle();

  let sectionId = (existingSection as { id: string } | null)?.id ?? null;

  if (sectionId) {
    console.log(
      `Section: ${LEVEL_CODE} ${(existingSection as { name: string }).name} already exists — reusing.`
    );
  } else if (!APPLY) {
    console.log(
      `Section: would CREATE ${LEVEL_CODE} ${SECTION_NAME}, adviser "${FORM_CLASS_ADVISER}".`
    );
  } else {
    const { data: created, error: secErr } = await supabase
      .from('sections')
      .insert({
        academic_year_id: ayId,
        level_id: levelId,
        name: SECTION_NAME,
        // The class list marks no Global/Standard stream for this block, and
        // YoungStarters is not streamed. Left null rather than guessed.
        class_type: null,
        form_class_adviser: FORM_CLASS_ADVISER,
      })
      .select('id')
      .single();
    if (secErr) throw secErr;
    sectionId = (created as { id: string }).id;
    console.log(
      `Section: created ${LEVEL_CODE} ${SECTION_NAME} (${sectionId}).`
    );
  }

  // ── 2. Which children need what ───────────────────────────────────────────
  const numbers = ROSTER.map((c) => c.studentNumber);
  const { data: existingStudents, error: stErr } = await supabase
    .from('students')
    .select('id, student_number, last_name, first_name')
    .in('student_number', numbers);
  if (stErr) throw stErr;
  const studentByNumber = new Map(
    ((existingStudents ?? []) as Record<string, string>[]).map((s) => [
      s.student_number,
      s,
    ])
  );

  // ⚠ A child could already be in the SIS under the admissions H-number from
  // some earlier pass. That would be a SECOND identity for the same child, so
  // say so loudly rather than quietly adding a Y row beside it.
  const { data: hRows } = await supabase
    .from('students')
    .select('id, student_number, last_name, first_name')
    .in(
      'student_number',
      ROSTER.map((c) => c.admissionsStudentNumber)
    );
  if ((hRows ?? []).length) {
    console.log(
      '\n🔴 These children already exist under their ADMISSIONS number:'
    );
    for (const h of hRows as Record<string, string>[]) {
      console.log(`   ${h.student_number}  ${h.last_name}, ${h.first_name}`);
    }
    console.log(
      '   Placing them under a Y number would create a second identity. Stop and look.\n'
    );
    return;
  }

  const roster = sectionId
    ? ((
        await supabase
          .from('section_students')
          .select('index_number, student_id')
          .eq('section_id', sectionId)
      ).data ?? [])
    : [];
  const takenIndex = new Map(
    (roster as { index_number: number; student_id: string }[]).map((r) => [
      Number(r.index_number),
      String(r.student_id),
    ])
  );
  const alreadyEnrolled = new Set(
    (roster as { index_number: number; student_id: string }[]).map((r) =>
      String(r.student_id)
    )
  );

  const toCreate: Child[] = [];
  const toEnrol: Child[] = [];
  const refused: string[] = [];

  for (const c of ROSTER) {
    const existing = studentByNumber.get(c.studentNumber);
    if (!existing) toCreate.push(c);

    const studentId = existing ? String(existing.id) : null;
    if (studentId && alreadyEnrolled.has(studentId)) {
      refused.push(
        `${c.lastName}, ${c.firstName}: already on the ${LEVEL_CODE} roster`
      );
      continue;
    }
    const occupant = takenIndex.get(c.index);
    if (occupant && occupant !== studentId) {
      refused.push(
        `${c.lastName}, ${c.firstName}: #${c.index} is already held by someone else`
      );
      continue;
    }
    toEnrol.push(c);
  }

  console.log(`\nYoungStarters — ${AY}`);
  console.log(`  students rows to create: ${toCreate.length}`);
  console.log(`  roster rows to create:   ${toEnrol.length}\n`);
  for (const c of toEnrol) {
    const isNew = toCreate.includes(c);
    console.log(
      `  #${String(c.index).padStart(2)}  ${c.studentNumber}  ${`${c.lastName}, ${c.firstName}`.padEnd(34)} ${isNew ? '(new student row)' : '(student row exists)'}  ← ${c.enroleeNumber}, admissions says ${c.admissionsStudentNumber}`
    );
  }
  if (refused.length) {
    console.log('\nRefused:');
    refused.forEach((r) => console.log(`  🔴 ${r}`));
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    return;
  }

  // ── 3. Write ──────────────────────────────────────────────────────────────
  console.log('\nApplying…');
  for (const c of toCreate) {
    const { data, error } = await supabase
      .from('students')
      .insert({
        student_number: c.studentNumber,
        last_name: c.lastName,
        first_name: c.firstName,
        middle_name: c.middleName,
        is_active: true,
      })
      .select('id, student_number')
      .single();
    if (error) throw error;
    studentByNumber.set(c.studentNumber, data as Record<string, string>);
    console.log(`  students: ${c.studentNumber} ${c.lastName}, ${c.firstName}`);
  }

  for (const c of toEnrol) {
    const student = studentByNumber.get(c.studentNumber);
    if (!student) throw new Error(`${c.studentNumber} missing after create`);
    const { error } = await supabase.from('section_students').insert({
      section_id: sectionId,
      student_id: student.id,
      index_number: c.index,
      enrollment_status: 'active',
      enrollment_date: null,
    });
    if (error) throw error;
    console.log(
      `  roster:   #${String(c.index).padStart(2)} ${c.lastName}, ${c.firstName}`
    );
  }

  console.log(
    `\nDone. ${toCreate.length} student(s), ${toEnrol.length} roster row(s).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
