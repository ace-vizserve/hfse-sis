// scripts/backfill/apply-withdrawn-placements-from-house-list.ts
// Puts six withdrawn AY2026 students back on the rosters they left.
//
// Hard Rule #6: a withdrawn student KEEPS their `section_students` row with
// `enrollment_status = 'withdrawn'` and their retired index number. These
// children vanished from their rosters instead — so they are invisible on
// every screen in every module, not just on their class register.
//
// WHERE THE SECTIONS CAME FROM, AFTER A WEEK OF NOT KNOWING. The blocker was
// that admissions records a child's LEVEL, not their CLASS — and an index hole
// proves somebody is missing without ever saying who. The house-colour
// allocation the school sent on 2026-09-17 turned out to list these children
// UNDER THEIR SECTION, which is the mapping nothing else had.
//
// ✅ IT CHECKS OUT AGAINST WORK ALREADY APPROVED. That same file puts Ashley
// Rae Cama in S3 Consistency and Jannat Ajmal in S3 Consistency — the two
// placements Mr Ace approved and applied by hand on 15–16 Sep, from Miss Jo's
// masterlist. A source that independently reproduces two known-good answers is
// worth trusting for the rest.
//
// WHERE THE INDEX NUMBERS CAME FROM. Each child's section has exactly one hole
// their surname fits alphabetically — the same reasoning the approved Cama
// placement used ("the alphabet agrees exactly, so nobody else moves"):
//
//   Singson, Alexxa Micayla   P2 Humility     #25   between Santiago and Taruc
//   Bruno, Johannah Shalom    P4 Trust         #5   between Borja and Calahatian
//   Min Phone Naing, Kaung    P5 Commitment    #9   between Mangaraja and Ocampo
//   Boquiren, Alonzo Lucas    P5 Tenacity      #3   between Bernabe and Borromeo
//   Ajmal, Muhammad Ibrahim   P6 Loyalty       #2   between Abineta and Batino
//   Chanco, Jilliane Ysabelle S2 Integrity 2   #8   between Carreon and De Pedro
//
// 🔴 SEVEN OTHERS ARE DELIBERATELY NOT HERE. Suzara, Singson Adrianna, Irawan,
// Ziaudeen and Ganelo sit in sections whose remaining holes are in the
// NON-ALPHABETICAL TAIL, where late arrivals were appended — position proves
// nothing there, so their numbers have to come from the school.
//
// 🔴 AND SANTOS, KAIRO ALONZO IS HELD ON PURPOSE. He has two admissions rows:
// E260303 (studentNumber H233489, category "Current") and E260494
// (studentNumber V260494, category "VizSchool Current"). That is a regular
// record AND a VizSchool one, not a simple duplicate, and he has no `students`
// row under either. Placing him without deciding which record is the child's
// would put him on the roster twice or under the wrong identity.
//
// ⚠ ALL SIX ALREADY HAVE A `students` ROW, so this only inserts
// `section_students`. That is the difference from the Cama script, which had
// to create the child as well.
//
// ⚠ `withdrawal_date` IS LEFT NULL. Since migration 163 it means LAST DAY OF
// ATTENDANCE, and the school has not given one for these six. A null is
// honest; a stamp of today would be a date nobody observed. ⚠ Consequence: a
// withdrawn row with no date does NOT appear in the Records Withdrawals count,
// which keys on the date rather than the status.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-withdrawn-placements-from-house-list.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-withdrawn-placements-from-house-list.ts --apply

import { createServiceClient } from '../../lib/supabase/service';

const AY = 'AY2026';
const APPLY = process.argv.includes('--apply');

type Placement = {
  who: string;
  studentNumber: string;
  enroleeNumber: string;
  levelCode: string;
  sectionName: string;
  index: number;
  /** The two names the slot sits between, so the reasoning is re-checkable
   *  against the roster at apply time rather than only in this comment. */
  between: [string, string];
};

