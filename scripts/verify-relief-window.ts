// scripts/verify-relief-window.ts
//
// Runs the SAME date cases through both halves of the relief cover window and
// fails if they ever disagree:
//
//   SQL  public.relief_is_live(date, date)        — migration 123
//   TS   isReliefLive(startedOn, endedOn, today)  — lib/auth/teacher-assignments.ts
//
// WHY THE RULE IS WRITTEN TWICE. Five callers of loadEffectiveAssignmentsForUser
// pass the service client, which bypasses RLS outright, so a window enforced
// only in SQL would be skipped by all five. A window enforced only in the app
// would leave every direct RLS-scoped read ungated. Both layers need it, which
// makes them capable of disagreeing — and that disagreement is precisely what
// migration 115 was written to repair.
//
// ⚠ UNLIKE verify-relief-migrations.ts, A GREEN RUN HERE IS REAL EVIDENCE, and
// it is worth being clear why. That script reads TABLES with the service client
// and therefore cannot see row-level security, so it proves shape and nothing
// about access. `relief_is_live` is a PURE SCALAR FUNCTION of two dates — no
// table, no auth.uid(), no policy — so calling it as the service role gives
// exactly the same answer it gives inside a policy.
//
// What it still cannot tell you is whether the three ACCESS call sites USE it
// correctly. That needs the browser pass in the plan: a cover dated for next
// week must grant nothing today — while still being VISIBLE to the substitute,
// because the read policy deliberately does not carry the window (KD #191).
//
// STRICTLY READ-ONLY — one function call per case, nothing written.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-relief-window.ts
//
// Exit code 0 when the two agree on every case, 1 when they do not.
import { createServiceClient } from '../lib/supabase/service';
import { isReliefLive } from '../lib/auth/teacher-assignments';
import { sgToday } from '../lib/dates';

const today = sgToday();

/** `today` shifted by N days, as yyyy-MM-dd. */
function offset(days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Offsets rather than fixed dates, so the boundaries stay boundaries whenever
// this is run. The ±0 cases are the ones that matter most: both bounds are
// inclusive, and an off-by-one there silently costs a substitute their first
// or last day.
const CASES: Array<{ start: string | null; end: string | null; why: string }> =
  [
    { start: null, end: null, why: 'no window — every row created before 123' },
    { start: null, end: offset(1), why: 'open start, ends tomorrow' },
    { start: null, end: offset(0), why: 'open start, ends TODAY (inclusive)' },
    { start: null, end: offset(-1), why: 'open start, ended yesterday' },
    { start: offset(-1), end: null, why: 'started yesterday, open-ended' },
    {
      start: offset(0),
      end: null,
      why: 'starts TODAY (inclusive), open-ended',
    },
    { start: offset(1), end: null, why: 'scheduled for tomorrow' },
    { start: offset(-1), end: offset(1), why: 'today sits inside the window' },
    { start: offset(0), end: offset(0), why: 'single-day cover, today' },
    { start: offset(1), end: offset(7), why: 'window entirely in the future' },
    { start: offset(-7), end: offset(-1), why: 'window entirely in the past' },
  ];

async function main() {
  const service = createServiceClient();
  const mismatches: string[] = [];
  let checked = 0;

  console.log(`\n  Today in Asia/Singapore: ${today}\n`);

  for (const c of CASES) {
    const { data, error } = await service.rpc('relief_is_live', {
      p_started_on: c.start,
      p_ended_on: c.end,
    });

    if (error) {
      mismatches.push(
        `  start=${c.start ?? 'null'} end=${c.end ?? 'null'} — SQL call failed: ${error.message}`
      );
      continue;
    }

    const sql = data as boolean;
    const ts = isReliefLive(c.start, c.end, today);
    checked += 1;

    const agree = sql === ts;
    if (!agree) {
      mismatches.push(
        `  start=${c.start ?? 'null'} end=${c.end ?? 'null'} — SQL says ${sql}, TS says ${ts}  (${c.why})`
      );
    }

    console.log(
      `  ${agree ? 'PASS' : 'FAIL'}  ${String(sql).padEnd(5)} ` +
        `start=${(c.start ?? 'null').padEnd(10)} end=${(c.end ?? 'null').padEnd(10)}  ${c.why}`
    );
  }

  console.log('');
  if (mismatches.length > 0) {
    console.log(`  ${mismatches.length} DISAGREEMENT(S):\n`);
    mismatches.forEach((m) => console.log(m));
    console.log(
      '\n  SQL and TypeScript disagree about who may act on a class. That is\n' +
        '  the migration 115 failure returning. Fix both halves in one commit.\n'
    );
    process.exit(1);
  }

  console.log(
    `  All ${checked} cases agree.\n\n` +
      '  This proves the two definitions of the window match. It does NOT prove\n' +
      '  the three ACCESS call sites use it — open a class as a covering teacher\n' +
      '  with a cover dated for next week and confirm they get nothing, while\n' +
      '  still SEEING it listed (the read policy is unwindowed — KD #191).\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
