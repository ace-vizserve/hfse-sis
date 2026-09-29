// Measures how far the Markbook Insights "Sheets locked" figures move once
// getSheetLockProgressByTerm pages past PostgREST's 1,000-row response cap
// (KD #229, phase 5 task 5.2 of
// docs/superpowers/plans/2026-09-29-insights-drill-sheets.md).
//
// BEFORE: replicates the old query exactly — one unfiltered, unordered read
// of `grading_sheets(term_id, is_locked)` across every AY, left to
// PostgREST's own default row cap (no .range() was ever called), then
// bucketed by this AY's term ids (mirrors the JS filter the old loader did).
// AFTER: the new loader's own paged read, scoped to this AY's terms.
//
// STRICTLY READ-ONLY — every statement is a SELECT. Safe against production.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/probe-markbook-insights-paging.ts

import { tallySheetLocksByTerm } from '../lib/markbook/insights-drill';
import { fetchAllPages } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

type TermRow = { id: string; term_number: number };
type SheetRow = { term_id: string; is_locked: boolean };

async function main() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_KEY
  ) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_KEY. ' +
        'Run with: npx tsx --env-file=.env.local scripts/probe-markbook-insights-paging.ts'
    );
    process.exit(1);
  }

  const supabase = createServiceClient();

  const { data: ayRows, error: ayErr } = await supabase
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code', { ascending: true });
  if (ayErr) {
    console.error('academic_years read failed:', ayErr.message);
    process.exit(1);
  }
  const academicYears = (ayRows ?? []) as { id: string; ay_code: string }[];
  if (academicYears.length === 0) {
    console.log('No academic years found.');
    return;
  }

  // BEFORE — the exact old query: no AY filter, no .range(), left to
  // PostgREST's own default cap. Read once; every AY's "before" bucket is
  // this same truncated set filtered in JS, exactly as the old loader did.
  const { data: beforeRaw, error: beforeErr } = await supabase
    .from('grading_sheets')
    .select('term_id, is_locked');
  if (beforeErr) {
    console.error('grading_sheets (unpaged) read failed:', beforeErr.message);
    process.exit(1);
  }
  const beforeSheets = (beforeRaw ?? []) as SheetRow[];
  console.log(
    `grading_sheets unpaged read returned ${beforeSheets.length} row(s) (PostgREST's own cap, no explicit .range()).`
  );

  for (const ay of academicYears) {
    const { data: termRows, error: termErr } = await supabase
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', ay.id)
      .order('term_number', { ascending: true });
    if (termErr) {
      console.error(`${ay.ay_code}: terms read failed:`, termErr.message);
      continue;
    }
    const terms = (termRows ?? []) as TermRow[];
    if (terms.length === 0) {
      console.log(`${ay.ay_code}: no terms — skipped.`);
      continue;
    }

    const before = tallySheetLocksByTerm(terms, beforeSheets);

    let afterSheets: SheetRow[];
    try {
      afterSheets = await fetchAllPages<SheetRow>((from, to) =>
        supabase
          .from('grading_sheets')
          .select('term_id, is_locked')
          .in(
            'term_id',
            terms.map((t) => t.id)
          )
          .range(from, to)
      );
    } catch (err) {
      console.error(`${ay.ay_code}: paged read failed:`, err);
      continue;
    }
    const after = tallySheetLocksByTerm(terms, afterSheets);

    console.log(`\n${ay.ay_code}:`);
    for (const t of terms) {
      const b = before.find((x) => x.termNumber === t.term_number);
      const a = after.find((x) => x.termNumber === t.term_number);
      console.log(
        `  Term ${t.term_number}: before locked=${b?.locked ?? 0} open=${b?.open ?? 0}` +
          `  ->  after locked=${a?.locked ?? 0} open=${a?.open ?? 0}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