const PLACEMENTS: Placement[] = [
  {
    who: 'Singson, Alexxa Micayla',
    studentNumber: 'H250277',
    enroleeNumber: 'E260108',
    levelCode: 'P2',
    sectionName: 'Humility',
    index: 25,
    between: ['Santiago', 'Taruc'],
  },
  {
    who: 'Bruno, Johannah Shalom',
    studentNumber: 'H230036',
    enroleeNumber: 'E260269',
    levelCode: 'P4',
    sectionName: 'Trust',
    index: 5,
    between: ['Borja', 'Calahatian'],
  },
  {
    who: 'Min Phone Naing, Kaung Khant',
    studentNumber: 'H243760',
    enroleeNumber: 'E260444',
    levelCode: 'P5',
    sectionName: 'Commitment',
    index: 9,
    between: ['Mangaraja', 'Ocampo'],
  },
  {
    who: 'Boquiren, Alonzo Lucas',
    studentNumber: 'H220028',
    enroleeNumber: 'E260019',
    levelCode: 'P5',
    sectionName: 'Tenacity',
    index: 3,
    between: ['Bernabe', 'Borromeo'],
  },
  {
    who: 'Ajmal, Muhammad Ibrahim',
    studentNumber: 'H250921',
    enroleeNumber: 'E260402',
    levelCode: 'P6',
    sectionName: 'Loyalty',
    index: 2,
    between: ['Abineta', 'Batino'],
  },
  {
    who: 'Chanco, Jilliane Ysabelle',
    studentNumber: 'H250553',
    enroleeNumber: 'E260232',
    levelCode: 'S2',
    sectionName: 'Integrity 2',
    index: 8,
    between: ['Carreon', 'De Pedro'],
  },
  // ⚠ SANTOS WAS HELD IN THE FIRST RUN, AND THE REASON DISSOLVED ON LOOKING.
  //
  // He has two AY2026 applications — E260303 (studentNumber H233489, category
  // "Current") and E260494 (V260494, "VizSchool Current") — and NEITHER number
  // has a `students` row. That looked like an identity question that had to go
  // to the school before he could be placed.
  //
  // It is not. He is ALREADY IN THE SIS as H240037, sitting on the AY2025
  // P3 Courageous roster at #3. Both AY2026 rows minted a NEW number for a
  // child who already had one, which is exactly what reusing a Current
  // student's number exists to prevent — so H233489 and V260494 are the
  // artifacts and H240037 is the identity carrying his history (Hard Rule #4).
  //
  // P3 Courageous in AY2025 → Primary Four in AY2026 (both admissions rows say
  // levelApplied = Primary Four), and the house list puts him in P4 Trust.
  // #5 went to Bruno, leaving #25 — where SANTOS falls between Ramos and
  // Soriano.
  //
  // ⚠ `enroleeNumber` recorded as E260303, the REGULAR record. The VizSchool
  // row is a separate question for the school (why two applications at all)
  // and does not change where the child sits.
  {
    who: 'Santos, Kairo Alonzo',
    studentNumber: 'H240037',
    enroleeNumber: 'E260303',
    levelCode: 'P4',
    sectionName: 'Trust',
    index: 25,
    between: ['Ramos', 'Soriano'],
  },
];

