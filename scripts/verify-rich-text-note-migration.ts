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
  console.log('EXPECT EXACTLY TWO ROWS, both reading <= 4000:');
  console.log('  attendance_daily          attendance_daily_ex_note_len_chk');
  console.log(
    '  approval_request_stages   approval_request_stages_decision_note_len_chk'
  );
  console.log('');
  console.log('⚠ THE ROW COUNT IS THE REAL CHECK, NOT THE 4000. The');
  console.log(
    '  approval_request_stages constraint was declared inline in migration 126,'
  );
  console.log(
    '  so Postgres named it, and 140 drops it by what it CHECKS rather than by'
  );
  console.log(
    '  what it is called. A miss leaves the old 300 constraint in force'
  );
  console.log(
    '  ALONGSIDE the new one — three rows, not two — and the table goes on'
  );
  console.log(
    '  refusing the note while the migration reports success. Three rows means'
  );
  console.log('  140 did not do its job.');
  console.log('');
  console.log(
    'Also expected: a THIRD row on student_declarations.parent_note still'
  );
  console.log(
    'reading <= 300 if you widen the query to that table — that one is'
  );
  console.log(
    'deliberately untouched (a parent types it in the external portal, plain).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
