// Read-only: what would the 7 school-vs-SIS number collisions look like AFTER
// the school's number is recorded in `school_student_number`?
//
// The question is whether a second column resolves them. It resolves the
// STORAGE (different columns, no constraint broken) but not the AMBIGUITY: one
// string can then name two children depending which column is read.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-number-collisions.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

/** number → the child the SCHOOL gives it to (from the class list). */
const COLLISIONS: { number: string; schoolGivesItTo: string }[] = [
  { number: 'H260010', schoolGivesItTo: 'Borja, Aaron Paul' },
  { number: 'H260011', schoolGivesItTo: 'Carreon, Lucian Devon' },
  { number: 'H260012', schoolGivesItTo: 'David, Nathan Angelo' },
  { number: 'H260047', schoolGivesItTo: 'Moreno, Elijah' },
  { number: 'H260050', schoolGivesItTo: 'Barbiran, Dien Jilliana Yvainne' },
  { number: 'H250078', schoolGivesItTo: 'Bien, Sebastian Miguel' },
  { number: 'H260057', schoolGivesItTo: 'Udtuhan, Matthew Jordan' },
];

async function main() {
  console.log(
    'After recording the school number, "search for X" would return:\n'
  );

  for (const c of COLLISIONS) {
    // Who holds it as their SYSTEM number today?
    const { data: sys } = await sb
      .from('students')
      .select('student_number,last_name,first_name')
      .eq('student_number', c.number)
      .maybeSingle();
    const holder = sys
      ? `${(sys as any).last_name}, ${(sys as any).first_name}`
      : '(nobody)';

    const sameChild =
      holder.split(',')[0].toUpperCase() ===
      c.schoolGivesItTo.split(',')[0].toUpperCase();

    console.log(`  ${c.number}`);
    console.log(`     as a SYSTEM number  → ${holder}`);
    console.log(`     as a SCHOOL number  → ${c.schoolGivesItTo}`);
    console.log(
      sameChild
        ? '     ✅ same child — no ambiguity'
        : '     🔴 TWO DIFFERENT CHILDREN answer to this number'
    );
  }

  // And the reason it happens: the school is re-assigning the SAME POOL of
  // numbers in a different order, so collisions are structural, not accidental.
  console.log('\nWhy this happens — the same numbers, assigned differently:');
  for (const n of ['H260057', 'H260012']) {
    const { data: s } = await sb
      .from('students')
      .select('student_number,last_name,first_name')
      .eq('student_number', n)
      .maybeSingle();
    const school = COLLISIONS.find((c) => c.number === n)?.schoolGivesItTo;
    console.log(
      `  ${n}: SIS says ${(s as any)?.last_name}, ${(s as any)?.first_name} — school says ${school}`
    );
  }
  console.log(
    '  David, Nathan Angelo is the SIS holder of H260057 AND the school holder of'
  );
  console.log(
    '  H260012. The school has not mis-numbered anyone; it has permuted the set.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
