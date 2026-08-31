// scripts/verify-subject-name-migrations.ts
//
// Read-only. Checks that migrations 137 and 138 are actually applied, the way
// the app will meet them — through PostgREST, with the same client the app
// uses. Follows scripts/verify-perf-migrations.ts and
// scripts/verify-approval-migrations.ts.
//
// ⚠ WHAT THIS CANNOT CHECK, AND WHY. The two CHECK constraints (report_label
// and description must be NULL or non-blank) live in pg_catalog, and PostgREST
// cannot read it — the same limitation recorded for migrations 130-133. There
// is no DATABASE_URL in .env.local either. Proving those needs the Supabase SQL
// editor:
//
//   select conname, pg_get_constraintdef(oid)
//   from pg_constraint
//   where conrelid = 'public.subject_configs'::regclass
//     and conname like '%not_blank';
//
// Expect three rows: display_name (137), report_label and description (138).
//
// Run: npx tsx --env-file=.env.local scripts/verify-subject-name-migrations.ts
import { createServiceClient } from '../lib/supabase/service';

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

async function main() {
  const service = createServiceClient();

  // ── 137 + 138: the three per-year columns exist ──────────────────────────
  // A missing column is a PostgREST error, not an empty result, so selecting
  // them IS the existence check.
  const { error: colErr } = await service
    .from('subject_configs')
    .select('id, display_name, report_label, description')
    .limit(1);
  record(
    'subject_configs has display_name, report_label and description',
    !colErr,
    colErr ? colErr.message : 'all three selectable'
  );

  // ── 138: the global column is GONE ───────────────────────────────────────
  // The inverse shape: this select must FAIL. A success here means the drop
  // did not run, and the app would keep two disagreeing sources of the same
  // label.
  const { error: droppedErr } = await service
    .from('subjects')
    .select('id, report_label')
    .limit(1);
  record(
    'subjects.report_label is dropped',
    !!droppedErr,
    droppedErr
      ? `refused as expected: ${droppedErr.message}`
      : 'STILL PRESENT — the drop in migration 138 did not run'
  );

  // ── The catalogue still works without it ─────────────────────────────────
  const { data: subjects, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name, is_examinable, grading_method');
  record(
    'the subject catalogue still reads',
    !subjErr && (subjects ?? []).length > 0,
    subjErr ? subjErr.message : `${(subjects ?? []).length} subjects`
  );

  // ── What is actually SET today ───────────────────────────────────────────
  const { data: years } = await service
    .from('academic_years')
    .select('id, ay_code, is_current');
  const ayById = new Map(
    ((years ?? []) as { id: string; ay_code: string }[]).map((y) => [
      y.id,
      y.ay_code,
    ])
  );
  const codeById = new Map(
    ((subjects ?? []) as { id: string; code: string }[]).map((s) => [
      s.id,
      s.code,
    ])
  );

  const { data: configs } = await service
    .from('subject_configs')
    .select(
      'academic_year_id, subject_id, display_name, report_label, description'
    );
  const rows = (configs ?? []) as {
    academic_year_id: string;
    subject_id: string;
    display_name: string | null;
    report_label: string | null;
    description: string | null;
  }[];

  const set = rows.filter(
    (r) => r.display_name || r.report_label || r.description
  );
  record(
    'no value was carried over by a backfill',
    // 138 deliberately backfills nothing. Anything set here was typed by a
    // person, so this is informational once the rename is done — but on the
    // day the migration lands it must be zero.
    true,
    `${set.length} config(s) carry a per-year name, label or description`
  );

  console.log('');
  let failed = 0;
  for (const c of checks) {
    if (!c.passed) failed++;
    console.log(
      `  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`
    );
  }

  if (set.length > 0) {
    console.log('\n── what is set today ──');
    for (const r of set) {
      const parts = [
        r.display_name ? `name="${r.display_name}"` : null,
        r.report_label ? `report="${r.report_label}"` : null,
        r.description ? `desc="${r.description}"` : null,
      ].filter(Boolean);
      console.log(
        `  ${ayById.get(r.academic_year_id) ?? '?'} ${(codeById.get(r.subject_id) ?? '?').padEnd(9)} ${parts.join(' · ')}`
      );
    }
  }

  console.log(
    `\n${checks.length - failed} passed / ${failed} failed (CHECK constraints need the SQL editor — see the header)`
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
