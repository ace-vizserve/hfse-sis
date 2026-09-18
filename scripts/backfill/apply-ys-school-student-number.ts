// scripts/backfill/apply-ys-school-student-number.ts
// Puts the YoungStarters numbers the right way round.
//
// WHAT WENT WRONG. On 2026-09-18 the 15 AY2026 YoungStarters were created with
// the school's own numbers (Y250006, Y240009, …) in `students.student_number`,
// taken from the "Class Lists" tab of `List of Students.xlsx`. Admissions holds
// different ones (H260357, H260420, …).
//
// 🔴 WHY THAT IS WRONG, AND IT IS NOT ABOUT THE LINK. The roster row's
// `enrolee_number` is what joins Records to Admissions, and it is filled, so
// nothing is disconnected. The problem is the STUDENT SYNC: it reads the
// admissions `studentNumber`, looks for a student holding it, and INSERTS A NEW
// STUDENT when it finds none. A `student_number` that disagrees with admissions
// does not break a join — it silently splits one child into two the next time
// that child syncs. Today those 15 are skipped because admissions records no
// classLevel/classSection for them; the moment the office fills those in, the
// duplicates appear.
//
// WHAT THIS DOES. `student_number` goes back to the admissions value, which is
// the system's key. The school's number moves to `school_student_number`
// (migration 169), which is reference data — nothing joins or syncs on it, and
// staff may correct it.
//
// ⚠ THE OTHER TEN Y-NUMBERED STUDENTS ARE NOT TOUCHED. Y210005, Y230007 and the
// rest already agree with admissions — admissions itself holds their Y number.
// A Y prefix is not the fault; disagreeing with admissions is. Moving them would
// create exactly the split this script exists to prevent.
//
// ⚠ Verified collision-free before writing: none of the 15 target H numbers is
// held by another student, and the script re-checks at run time.
//
// ⚠ Service-role writes leave NO `audit_log` row. The reasoning lives here.
//
// Dry run by default. Re-runnable: rows already correct are reported, not rewritten.
//
//   npx tsx --env-file=.env.local scripts/backfill/apply-ys-school-student-number.ts
//   npx tsx --env-file=.env.local scripts/backfill/apply-ys-school-student-number.ts --apply

import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

type Fix = { school: string; system: string; who: string; enrolee: string };

/** school number (currently in student_number) → admissions number (must be). */
const FIX: Fix[] = [
  {
    school: 'Y250006',
    system: 'H260357',
    who: 'Bedico, Miguel Zion',
    enrolee: 'E260357',
  },
  {
    school: 'Y240009',
    system: 'H260420',
    who: 'Alvarez, Jianna Ava Elisse',
    enrolee: 'E260420',
  },
  {
    school: 'Y260001',
    system: 'H260379',
    who: 'Canta, Juliam Lukas',
    enrolee: 'E260379',
  },
  {
    school: 'Y250004',
    system: 'H260369',
    who: 'Infante, Myles Gabrielle',
    enrolee: 'E260369',
  },
  {
    school: 'Y260003',
    system: 'H260475',
    who: 'Jaramilla, Zed Adriel',
    enrolee: 'E260475',
  },
  {
    school: 'Y240006',
    system: 'H233414',
    who: 'Mathusudhanan, Brianna',
    enrolee: 'E260470',
  },
  {
    school: 'Y260005',
    system: 'H260011',
    who: 'Rosales, Janella Marielle',
    enrolee: 'E260011',
  },
  {
    school: 'Y260006',
    system: 'H260407',
    who: 'Semodio, Aeron Kryztofer',
    enrolee: 'E260407',
  },
  {
    school: 'Y250007',
    system: 'H260385',
    who: 'Sia, Atarah Isabelle',
    enrolee: 'E260385',
  },
  {
    school: 'Y250005',
    system: 'H260373',
    who: 'Vergara, Xaria Lia Elena',
    enrolee: 'E260373',
  },
  {
    school: 'Y260007',
    system: 'H260487',
    who: 'Sencir, Jalen Alyxander',
    enrolee: 'E260487',
  },
  {
    school: 'Y260008',
    system: 'H260484',
    who: 'Abdon, Reika Mei',
    enrolee: 'E260484',
  },
  {
    school: 'Y260009',
    system: 'H260424',
    who: 'Borromeo, Angelie Cloud',
    enrolee: 'E260424',
  },
  {
    school: 'Y260010',
    system: 'H260523',
    who: 'Gabaldon, Gerard Marqael',
    enrolee: 'E260523',
  },
  {
    school: 'Y260011',
    system: 'H260534',
    who: 'Gonzales, Allysha Aj',
    enrolee: 'E260534',
  },
];

