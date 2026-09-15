// scripts/backfill/apply-ajmal-s3-consistency-placement.ts
// Puts Jannat Saddique Ajmal (H250920 / E260401) back on the AY2026
// S3 Consistency roster as a WITHDRAWN row at index #1, and shifts the two
// children above her down to match Miss Jo's masterlist.
//
// WHY SHE IS MISSING. Her AY2026 admissions record is `applicationStatus =
// Withdrawn` with no classLevel and no classSection, and she has NO
// `section_students` row for AY2026 at all. Mr Ace, 2026-09-15: "shes an
// enrolled student that has been withdrawn basically" — so the Withdrawn
// status is correct and stays; what is wrong is that she vanished from the
// roster instead of staying on it greyed out. Hard Rule #6: a withdrawn
// student KEEPS their `section_students` row with
// `enrollment_status = 'withdrawn'`.
//
// Her only other record is AY2025 S2 Integrity #24, and S2 Integrity →
// S3 Consistency is the progression the rest of that cohort followed.
//
// WHY THE SHIFT. The masterlist numbers this class alphabetically, and Ajmal
// sorts above Antonio and Calimbas. Mr Ace, 2026-09-15: "insert and shift".
//
//   masterlist:  #1 Ajmal    #2 Antonio   #3 Calimbas
//   today:                   #1 Antonio   #2 Calimbas
//
// ⚠ THIS DEPARTS FROM KD #136, DELIBERATELY. That KD freezes index numbers
// after the year-start alphabetise and appends late arrivals instead of
// renumbering — which is why this very section has De Guzman at #27 and
// Traquena at #28, out of alphabetical order, and the late enrollees at
// #29-31. The masterlist is the authority here and it says #1/#2/#3, so two
// active children move. Nobody else in the section is touched.
//
// ⚠ ORDER IS LOAD-BEARING. `unique (section_id, index_number)` is
// NON-DEFERRABLE (migration 001), so a shift has to leave each target free
// before it is written. #3 is currently vacant, so the sequence below never
// collides and needs none of migration 042's negative-index staging:
//
//   1. Calimbas  2 -> 3   (3 was vacant)
//   2. Antonio   1 -> 2   (2 freed by step 1)
//   3. Ajmal     new #1   (1 freed by step 2)
//
// WHAT IS AND IS NOT WRITTEN
//   written:     one `section_students` row for Ajmal (withdrawn, #1), and
//                `index_number` on the two rows above her
//   NOT written: her admissions record — `applicationStatus = Withdrawn` with
//                no class is correct and stays. No grades, no attendance: she
//                has none for AY2026 and this creates none.
//
// ⚠ `withdrawal_date` is left NULL because the school does not hold one — her
// admissions record carries no terminal reason or date, and she has no AY2026
// attendance to infer a last-seen date from. Consequence: Records' Withdrawals
// KPI filters on `withdrawal_date` falling inside the picker range, so she
// will NOT appear in that count. She will appear on the roster, greyed, which
// is what this fixes. Set the date later if the school produces one.
//
// ⚠ Like the Cacao force-enrol, this writes through the service role rather
// than the Records module, so no `audit_log` row is produced. The reasoning
// lives in this header instead.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-ajmal-s3-consistency-placement.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-ajmal-s3-consistency-placement.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');

const AY_CODE = 'AY2026';
const LEVEL_CODE = 'S3';
const SECTION_NAME = 'Consistency';

const AJMAL_NUMBER = 'H250920';
const ANTONIO_NUMBER = 'H180130';
const CALIMBAS_NUMBER = 'H260441';

type Row = {
  id: string;
  index_number: number | null;
  enrollment_status: string;
  student_id: string;
  students: { student_number: string; first_name: string; last_name: string };
};

