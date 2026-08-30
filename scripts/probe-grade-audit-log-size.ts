// scripts/probe-grade-audit-log-size.ts
//
// Closes the one exemption in the 2026-08-30 query pass that rested on an
// INFERENCE rather than a count (see §13 of docs/context/11-performance-patterns.md
// and §4c of docs/superpowers/specs/2026-08-29-phase-2-unindexed-filter-classification.md).
//
// `grade_audit_log` carries no index of any kind beyond its `id` primary key
// (001_initial_schema.sql:167), and `app/api/audit-log/route.ts` orders it
// `changed_at desc limit 500` with only optional narrowing by sheet/entry. The
// pass exempted it on the reasoning that it is bounded by grade-entry EDIT
// volume, and AY2026 holds 4,636 grade entries — but its own row count was
// never probed, and unlike every other table in that sweep it is append-only
// with NO per-AY ceiling: a locked sheet reopened and re-edited appends rows
// without adding entries. So the bound the exemption reasoned from does not
// actually bound it.
//
// THE TRIGGER, quoted from §13: above ~50,000 rows, add
//   create index ... on public.grade_audit_log (changed_at desc)
//   create index ... on public.grade_audit_log (grading_sheet_id, changed_at desc)
// Below it, leave the table alone and record the number so the next sweep
// inherits a measurement instead of the question.
//
// STRICTLY READ-ONLY — every statement is a `head: true` count. Exit code is
// always 0: this reports, it does not gate.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-grade-audit-log-size.ts
import { createServiceClient } from '../lib/supabase/service';

const TRIGGER_ROWS = 50_000;

async function countOf(
  service: ReturnType<typeof createServiceClient>,
  table: string
): Promise<number | null> {
  const { count, error } = await service
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`  ! ${table}: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

async function main(): Promise<void> {
  const service = createServiceClient();

  console.log("grade_audit_log — the pass's one uncounted exemption");
  console.log('─'.repeat(60));

  const auditRows = await countOf(service, 'grade_audit_log');
  const entryRows = await countOf(service, 'grade_entries');

  if (auditRows === null) {
    console.log('\nCould not read grade_audit_log. Nothing decided.');
    return;
  }

  console.log(`  grade_audit_log   ${auditRows.toLocaleString()} rows`);
  if (entryRows !== null) {
    console.log(`  grade_entries     ${entryRows.toLocaleString()} rows`);
    // The ratio is the interesting half: the exemption assumed audit rows track
    // entries, and this is the number that says whether re-edits have decoupled
    // them.
    const ratio = entryRows > 0 ? auditRows / entryRows : 0;
    console.log(
      `  ratio             ${ratio.toFixed(2)} audit rows per grade entry`
    );
  }

  console.log('');
  if (auditRows > TRIGGER_ROWS) {
    console.log(
      `VERDICT: ADD THE INDEXES. ${auditRows.toLocaleString()} rows is above the ` +
        `~${TRIGGER_ROWS.toLocaleString()}-row trigger recorded in §13.`
    );
    console.log('  create index if not exists grade_audit_log_changed_at_idx');
    console.log('    on public.grade_audit_log (changed_at desc);');
    console.log(
      '  create index if not exists grade_audit_log_sheet_changed_idx'
    );
    console.log(
      '    on public.grade_audit_log (grading_sheet_id, changed_at desc);'
    );
  } else {
    console.log(
      `VERDICT: LEAVE IT. ${auditRows.toLocaleString()} rows is well under the ` +
        `~${TRIGGER_ROWS.toLocaleString()}-row trigger; a limit-500 top-N sort ` +
        'over that is sub-millisecond.'
    );
    console.log(
      '  The exemption now rests on a COUNT rather than an inference. Re-run ' +
        'this on the next sweep rather than re-deriving the question.'
    );
  }
}

main().catch((err: unknown) => {
  console.error('probe failed:', err instanceof Error ? err.message : err);
});
