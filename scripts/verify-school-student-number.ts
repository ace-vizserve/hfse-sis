// scripts/verify-school-student-number.ts
// Independent check that migration 169 + the YoungStarters backfill landed.
//
// Deliberately re-derives everything from the database rather than trusting the
// backfill's own output — it checks the SYNC-SAFETY property that was the whole
// point (student_number == the admissions studentNumber), not just that some
// rows changed.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-school-student-number.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const EXPECT: {
  system: string;
  school: string;
  enrolee: string;
  who: string;
}[] = [
  {
    system: 'H260357',
    school: 'Y250006',
    enrolee: 'E260357',
    who: 'Bedico, Miguel Zion',
  },
  {
    system: 'H260420',
    school: 'Y240009',
    enrolee: 'E260420',
    who: 'Alvarez, Jianna Ava Elisse',
  },
  {
    system: 'H260379',
    school: 'Y260001',
    enrolee: 'E260379',
    who: 'Canta, Juliam Lukas',
  },
  {
    system: 'H260369',
    school: 'Y250004',
    enrolee: 'E260369',
    who: 'Infante, Myles Gabrielle',
  },
  {
    system: 'H260475',
    school: 'Y260003',
    enrolee: 'E260475',
    who: 'Jaramilla, Zed Adriel',
  },
  {
    system: 'H233414',
    school: 'Y240006',
    enrolee: 'E260470',
    who: 'Mathusudhanan, Brianna',
  },
  {
    system: 'H260011',
    school: 'Y260005',
    enrolee: 'E260011',
    who: 'Rosales, Janella Marielle',
  },
  {
    system: 'H260407',
    school: 'Y260006',
    enrolee: 'E260407',
    who: 'Semodio, Aeron Kryztofer',
  },
  {
    system: 'H260385',
    school: 'Y250007',
    enrolee: 'E260385',
    who: 'Sia, Atarah Isabelle',
  },
  {
    system: 'H260373',
    school: 'Y250005',
    enrolee: 'E260373',
    who: 'Vergara, Xaria Lia Elena',
  },
  {
    system: 'H260487',
    school: 'Y260007',
    enrolee: 'E260487',
    who: 'Sencir, Jalen Alyxander',
  },
  {
    system: 'H260484',
    school: 'Y260008',
    enrolee: 'E260484',
    who: 'Abdon, Reika Mei',
  },
  {
    system: 'H260424',
    school: 'Y260009',
    enrolee: 'E260424',
    who: 'Borromeo, Angelie Cloud',
  },
  {
    system: 'H260523',
    school: 'Y260010',
    enrolee: 'E260523',
    who: 'Gabaldon, Gerard Marqael',
  },
  {
    system: 'H260534',
    school: 'Y260011',
    enrolee: 'E260534',
    who: 'Gonzales, Allysha Aj',
  },
];

/** Y numbers that predate the YoungStarters import and must NOT have moved. */
const UNTOUCHED = [
  'Y210003',
  'Y210004',
  'Y210005',
  'Y230003',
  'Y230006',
  'Y230007',
  'Y230010',
  'Y230011',
  'Y230013',
  'Y230016',
];

let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log(`  🔴 ${m}`);
};
const pass = (m: string) => console.log(`  ✅ ${m}`);

