// scripts/backfill/apply-ay2027-first-placements.ts
// Brings the first real AY2027 placements from Directus into Records.
//
// WHY THEY WERE MISSING. Admissions staff place a child in Directus by setting
// the Class stage to "Finished" with a level and section. The application
// status stays "Submitted" — and that is fine, because the sync never looks
// for "Enrolled": `syncOneStudent` needs a studentNumber plus classLevel +
// classSection, and refuses only Cancelled/Withdrawn. What stopped these three
// children was that their sections did not exist in the SIS for AY2027 —
// only P1 Obedience did (it holds the TESTING FOUR record) — so the sync
// skipped them with "section ... not found".
//
//   E270056 Obias, Eon Mach            P5 Commitment
//   E270284 Lanuza, Lorenzo Van Austin P3 Responsibility
//   E270015 Rebotar, John Gerard       "Year 8" Discipline-1
//
// "YEAR 8" IS SECONDARY ONE — Mr Ace, 2026-09-24: "year 8 is secondary 1".
// The SIS has no "Year 8" level, so the admissions row's classLevel is
// corrected to "Secondary One" (the same write the class tile's "Change level
// or section" makes). "Discipline-1" needs no correction: the section
// normalizer already reads it as "Discipline 1".
//
// The sections copy their AY2026 counterpart's class_type (Commitment and
// Discipline 1 are Global, Responsibility has none). No form class adviser:
// next year's advisers are not known. No grading sheets or subjects either —
// AY2027 setup has not reached that point, and Obedience has none.
//
// E270192 Flores is NOT handled: her Class stage is Finished with no level or
// section at all, so admissions has to fill it in.
//
// Run:  npx tsx --env-file=.env.local scripts/backfill/apply-ay2027-first-placements.ts
//       ... --apply   to write
import { createServiceClient } from '../../lib/supabase/service';
import { syncOneStudent } from '../../lib/sync/students';

const APPLY = process.argv.includes('--apply');
const AY = 'AY2027';

const SECTIONS = [
  { level: 'P5', name: 'Commitment' },
  { level: 'P3', name: 'Responsibility' },
  { level: 'S1', name: 'Discipline 1' },
];
const LEVEL_FIXES = [
  { enrolee: 'E270015', from: 'Year 8', to: 'Secondary One' },
];
const ENROLEES = ['E270056', 'E270284', 'E270015'];

async function main() {
  const svc = createServiceClient();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);

  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  if (ayErr) throw ayErr;
  const { data: prevAy, error: prevErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', 'AY2026')
    .single();
  if (prevErr) throw prevErr;

  // 1. sections
  for (const s of SECTIONS) {
    const { data: level, error: lErr } = await svc
      .from('levels')
      .select('id')
      .eq('code', s.level)
      .single();
    if (lErr) throw lErr;
    const { data: existing } = await svc
      .from('sections')
      .select('id')
      .eq('academic_year_id', ay.id)
      .eq('level_id', level.id)
      .eq('name', s.name)
      .maybeSingle();
    if (existing) {
      console.log(`section ${s.level} ${s.name}: already exists`);
      continue;
    }
    const { data: prev } = await svc
      .from('sections')
      .select('class_type')
      .eq('academic_year_id', prevAy.id)
      .eq('level_id', level.id)
      .eq('name', s.name)
      .maybeSingle();
    const classType = prev?.class_type ?? null;
    console.log(
      `section ${s.level} ${s.name}: create (class_type=${classType})`
    );
    if (APPLY) {
      const { error } = await svc.from('sections').insert({
        academic_year_id: ay.id,
        level_id: level.id,
        name: s.name,
        class_type: classType,
      });
      if (error) throw error;
    }
  }

  // 2. level corrections on the admissions row
  for (const f of LEVEL_FIXES) {
    const { data: row, error } = await svc
      .from('ay2027_enrolment_status')
      .select('"classLevel"')
      .eq('enroleeNumber', f.enrolee)
      .single();
    if (error) throw error;
    if (row.classLevel === f.to) {
      console.log(`${f.enrolee} classLevel: already ${f.to}`);
      continue;
    }
    if (row.classLevel !== f.from)
      throw new Error(
        `${f.enrolee} classLevel is "${row.classLevel}", expected "${f.from}" — stopping`
      );
    console.log(`${f.enrolee} classLevel: "${f.from}" -> "${f.to}"`);
    if (APPLY) {
      const { error: uErr } = await svc
        .from('ay2027_enrolment_status')
        .update({ classLevel: f.to })
        .eq('enroleeNumber', f.enrolee);
      if (uErr) throw uErr;
    }
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  // 3. sync each child into Records
  for (const e of ENROLEES) {
    const r = await syncOneStudent(svc, svc, e, AY);
    console.log(`sync ${e}:`, JSON.stringify(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
