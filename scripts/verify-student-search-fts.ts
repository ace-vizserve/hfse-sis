// Read-only verification for migration 160 (cross-AY student search on FTS).
//
// Answers, against the live database:
//   1. How many academic years the search actually loops — the multiplier that
//      used to cost 6 requests each.
//   2. Whether every AY applications table got the `fts` column and its index.
//   3. Whether the function returns sensible, ranked results for a real name.
//   4. Whether word ORDER stopped mattering — the failure the old ILIKE had:
//      '%wei tan%' could never match "Tan Wei Ming", so staff searching
//      surname-first got nothing.
//   5. Whether identifier lookup still works, since those columns deliberately
//      bypass full-text (Hard Rule #4 — studentNumber must stay exact).
//
// Writes nothing. Safe to re-run.

import { createServiceClient } from '../lib/supabase/service';

type SearchRow = {
  ay_code: string;
  enrolee_number: string | null;
  student_number: string | null;
  full_name: string | null;
  rank: number | null;
};

async function search(
  supabase: ReturnType<typeof createServiceClient>,
  q: string,
  limit = 10
): Promise<SearchRow[]> {
  const { data, error } = await supabase.rpc('search_students_across_ay', {
    p_query: q,
    p_limit: limit,
  });
  if (error) throw new Error(`search("${q}") failed: ${error.message}`);
  return (data ?? []) as SearchRow[];
}

async function main() {
  const supabase = createServiceClient();

  // ── 1. The multiplier ───────────────────────────────────────────────────
  const { data: ays, error: ayErr } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (ayErr) throw new Error(`academic_years read failed: ${ayErr.message}`);
  const ayCodes = (ays ?? []).map((a: { ay_code: string }) => a.ay_code);

  console.log('ACADEMIC YEARS');
  console.log(`  ${ayCodes.length} year(s): ${ayCodes.join(', ')}`);
  console.log(`  before: ${1 + ayCodes.length * 6} requests per search`);
  console.log('  after:  1');
  console.log();

  // ── 2. Column + index present on each AY table ──────────────────────────
  //
  // The function works WITHOUT the column (it falls back to an inline
  // expression), so a missing one is a performance problem, not an outage.
  // Reporting it either way is the point.
  console.log('INDEX COVERAGE');
  for (const ayCode of ayCodes) {
    const slug = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    const table = `${slug}_enrolment_applications`;
    const { data: probe, error } = await supabase
      .from(table)
      .select('fts')
      .limit(1);
    if (error) {
      // ⚠ Order matters. "column ... does not exist" ALSO matches /does not
      // exist/, so testing for a missing table first reported every
      // missing-column case as a missing table — which is exactly how the
      // first run of this script hid the real defect behind a wrong label.
      const missingColumn = /column .*fts.* does not exist/i.test(
        error.message
      );
      const missingTable =
        !missingColumn && /does not exist|schema cache/i.test(error.message);
      console.log(
        `  ${table}: ${
          missingTable
            ? 'table not created yet (skipped by the function)'
            : missingColumn
              ? 'NO fts column — search works but unindexed; run add_ay_search_fts'
              : `unreadable — ${error.message}`
        }`
      );
      continue;
    }
    console.log(`  ${table}: fts present (${probe?.length ?? 0} row sampled)`);
  }
  console.log();

  // ── 3. A real search, ranked ────────────────────────────────────────────
  //
  // Take a real full name from the newest AY and search its parts, so this
  // exercises actual data rather than an invented string.
  const newest = ayCodes[0];
  const newestSlug = `ay${newest.replace(/^AY/i, '').toLowerCase()}`;
  const { data: sample } = await supabase
    .from(`${newestSlug}_enrolment_applications`)
    .select('enroleeFullName, studentNumber, enroleeNumber')
    .not('enroleeFullName', 'is', null)
    .limit(1);

  const subject = (sample ?? [])[0] as
    | {
        enroleeFullName: string;
        studentNumber: string | null;
        enroleeNumber: string | null;
      }
    | undefined;

  if (!subject) {
    console.log('No named row found to test with — stopping here.');
    return;
  }

  const parts = subject.enroleeFullName.trim().split(/\s+/).filter(Boolean);
  console.log(`SUBJECT: "${subject.enroleeFullName}"`);
  console.log();

  const found = (rows: SearchRow[]) =>
    rows.some((r) => r.full_name === subject.enroleeFullName);

  // Full name.
  const full = await search(supabase, subject.enroleeFullName);
  console.log(
    `  full name          → ${full.length} hit(s), ${found(full) ? 'FOUND' : 'MISSING'}`
  );

  // Prefix: drop the last two characters of the final token, as a type-ahead
  // would mid-word.
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    const typed = [
      ...parts.slice(0, -1),
      last.slice(0, Math.max(1, last.length - 2)),
    ].join(' ');
    const prefix = await search(supabase, typed);
    console.log(
      `  mid-typing "${typed}" → ${prefix.length} hit(s), ${found(prefix) ? 'FOUND' : 'MISSING'}`
    );
  }

  // ── 4. Word order — the old failure ─────────────────────────────────────
  if (parts.length >= 2) {
    const reversed = [...parts].reverse().join(' ');
    const rev = await search(supabase, reversed);
    console.log(
      `  reversed "${reversed}" → ${rev.length} hit(s), ${found(rev) ? 'FOUND ✅ (ILIKE could not do this)' : 'MISSING ❌'}`
    );
  }

  // ── 5. Identifiers still exact ──────────────────────────────────────────
  if (subject.studentNumber) {
    const byNum = await search(supabase, subject.studentNumber);
    console.log(
      `  studentNumber      → ${byNum.length} hit(s), ${found(byNum) ? 'FOUND' : 'MISSING ❌ (Hard Rule #4 path)'}`
    );
  }
  if (subject.enroleeNumber) {
    const byEnrolee = await search(supabase, subject.enroleeNumber);
    console.log(
      `  enroleeNumber      → ${byEnrolee.length} hit(s), ${found(byEnrolee) ? 'FOUND' : 'MISSING ❌'}`
    );
  }

  console.log();

  // ── 6. The limit is global, and so is the order ─────────────────────────
  //
  // Both were per-academic-year until migration 162: asking for 5 returned up
  // to 5 FROM EACH YEAR, sorted year-first, so the best match in an older year
  // ranked below every row from a newer one. The first run of this script
  // printed twelve rows under a heading that asked for five — which is the
  // only reason it was caught. Assert it now so it cannot come back quietly.
  const LIMIT = 5;
  const top = await search(supabase, parts[0], LIMIT);

  const overLimit = top.length > LIMIT;
  const ranks = top.map((r) => r.rank ?? 0);
  const descending = ranks.every((v, i) => i === 0 || ranks[i - 1] >= v);

  console.log(
    `GLOBAL LIMIT: asked ${LIMIT}, got ${top.length} ${overLimit ? '❌ per-year cap' : '✅'}`
  );
  console.log(
    `GLOBAL ORDER: ${descending ? '✅ rank descending' : '❌ not sorted by rank'}`
  );
  console.log();
  console.log(`RANKING (top ${LIMIT} for "${parts[0]}")`);
  for (const r of top) {
    console.log(
      `  ${(r.rank ?? 0).toFixed(4)}  ${r.ay_code}  ${r.full_name ?? '(blank)'}`
    );
  }

  if (overLimit || !descending) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