async function main() {
  const supabase = createServiceClient();

  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const ayId = (ayRow as { id: string }).id;

  const { data: levels } = await supabase.from('levels').select('id, code');
  const levelIdByCode = new Map(
    ((levels ?? []) as { id: string; code: string }[]).map((l) => [
      l.code,
      l.id,
    ])
  );

  const { data: sections } = await supabase
    .from('sections')
    .select('id, name, level_id')
    .eq('academic_year_id', ayId);

  const ready: { p: Placement; sectionId: string; studentId: string }[] = [];
  const refused: string[] = [];

  for (const p of PLACEMENTS) {
    const levelId = levelIdByCode.get(p.levelCode);
    const sec = ((sections ?? []) as Record<string, string>[]).find(
      (s) => s.name === p.sectionName && s.level_id === levelId
    );
    if (!sec) {
      refused.push(`${p.who}: no section ${p.levelCode} ${p.sectionName}`);
      continue;
    }

    const { data: studentRows, error: stErr } = await supabase
      .from('students')
      .select('id, last_name, first_name')
      .eq('student_number', p.studentNumber);
    if (stErr)
      throw new Error(`${p.who}: students read failed: ${stErr.message}`);
    if (!studentRows?.length) {
      refused.push(`${p.who}: no students row for ${p.studentNumber}`);
      continue;
    }
    const student = studentRows[0] as Record<string, string>;

    const { data: roster, error: rErr } = await supabase
      .from('section_students')
      .select('id, index_number, student_id, enrollment_status')
      .eq('section_id', sec.id);
    if (rErr) throw new Error(`${p.who}: roster read failed: ${rErr.message}`);

    // Already placed? Then this has run before and there is nothing to do.
    if (
      (roster ?? []).some(
        (r) => (r as Record<string, string>).student_id === student.id
      )
    ) {
      refused.push(
        `${p.who}: already on the ${p.levelCode} ${p.sectionName} roster`
      );
      continue;
    }

    // The slot must be free. `unique (section_id, index_number)` would reject
    // it anyway; refusing here says WHO holds it instead of raising 23505.
    const occupant = (roster ?? []).find(
      (r) => (r as Record<string, number>).index_number === p.index
    );
    if (occupant) {
      refused.push(
        `${p.who}: #${p.index} in ${p.levelCode} ${p.sectionName} is taken`
      );
      continue;
    }

    // Re-check the alphabet against the live roster rather than trusting the
    // header comment — the neighbours are the whole argument for this number.
    const ids = (roster ?? []).map((r) =>
      String((r as Record<string, string>).student_id)
    );
    const { data: mates } = await supabase
      .from('students')
      .select('id, last_name')
      .in('id', ids);
    const nameById = new Map(
      ((mates ?? []) as Record<string, string>[]).map((m) => [
        m.id,
        m.last_name,
      ])
    );
    const at = (n: number) => {
      const row = (roster ?? []).find(
        (r) => (r as Record<string, number>).index_number === n
      );
      return row
        ? nameById.get(String((row as Record<string, string>).student_id))
        : undefined;
    };
    const before = at(p.index - 1);
    const after = at(p.index + 1);
    if (before !== p.between[0] || after !== p.between[1]) {
      refused.push(
        `${p.who}: neighbours moved — expected ${p.between[0]}/${p.between[1]}, found ${before ?? '(none)'}/${after ?? '(none)'}`
      );
      continue;
    }

    ready.push({ p, sectionId: sec.id, studentId: student.id });
  }

  console.log(`Withdrawn placements — ${AY}\n`);
  for (const r of ready) {
    console.log(
      `  • ${r.p.who} → ${r.p.levelCode} ${r.p.sectionName} #${r.p.index} (withdrawn), between ${r.p.between[0]} and ${r.p.between[1]}`
    );
  }
  if (refused.length) {
    console.log('\nRefused:');
    refused.forEach((r) => console.log(`  🔴 ${r}`));
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${ready.length} row(s). Re-run with --apply.`);
    return;
  }

  console.log('\nApplying…');
  for (const r of ready) {
    const { error } = await supabase.from('section_students').insert({
      section_id: r.sectionId,
      student_id: r.studentId,
      index_number: r.p.index,
      enrollment_status: 'withdrawn',
      enrolee_number: r.p.enroleeNumber,
      // withdrawal_date deliberately omitted — see the header.
    });
    if (error) throw new Error(`${r.p.who}: insert failed: ${error.message}`);
    console.log(`  ✅ ${r.p.who}`);
  }

  console.log('\nRead-back:');
  for (const r of ready) {
    const { data } = await supabase
      .from('section_students')
      .select('index_number, enrollment_status, withdrawal_date')
      .eq('section_id', r.sectionId)
      .eq('student_id', r.studentId);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    console.log(
      `  ${r.p.who.padEnd(30)} #${row?.index_number} ${row?.enrollment_status} withdrawal_date=${row?.withdrawal_date ?? 'null'}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