async function main() {
  const sb = createServiceClient();

  // The column must exist, or this writes nothing and says why.
  const { error: colErr } = await sb
    .from('students')
    .select('school_student_number')
    .limit(1);
  if (colErr) {
    console.log('🔴 `students.school_student_number` is not there yet.');
    console.log(
      '   Apply supabase/migrations/169_school_student_number.sql first.'
    );
    console.log(`   (${colErr.message})`);
    return;
  }

  const ready: Fix[] = [];
  const done: string[] = [];
  const refused: string[] = [];

  for (const f of FIX) {
    // Already fixed by an earlier run?
    const { data: already } = await sb
      .from('students')
      .select('id,student_number,school_student_number')
      .eq('student_number', f.system)
      .maybeSingle();
    if (already) {
      const s = already as Record<string, string | null>;
      done.push(
        `${f.who}: already ${f.system}` +
          (s.school_student_number === f.school
            ? `, school number ${f.school} set`
            : `, school number ${s.school_student_number ?? 'NOT SET'}`)
      );
      continue;
    }

    const { data: row } = await sb
      .from('students')
      .select('id,student_number')
      .eq('student_number', f.school)
      .maybeSingle();
    if (!row) {
      refused.push(`${f.who}: no student holds ${f.school}`);
      continue;
    }

    // The target must be free — `student_number` is unique and non-deferrable.
    const { data: clash } = await sb
      .from('students')
      .select('student_number,last_name,first_name')
      .eq('student_number', f.system)
      .maybeSingle();
    if (clash) {
      const c = clash as Record<string, string>;
      refused.push(
        `${f.who}: ${f.system} is held by ${c.last_name}, ${c.first_name}`
      );
      continue;
    }

    // Admissions must actually carry this number under this enrolee, so the
    // value written is the one the sync will look for — not one from a list.
    const { data: app } = await sb
      .from('ay2026_enrolment_applications')
      .select('"enroleeNumber","studentNumber"')
      .eq('enroleeNumber', f.enrolee)
      .maybeSingle();
    const said = (app as Record<string, string> | null)?.studentNumber;
    if (said !== f.system) {
      refused.push(
        `${f.who}: admissions ${f.enrolee} says ${said ?? 'null'}, not ${f.system}`
      );
      continue;
    }

    ready.push(f);
  }

  console.log('YoungStarters — student_number back to the admissions value\n');
  for (const f of ready) {
    console.log(
      `  ${f.who.padEnd(32)} student_number ${f.school} → ${f.system}   school_student_number ← ${f.school}`
    );
  }
  if (done.length) {
    console.log('\nAlready correct:');
    done.forEach((d) => console.log(`  ✅ ${d}`));
  }
  if (refused.length) {
    console.log('\nRefused:');
    refused.forEach((r) => console.log(`  🔴 ${r}`));
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — ${ready.length} row(s) would change. Re-run with --apply.`
    );
    return;
  }

  console.log('\nApplying…');
  for (const f of ready) {
    const { error } = await sb
      .from('students')
      .update({ student_number: f.system, school_student_number: f.school })
      .eq('student_number', f.school);
    if (error) throw error;
    console.log(
      `  ${f.school} → ${f.system}  (school number kept as ${f.school})`
    );
  }
  console.log(`\nDone. ${ready.length} row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