async function main() {
  // ── 1. The column and its partial unique index ──────────────────────────
  console.log('1. Column');
  const { error: colErr } = await sb
    .from('students')
    .select('school_student_number')
    .limit(1);
  if (colErr) {
    fail(`school_student_number missing: ${colErr.message}`);
    return;
  }
  pass('students.school_student_number exists');

  // ── 2. Each child: system number, school number, and sync safety ────────
  console.log('\n2. The 15 YoungStarters');
  const { data: apps } = await sb
    .from('ay2026_enrolment_applications')
    .select('"enroleeNumber","studentNumber"')
    .in(
      'enroleeNumber',
      EXPECT.map((e) => e.enrolee)
    );
  const admissionsSays = new Map(
    (apps ?? []).map((a: Record<string, string>) => [
      a.enroleeNumber,
      a.studentNumber,
    ])
  );

  for (const e of EXPECT) {
    const { data: rows } = await sb
      .from('students')
      .select('id,student_number,school_student_number,last_name,first_name')
      .or(`student_number.eq.${e.system},school_student_number.eq.${e.school}`);

    if ((rows ?? []).length === 0) {
      fail(`${e.who}: no row under ${e.system} or ${e.school}`);
      continue;
    }
    if ((rows ?? []).length > 1) {
      fail(
        `${e.who}: ${(rows ?? []).length} rows — DUPLICATE CHILD (${(rows ?? []).map((r: any) => r.student_number).join(', ')})`
      );
      continue;
    }
    const r = (rows ?? [])[0] as Record<string, string | null>;

    const problems: string[] = [];
    if (r.student_number !== e.system)
      problems.push(
        `student_number is ${r.student_number}, expected ${e.system}`
      );
    if (r.school_student_number !== e.school)
      problems.push(
        `school_student_number is ${r.school_student_number ?? 'null'}, expected ${e.school}`
      );

    // THE POINT OF THE WHOLE CHANGE: does the sync's key match admissions?
    const said = admissionsSays.get(e.enrolee);
    if (said !== r.student_number)
      problems.push(
        `admissions ${e.enrolee} says ${said ?? 'null'} — SYNC WOULD DUPLICATE`
      );

    if (problems.length) fail(`${e.who}: ${problems.join('; ')}`);
    else
      pass(
        `${e.who.padEnd(30)} ${e.system}  (school ${e.school})  matches admissions`
      );
  }

  // ── 3. The roster link survived the renumber ────────────────────────────
  console.log('\n3. Roster');
  const { data: ay } = await sb
    .from('academic_years')
    .select('id')
    .eq('ay_code', 'AY2026')
    .single();
  const { data: lv } = await sb
    .from('levels')
    .select('id')
    .eq('code', 'YS')
    .single();
  const { data: sec } = await sb
    .from('sections')
    .select('id,name,form_class_adviser')
    .eq('academic_year_id', (ay as any).id)
    .eq('level_id', (lv as any).id)
    .maybeSingle();
  if (!sec) {
    fail('no AY2026 YS section');
  } else {
    const { data: roster } = await sb
      .from('section_students')
      .select(
        'index_number,enrolee_number,students(student_number,school_student_number,last_name)'
      )
      .eq('section_id', (sec as any).id)
      .order('index_number');
    const n = (roster ?? []).length;
    if (n !== 15) fail(`YS roster has ${n} rows, expected 15`);
    else pass('15 children on the YS roster');

    const unlinked = (roster ?? []).filter((r: any) => !r.enrolee_number);
    if (unlinked.length)
      fail(`${unlinked.length} roster row(s) lost enrolee_number`);
    else
      pass(
        'every roster row still carries enrolee_number (the admissions link)'
      );

    const idx = (roster ?? []).map((r: any) => r.index_number).join(',');
    const want = '1,2,3,5,6,8,10,11,12,13,14,15,16,17,18';
    if (idx !== want) fail(`index numbers are ${idx}, expected ${want}`);
    else pass('index numbers unchanged, holes at 4/7/9 preserved');
  }

  // ── 4. The ten older Y-numbered students were not disturbed ─────────────
  console.log('\n4. Pre-existing Y-numbered students');
  const { data: old } = await sb
    .from('students')
    .select('student_number,school_student_number,last_name,first_name')
    .in('student_number', UNTOUCHED);
  if ((old ?? []).length !== UNTOUCHED.length) {
    fail(
      `${(old ?? []).length} of ${UNTOUCHED.length} still hold their Y number`
    );
  } else
    pass(`all ${UNTOUCHED.length} still hold their Y number in student_number`);

  // ── 5. Nothing else in the table picked up a school number by accident ──
  // ⚠ THIS CHECK USED TO ASSERT "exactly 15 students carry a school number",
  // and that was a BAD TEST. It was true for one afternoon: the very next task
  // recorded the school's number for 206 more children, which is the column
  // working as intended, and the check failed on correct work. An assertion
  // about a global count nobody promised to hold is noise the moment anything
  // else touches the table.
  //
  // What actually matters is that each of the 15 Y numbers belongs to the child
  // it was meant for and to nobody else — which stays true however many other
  // children get one.
  console.log('\n5. Blast radius');
  const { data: filled } = await sb
    .from('students')
    .select('student_number,school_student_number,last_name,first_name')
    .in(
      'school_student_number',
      EXPECT.map((e) => e.school)
    );
  const byYNumber = new Map(
    (filled ?? []).map((r: any) => [r.school_student_number, r])
  );
  const misowned = EXPECT.filter((e) => {
    const holder = byYNumber.get(e.school) as any;
    return !holder || holder.student_number !== e.system;
  });
  if (misowned.length) {
    for (const m of misowned) {
      const holder = byYNumber.get(m.school) as any;
      fail(
        `${m.school} should belong to ${m.who} (${m.system}) but is ${holder ? `held by ${holder.last_name}, ${holder.first_name} (${holder.student_number})` : 'held by nobody'}`
      );
    }
  } else
    pass(
      `all ${EXPECT.length} YoungStarters school numbers belong to the right child, and to nobody else`
    );

  // ── 6. No stray Y rows left behind by the update ────────────────────────
  const { data: strayY } = await sb
    .from('students')
    .select('student_number,last_name,first_name')
    .in(
      'student_number',
      EXPECT.map((e) => e.school)
    );
  if ((strayY ?? []).length) {
    fail(
      `${(strayY ?? []).length} row(s) still hold a Y number as their student_number: ${(strayY ?? []).map((s: any) => s.student_number).join(', ')}`
    );
  } else
    pass('no leftover rows holding a YoungStarters Y number as the system key');

  console.log(
    failures === 0
      ? '\n✅ ALL CHECKS PASSED'
      : `\n🔴 ${failures} CHECK(S) FAILED`
  );
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
