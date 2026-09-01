// scripts/verify-rich-text-note-migration.ts
//
// Read-only. Migration 140 — the two 300-character note CHECK constraints
// widened to 4000, because those columns hold HTML now (KD #205).
//
// ⚠ THIS SCRIPT CANNOT PROVE THE MIGRATION, AND SAYING SO IS THE POINT.
//
// Every other verify script in this folder has something PostgREST can see: a
// new column selects or it errors, a dropped column errors or it does not, a
// granted role appears in a table. 140 adds no column and drops none. It only
// rewrites two CHECK constraints, and constraint definitions live in
// `pg_catalog`, which PostgREST cannot read — the same limitation recorded for
// migrations 130-133 and 137/138. There is no DATABASE_URL in .env.local
// either.
//
// The one thing this file CAN do honestly is confirm the two columns are still
// there and readable, print the query that actually settles it, and say
// plainly which part is unproven. A verify script that implied more than it
// checked would be worse than no script.
//
// ── why not just test the behaviour ──────────────────────────────────────
//
// A widened constraint means a >300-character value is now accepted, so a
// write would prove it outright. Deliberately not done: `attendance_daily` is
// an append-only register of what the school says happened, and the cheapest
// row to insert there is a real attendance mark against a real child on a real
// date. `approval_request_stages` is no better — a row there is a step in
// somebody's live declaration. Proving a constraint is not worth writing
// fiction into either table.
//
// Run: npx tsx --env-file=.env.local scripts/verify-rich-text-note-migration.ts
import { createServiceClient } from '../lib/supabase/service';

const SQL = `
select
  conrelid::regclass as table_name,
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and (
    (conrelid = 'public.attendance_daily'::regclass
       and pg_get_constraintdef(oid) ilike '%ex_note%')
    or
    (conrelid = 'public.approval_request_stages'::regclass
       and pg_get_constraintdef(oid) ilike '%decision_note%')
  )
order by table_name, conname;
`.trim();

async function main() {
  const service = createServiceClient();

  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // A missing column is a PostgREST error rather than an empty result, so
  // selecting it IS the existence check. This proves the columns 140 touches
  // are still there — NOT that their constraints were rewritten.
  const { error: exErr } = await service
    .from('attendance_daily')
    .select('id, ex_note')
    .limit(1);
  checks.push({
    name: 'attendance_daily.ex_note is readable',
    passed: !exErr,
    detail: exErr ? exErr.message : 'selectable',
  });

  const { error: noteErr } = await service
    .from('approval_request_stages')
    .select('id, decision_note')
    .limit(1);
  checks.push({
    name: 'approval_request_stages.decision_note is readable',
    passed: !noteErr,
    detail: noteErr ? noteErr.message : 'selectable',
  });

  for (const c of checks) {
    console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  }

  console.log('');
  console.log(
    'NOT CHECKABLE FROM HERE — the constraints themselves. Run this in the'
  );
  console.log('Supabase SQL editor:');
  console.log('');
  console.log(SQL);
  console.log('');
  console.log('VERIFIED against production 2026-09-01 — FOUR rows, as below.');
  console.log('');
  console.log('The two that 140 owns, both reading <= 4000:');
  console.log('  attendance_daily          attendance_daily_ex_note_len_chk');
  console.log(
    '  approval_request_stages   approval_request_stages_decision_note_len_chk'
  );
  console.log('');
  console.log(
    'And two PRE-EXISTING attendance_daily rules that merely mention'
  );
  console.log('ex_note. Neither is a length check; both are untouched:');
  console.log(
    '  attendance_daily_cleared_has_no_reason_chk   (a cleared mark carries no note)'
  );
  console.log(
    '  attendance_daily_ex_note_requires_ex_chk     (a note only exists on an EX mark)'
  );
  console.log('');
  console.log(
    '⚠ COUNT THE *_len_chk ROWS, NOT ALL THE ROWS. An earlier version of this'
  );
  console.log(
    '  note said "expect exactly two rows" — wrong, because the query filters'
  );
  console.log(
    '  on ilike %ex_note% and so catches every constraint that NAMES the'
  );
  console.log(
    '  column. Four rows is the correct answer, and reading four as a failure'
  );
  console.log('  would be the false alarm this paragraph exists to prevent.');
  console.log('');
  console.log(
    '⚠ WHAT WOULD ACTUALLY MEAN FAILURE: more than ONE length check on either'
  );
  console.log(
    '  table, or one still reading <= 300. The approval_request_stages'
  );
  console.log(
    '  constraint was declared inline in migration 126, so Postgres named it,'
  );
  console.log(
    '  and 140 drops it by what it CHECKS rather than by what it is called. A'
  );
  console.log(
    '  miss would leave the old 300 rule in force ALONGSIDE the new one, and'
  );
  console.log(
    '  the table would go on refusing the note while the migration reported'
  );
  console.log(
    '  success. Production returned exactly one per table, so the drop worked.'
  );
  console.log('');
  console.log(
    'Also untouched by design: student_declarations.parent_note keeps its <= 300'
  );
  console.log(
    '(a parent types it in the external portal, in a plain box, with no markup).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
