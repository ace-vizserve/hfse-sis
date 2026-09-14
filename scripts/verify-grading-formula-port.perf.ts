/**
 * Proves migration 152's SQL formula against the TypeScript one — on every
 * grade entry in the live database, reading only.
 *
 * WHY THIS AND NOT JUST THE MIGRATION'S OWN ASSERTIONS. The migration asserts
 * six hand-picked cases: the canonical 93, both halves of Blank ≠ Zero, the
 * empty entry, and both branches of the transmutation. Those prove the RULES.
 * They cannot prove the PORT, because a transcription error survives any test
 * whose answer I also wrote down. So this runs `lib/compute/quarterly.ts` —
 * the real module, imported, not a copy — against the SQL port's own output,
 * on EVERY row in the table. Nothing is hand-picked and nothing is sampled.
 *
 * ⚠ THE TEST IS "DO THE TWO FORMULAS AGREE", NOT "DOES THE SQL MATCH WHAT IS
 * STORED". Those are different questions and conflating them wastes a day.
 * 10,540 of the 21,280 stored values disagree with both formulas: imported
 * results, grades whose sheets have no maxes, rows the current formula never
 * wrote. That is old data, not a broken port, and a check that fails on it
 * fails forever. The classification below exists only to REPORT that history;
 * it never decides what gets tested.
 *
 * ⚠ AND THE CLASSIFIER MUST NEVER GATE THE TEST. An earlier version compared
 * TS to SQL only on rows the SQL had labelled `mismatch`. When migration 155's
 * labels reclassified 269 of those as history, coverage silently fell from 270
 * rows to 1 — and the run still reported PASS. A classifier that chooses its
 * own test set will always certify itself. Hence: every row, every time.
 *
 * The reported kinds, all of which are history rather than failure:
 *
 *   * IMPORTED_NO_SCORES — no marks at all, but a grade is stored: a
 *     historical result imported as a final number. Migration 153 stops the
 *     derive trigger erasing these.
 *   * SHEET_NOT_CONFIGURED — marks, but the sheet has no maxes for them, so no
 *     percentage exists. 232 of this school's 1,116 sheets are in that state,
 *     all locked. Migration 154 stops the trigger deleting those marks and
 *     overwriting the grade with a number assembled out of the gap.
 *   * DERIVED_NEVER_COMPUTED — `initial_grade` is null while a grade is
 *     stored: the current formula never wrote this row's derived values.
 *   * LEGACY_ROUNDING — the grade agrees and `initial_grade` differs in the
 *     fourth decimal only (stored 89.8740 vs computed 89.8739), from an older
 *     writer that stored three decimals. No grade is affected.
 *   * STALE — the sheet's maxes or weights moved after the entry was last
 *     saved. `recompute_grade_entries_for_sheet` fixes one.
 *   * MISMATCH — none of the above. Worth reading, but the pass/fail line is
 *     the TS-vs-SQL comparison below, not this label.
 *
 * ⚠ REQUIRES MIGRATIONS 152–155.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts \
 *     scripts/verify-grading-formula-port.perf.ts --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

type DiffKind =
  | 'imported_no_scores'
  | 'sheet_not_configured'
  | 'derived_never_computed'
  | 'legacy_rounding'
  | 'stale'
  | 'mismatch';

type DiffRow = {
  kind: DiffKind;
  entry_id: string;
  sql_quarterly: number | null;
};

type EntryRow = {
  id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  quarterly_grade: number | null;
  grading_sheet_id: string;
};

type SheetRow = {
  id: string;
  ww_totals: number[] | null;
  pt_totals: number[] | null;
  qa_total: number | null;
  subject_config_id: string;
};

type ConfigRow = {
  id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
};

// Page a table or RPC in full.
//
// ⚠ ALWAYS WITH AN EXPLICIT ORDER BY. PostgREST caps a response at 1000 rows
// and says nothing about it, and paging an UNORDERED source repeats some rows
// and skips others. Both traps have already cost time on this codebase — the
// first run of this script reported "1000 disagreements" when the real figure
// was 10,540.
async function pageAll<T>(
  make: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
  label: string
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await make(page * 1000, page * 1000 + 999);
    if (error)
      throw new Error(`${label} page ${page} failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

describe('migration 152 formula port', () => {
  it('agrees with lib/compute/quarterly.ts on every stored entry', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const { computeQuarterly } = await import('@/lib/compute/quarterly');
    const svc = createServiceClient();

    // One pass over each table, joined in memory. The previous version fetched
    // the diff rows and then re-fetched their entries in 22 chunked `.in()`
    // calls carrying 500 UUIDs each, on top of paging the table anyway — it
    // timed out at 180s. Three paged reads cover everything.
    const entries = await pageAll<EntryRow>(
      (from, to) =>
        svc
          .from('grade_entries')
          .select(
            'id, ww_scores, pt_scores, qa_score, quarterly_grade, grading_sheet_id'
          )
          .order('id')
          .range(from, to),
      'grade_entries'
    );
    const sheetRows = await pageAll<SheetRow>(
      (from, to) =>
        svc
          .from('grading_sheets')
          .select('id, ww_totals, pt_totals, qa_total, subject_config_id')
          .order('id')
          .range(from, to),
      'grading_sheets'
    );
    const cfgRows = await pageAll<ConfigRow>(
      (from, to) =>
        svc
          .from('subject_configs')
          .select('id, ww_weight, pt_weight, qa_weight')
          .order('id')
          .range(from, to),
      'subject_configs'
    );
    const diffRows = await pageAll<DiffRow>(
      (from, to) =>
        svc.rpc('grade_formula_port_diff').order('entry_id').range(from, to),
      'grade_formula_port_diff'
    );

    const sheets = new Map(sheetRows.map((s) => [s.id, s]));
    const cfgs = new Map(cfgRows.map((c) => [c.id, c]));
    const diffs = new Map(diffRows.map((d) => [d.entry_id, d]));

    const byKind = new Map<DiffKind, number>();
    for (const d of diffRows) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);

    console.log('\n  entries checked       : ' + entries.length);
    console.log('  disagree with storage : ' + diffRows.length);
    for (const kind of [
      'imported_no_scores',
      'sheet_not_configured',
      'derived_never_computed',
      'legacy_rounding',
      'stale',
      'mismatch',
    ] as const) {
      console.log(
        `  ├─ ${kind.padEnd(23)}: ` + (byKind.get(kind) ?? 0).toLocaleString()
      );
    }

    // ---------------------------------------------------------------------
    // THE TEST. For every entry: run the real TS formula on the same inputs
    // the SQL was given, and require the two to agree.
    //
    // Where the SQL disagreed with storage, its own computed answer comes back
    // in the diff row. Where it did NOT disagree, the stored value IS the SQL's
    // answer — that is what "no disagreement" means — so comparing TS against
    // the stored value there is comparing TS against the SQL.
    // ---------------------------------------------------------------------
    const errors: string[] = [];
    let checked = 0;
    let skipped = 0;

    for (const e of entries) {
      const sheet = sheets.get(e.grading_sheet_id);
      const cfg = sheet ? cfgs.get(sheet.subject_config_id) : undefined;
      if (!sheet || !cfg) {
        skipped++;
        continue;
      }

      const ts = computeQuarterly({
        ww_scores: e.ww_scores ?? [],
        ww_totals: sheet.ww_totals ?? [],
        pt_scores: e.pt_scores ?? [],
        pt_totals: sheet.pt_totals ?? [],
        qa_score: e.qa_score,
        qa_total: sheet.qa_total,
        ww_weight: Number(cfg.ww_weight),
        pt_weight: Number(cfg.pt_weight),
        qa_weight: Number(cfg.qa_weight),
      });

      const diff = diffs.get(e.id);
      const sqlAnswer = diff ? diff.sql_quarterly : e.quarterly_grade;
      checked++;

      if ((ts.quarterly_grade ?? null) !== (sqlAnswer ?? null)) {
        errors.push(
          `${e.id}: TS ${ts.quarterly_grade}, SQL ${sqlAnswer}` +
            (diff ? ` [${diff.kind}]` : ' [agreed with storage]')
        );
      }
    }

    console.log(
      `\n  TS vs SQL on ${checked.toLocaleString()} rows: ` +
        (errors.length === 0
          ? 'the two formulas agree on every one.'
          : `${errors.length} DISAGREE`)
    );
    if (skipped > 0) {
      console.log(
        `  (${skipped} skipped — no sheet or no subject config, nothing to compute against)`
      );
    }
    for (const line of errors.slice(0, 20)) console.log('    ' + line);
    if (errors.length > 20) console.log(`    …and ${errors.length - 20} more.`);

    const imported = byKind.get('imported_no_scores') ?? 0;
    if (imported > 0) {
      console.log(
        `\n  ${imported.toLocaleString()} entries hold a grade with no marks behind it —` +
          '\n  imported results. Migrations 153 and 154 are what stop the derive' +
          '\n  trigger erasing those grades, and the marks on 513 other rows,' +
          '\n  on an unrelated write. They are NOT recomputed: overwriting a' +
          "\n  stored historical grade is a decision about a child's record."
      );
    }

    // The only thing that fails this test.
    expect(
      errors.length,
      'lib/compute/quarterly.ts and the SQL port disagree on inputs both were ' +
        'given. The port is wrong — do not ship.'
    ).toBe(0);

    // Guard against the coverage collapse described in the header: if this
    // ever checks a handful of rows again, that is a bug in the test, and a
    // green run would mean nothing.
    expect(
      checked,
      'The differential covered almost nothing — the test is broken, not passing.'
    ).toBeGreaterThan(20_000);
  }, 180_000);
});
