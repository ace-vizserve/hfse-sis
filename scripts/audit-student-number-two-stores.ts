// Read-only: how far apart are the two places a student number lives?
//
// `students.student_number` (Records, the SIS side) and
// `ay{YYYY}_enrolment_applications."studentNumber"` (Admissions) are separate
// columns in separate tables. Nothing keeps them in step. This counts the gap.
//
// Usage: npx tsx --env-file=.env.local scripts/audit-student-number-two-stores.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

const norm = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

async function main() {
  const { data: students } = await sb
    .from('students')
    .select('student_number,last_name,first_name');
  const sisNumbers = new Set(
    (students ?? []).map((s: any) => s.student_number)
  );
  const sisByName = new Map<string, string[]>();
  for (const s of students ?? []) {
    const k = norm(`${(s as any).last_name}${(s as any).first_name}`);
    sisByName.set(k, [...(sisByName.get(k) ?? []), (s as any).student_number]);
  }

  for (const ay of ['ay2025', 'ay2026', 'ay2027']) {
    const { data: apps } = await sb
      .from(`${ay}_enrolment_applications`)
      .select('"enroleeNumber","studentNumber","lastName","firstName"');

    let matched = 0;
    let noSisRow = 0;
    const disagree: string[] = [];

    for (const a of apps ?? []) {
      const num = (a as any).studentNumber as string | null;
      if (!num) continue;
      if (sisNumbers.has(num)) {
        matched++;
        continue;
      }

      // Admissions' number has no Records row. Does the CHILD have one, under
      // a different number? That is a genuine disagreement, not a gap.
      const k = norm(`${(a as any).lastName}${(a as any).firstName}`);
      const other = sisByName.get(k);
      if (other?.length) {
        disagree.push(
          `${(a as any).enroleeNumber}  admissions ${num}  →  Records ${other.join('/')}  ${(a as any).lastName}, ${(a as any).firstName}`
        );
      } else {
        noSisRow++;
      }
    }

    console.log(`\n=== ${ay.toUpperCase()} ===`);
    console.log(`  number agrees with a Records row : ${matched}`);
    console.log(
      `  child is in Records under a DIFFERENT number : ${disagree.length}`
    );
    console.log(
      `  no Records row at all (applicant, or never enrolled) : ${noSisRow}`
    );
    if (disagree.length) {
      console.log('  ─ the disagreements ─');
      for (const d of disagree.slice(0, 40)) console.log('   ', d);
      if (disagree.length > 40)
        console.log(`    … and ${disagree.length - 40} more`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
