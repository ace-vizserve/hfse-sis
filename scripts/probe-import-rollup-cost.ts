// scripts/probe-import-rollup-cost.ts
//
// Phase 5 item 4 (app-wide query/write pass) — sizes the attendance term
// import's rollup fan-out against PRODUCTION, so the decision to parallelise
// it (or not) rests on a number rather than on how the loop reads.
//
// THE SHAPE BEING SIZED. `app/api/attendance/import/route.ts` walks the
// workbook's sheets one at a time, and for each calls `writeDailyBulk`
// (lib/attendance/mutations.ts) — which inserts every daily row in ONE batch,
// then calls `recompute_attendance_rollup` once per unique
// (term, section_student). Those RPCs ran STRICTLY SEQUENTIALLY when this
// script was written; the answer it gave (~34.5 s of rollup latency for one
// workbook) is what moved them to bounded waves of four. The comment on that
// loop argued against UNBOUNDED parallelism ("1,500+ ... overwhelms the pool"),
// which stays true and is why the waves are capped.
//
// It is kept, and stays useful, because it re-measures: the pair counts grow
// with the roll, and `PROPOSED_WAVE` below can be re-pointed at whatever bound
// is being considered.
//
// STRICTLY READ-ONLY. `recompute_attendance_rollup` is a WRITE (it upserts
// attendance_records), so this script does not call it. Instead it times the
// SELECT half of that function — the `distinct on (section_student_id, date,
// period_id)` scan over `attendance_daily` for one (term, student), which is
// the entire query the RPC runs before its single-row upsert — issued
// sequentially, exactly as the import issues the RPCs. What that omits is one
// indexed upsert of one row per call; against a round trip to Supabase that is
// noise, and the residual is called out in the output rather than hidden.
//
// Modelled on scripts/probe-query-cost.ts, which established this pass's
// read-only probe discipline.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-import-rollup-cost.ts
//
// Exit code is always 0 — this reports, it does not gate a build.
import { createServiceClient } from '../lib/supabase/service';

// Matches the bound `writeDailyBatch` already uses for a class-sized fan-out.
// Item 4's brief asks for HALF of it here, because an import's fan-out is
// roughly 3x larger than a class register submit's.
const PROPOSED_WAVE = 4;

// How many timed round trips to take. Enough for a median to mean something,
// small enough that the probe itself is cheap.
const SAMPLES = 30;

function ms(n: number) {
  return `${n.toFixed(0)} ms`;
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function main() {
  const service = createServiceClient();

  console.log('==============================================================');
  console.log('ATTENDANCE IMPORT — rollup fan-out cost (READ-ONLY)');
  console.log(
    '==============================================================\n'
  );

  // ── 1. The real fan-out, per term ────────────────────────────────────────
  // One rollup per unique (term_id, section_student_id) that the import
  // touches. Reading the ledger's existing pairs is the closest honest proxy
  // for what a full-term re-import would recompute.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const ay = ayRow as { id: string; ay_code: string } | null;
  if (!ay) {
    console.log('No current academic year. Nothing to size.');
    return;
  }
  console.log(`Current academic year: ${ay.ay_code}\n`);

  const { data: termRows } = await service
    .from('terms')
    .select('id, label, term_number')
    .eq('academic_year_id', ay.id)
    .order('term_number', { ascending: true });
  const terms = (termRows ?? []) as Array<{
    id: string;
    label: string;
    term_number: number;
  }>;

  let busiestTerm: { id: string; label: string; pairs: number } | null = null;
  const pairSamples: Array<{ termId: string; sectionStudentId: string }> = [];

  for (const term of terms) {
    // Page the ledger — a term's daily rows run to tens of thousands, well
    // past PostgREST's default 1,000-row window.
    const pairs = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await service
        .from('attendance_daily')
        .select('section_student_id')
        .eq('term_id', term.id)
        .range(from, from + PAGE - 1);
      if (error) {
        console.log(`  ${term.label}: read failed — ${error.message}`);
        break;
      }
      const rows = (data ?? []) as Array<{ section_student_id: string }>;
      for (const r of rows) pairs.add(r.section_student_id);
      if (rows.length < PAGE) break;
    }
    console.log(
      `  ${term.label}: ${pairs.size} unique (term, student) pairs -> ${pairs.size} sequential rollup RPCs`
    );
    if (!busiestTerm || pairs.size > busiestTerm.pairs) {
      busiestTerm = { id: term.id, label: term.label, pairs: pairs.size };
      pairSamples.length = 0;
      for (const ssId of pairs) {
        pairSamples.push({ termId: term.id, sectionStudentId: ssId });
        if (pairSamples.length >= SAMPLES) break;
      }
    }
  }

  if (!busiestTerm || pairSamples.length === 0) {
    console.log('\nNo attendance ledger rows to size against.');
    return;
  }

  console.log(
    `\nBusiest term: ${busiestTerm.label} — ${busiestTerm.pairs} rollups.\n`
  );

  // ── 2. Real sequential round-trip cost ───────────────────────────────────
  console.log(
    `Timing ${pairSamples.length} sequential reads of the RPC's own SELECT...`
  );
  const timings: number[] = [];
  for (const pair of pairSamples) {
    const t0 = performance.now();
    await service
      .from('attendance_daily')
      .select('status, date, period_id, recorded_at')
      .eq('term_id', pair.termId)
      .eq('section_student_id', pair.sectionStudentId)
      .order('date', { ascending: true })
      .order('period_id', { ascending: true })
      .order('recorded_at', { ascending: false });
    timings.push(performance.now() - t0);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);

  console.log(
    `  mean ${ms(mean)} · median ${ms(median)} · p95 ${ms(p95)} · min ${ms(sorted[0])} · max ${ms(sorted[sorted.length - 1])}\n`
  );

  // ── 3. What that means for a whole-term import ───────────────────────────
  const serialTotal = (busiestTerm.pairs * median) / 1000;
  const wavedTotal = serialTotal / PROPOSED_WAVE;

  console.log('--------------------------------------------------------------');
  console.log('EXTRAPOLATION — busiest term, whole-workbook import');
  console.log('--------------------------------------------------------------');
  console.log(
    `  today, sequential:        ~${serialTotal.toFixed(1)} s of rollup latency`
  );
  console.log(
    `  with waves of ${PROPOSED_WAVE}:          ~${wavedTotal.toFixed(1)} s (best case; ignores server-side contention)`
  );
  console.log(
    `  saved:                    ~${(serialTotal - wavedTotal).toFixed(1)} s\n`
  );
  console.log(
    '  Not counted: one indexed single-row upsert into attendance_records per'
  );
  console.log(
    "  call (the RPC's write half), and the daily-row bulk insert per sheet."
  );
  console.log(
    '  Both are small beside the round trip this measures, and neither changes'
  );
  console.log('  which side of the decision the number falls on.\n');

  console.log(
    'HOW TO READ IT. This is a rare, deliberate, admin-initiated operation with'
  );
  console.log(
    'no user waiting on a page render. If the sequential figure is comfortable,'
  );
  console.log(
    'leaving the loop serial keeps the failure mode simple — a bad row stops the'
  );
  console.log(
    'import at a known point — and preserves the pool-exhaustion property the'
  );
  console.log('existing comment was written to protect.');
}

main().catch((e) => {
  console.error(e);
});