async function main() {
  const svc = createServiceClient();

  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .maybeSingle();
  if (!ay) throw new Error(`${AY_CODE} not found`);

  const { data: levels } = await svc
    .from('levels')
    .select('id, code')
    .eq('code', LEVEL_CODE);
  const levelId = (levels ?? [])[0]?.id;
  if (!levelId) throw new Error(`level ${LEVEL_CODE} not found`);

  const { data: sections } = await svc
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', (ay as { id: string }).id)
    .eq('level_id', levelId)
    .eq('name', SECTION_NAME);
  const section = (sections ?? [])[0];
  if (!section)
    throw new Error(`${AY_CODE} ${LEVEL_CODE} ${SECTION_NAME} not found`);
  console.log(
    `section: ${AY_CODE} ${LEVEL_CODE} ${SECTION_NAME} (${section.id})\n`
  );

  const { data: rosterRaw } = await svc
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student_id, students!inner(student_number, first_name, last_name)'
    )
    .eq('section_id', section.id)
    .order('index_number', { ascending: true });
  const roster = (rosterRaw ?? []) as unknown as Row[];

  const taken = new Set(
    roster.map((r) => r.index_number).filter((n): n is number => n != null)
  );
  const find = (num: string) =>
    roster.find((r) => r.students.student_number === num);

  const antonio = find(ANTONIO_NUMBER);
  const calimbas = find(CALIMBAS_NUMBER);
  const ajmalAlready = find(AJMAL_NUMBER);

  const problems: string[] = [];
  if (!antonio)
    problems.push(`Antonio ${ANTONIO_NUMBER} is not in this section`);
  if (!calimbas)
    problems.push(`Calimbas ${CALIMBAS_NUMBER} is not in this section`);
  if (ajmalAlready)
    problems.push(
      `Ajmal already has a row here (#${ajmalAlready.index_number}, ${ajmalAlready.enrollment_status}) — nothing to insert`
    );
  if (antonio && antonio.index_number !== 1)
    problems.push(
      `Antonio is at #${antonio.index_number}, expected #1 — the roster moved since this was written`
    );
  if (calimbas && calimbas.index_number !== 2)
    problems.push(
      `Calimbas is at #${calimbas.index_number}, expected #2 — the roster moved since this was written`
    );
  if (taken.has(3))
    problems.push(
      `#3 is occupied by ${find3(roster)} — the shift below assumes it is vacant`
    );
  if (problems.length) {
    console.error('REFUSING TO RUN:');
    problems.forEach((p) => console.error(`  ${p}`));
    process.exit(1);
  }

  const { data: ajmalStudent } = await svc
    .from('students')
    .select('id, student_number, first_name, middle_name, last_name')
    .eq('student_number', AJMAL_NUMBER)
    .maybeSingle();
  if (!ajmalStudent) throw new Error(`student ${AJMAL_NUMBER} not found`);
  const s = ajmalStudent as {
    id: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
  };
  console.log(
    `  Ajmal: ${[s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ')} (${AJMAL_NUMBER})\n`
  );

  console.log('plan, in this order (each target vacant when written):');
  console.log(
    `  1. ${calimbas!.students.last_name.padEnd(12)} #2 -> #3   (update ${calimbas!.id})`
  );
  console.log(
    `  2. ${antonio!.students.last_name.padEnd(12)} #1 -> #2   (update ${antonio!.id})`
  );
  console.log(
    `  3. ${s.last_name.padEnd(12)} new #1, enrollment_status='withdrawn', withdrawal_date=null`
  );
  console.log(`\n  roster size after: ${roster.length + 1}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  console.log('\napplying...');
  // PromiseLike, not Promise: a PostgREST builder is thenable but has no
  // `catch`/`finally`, so typing this as Promise rejects every call site.
  const step = async (
    label: string,
    fn: () => PromiseLike<{ error: unknown }>
  ) => {
    const { error } = await fn();
    if (error)
      throw new Error(
        `${label}: ${(error as { message?: string }).message ?? JSON.stringify(error)}`
      );
    console.log(`  ok  ${label}`);
  };

  await step('Calimbas #2 -> #3', () =>
    svc
      .from('section_students')
      .update({ index_number: 3 })
      .eq('id', calimbas!.id)
  );
  await step('Antonio #1 -> #2', () =>
    svc
      .from('section_students')
      .update({ index_number: 2 })
      .eq('id', antonio!.id)
  );
  await step('Ajmal inserted at #1 (withdrawn)', () =>
    svc.from('section_students').insert({
      section_id: section.id,
      student_id: s.id,
      index_number: 1,
      enrollment_status: 'withdrawn',
      enrollment_date: null,
      withdrawal_date: null,
    })
  );

  console.log('\nverifying...');
  const { data: after } = await svc
    .from('section_students')
    .select(
      'index_number, enrollment_status, students!inner(student_number, last_name)'
    )
    .eq('section_id', section.id)
    .lte('index_number', 4)
    .order('index_number', { ascending: true });
  for (const r of (after ?? []) as unknown as Row[]) {
    console.log(
      `  #${String(r.index_number).padEnd(3)} ${r.students.last_name.padEnd(14)} ${r.students.student_number.padEnd(10)} ${r.enrollment_status}`
    );
  }
  console.log(
    '\nAdmissions untouched: her application stays Withdrawn with no class.'
  );
}

function find3(roster: Row[]): string {
  const r = roster.find((x) => x.index_number === 3);
  return r
    ? `${r.students.last_name} (${r.students.student_number})`
    : 'someone';
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
