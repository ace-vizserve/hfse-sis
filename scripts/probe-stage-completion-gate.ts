// scripts/probe-stage-completion-gate.ts
//
// BLAST-RADIUS MEASUREMENT for a PROPOSED "stage completion gate" on the
// admissions stage editor. Nothing is built yet. This script answers one
// question and nothing else:
//
//   If the gate shipped today, how many production rows would it REFUSE?
//
// The proposed gate validates the MERGED POST-SAVE row and fires on EVERY
// save, not only when the status changes — so a remarks-only edit on a row
// that is already in a bad state is also refused. That is what makes the
// pre-existing population matter: it is not "rows people are about to
// create", it is "rows people can no longer touch at all".
//
// THE FIVE PROPOSED RULES, on ay{YYYY}_enrolment_status:
//   1. registrationStatus = 'Finished'                  → registrationInvoice + registrationPaymentDate
//   2. feeStatus = 'Invoiced' | 'Re-invoiced'           → feeInvoice
//      feeStatus = 'Paid'                               → feeInvoice + feePaymentDate
//   3. assessmentStatus = 'Finished'                    → assessmentGradeMath + assessmentGradeEnglish
//   4. suppliesStatus = 'Claimed'                       → suppliesClaimedDate
//   5. applicationStatus in ('Cancelled','Withdrawn')   → applicationTerminalReason
//
// "Blank" = null, or a string that is empty after trimming.
//
// THE FROZEN SPLIT IS THE POINT. `isAdmissionsStageFrozen` (lib/schemas/sis.ts,
// KD #147) already refuses every edit to a fully-'Enrolled' student's funnel
// stages. A blocked row that is ALSO frozen is harmless — the gate can never
// fire on it, because the save is rejected one check earlier. Only
// blocked-AND-still-editable is real impact. The script imports the shipped
// predicate rather than restating it, so the two cannot drift.
//
// STRICTLY READ-ONLY. Every statement is a SELECT or a `head: true` count.
// Nothing is written, so it is safe to point at production. Exit code is 0
// whenever the probe itself ran — a bad finding is a finding, not a failure.
//
// WHY THE ROWS ARE FETCHED RATHER THAN COUNTED SERVER-SIDE. A `count: 'exact',
// head: true` call with `.eq`/`.is`/`.or` filters is cheaper and has no row
// cap, but PostgREST cannot express "empty after trimming" — `is.null` misses
// a `''` and `eq.''` misses a `'  '`. Getting that wrong understates the
// blast radius silently, which is the one failure this script exists to
// avoid. So the authoritative numbers below are computed in JS over fully
// paged reads, and the server-side counts are kept only as a CROSS-CHECK
// (printed at the end, per AY). Where the two disagree, the difference is
// exactly the whitespace-only values, and the script says so.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-stage-completion-gate.ts
import { fetchAllPages } from '../lib/supabase/paginate';
import { prefixFor } from '../lib/admissions/_shared';
import { isAdmissionsStageFrozen, type StageKey } from '../lib/schemas/sis';
import { createServiceClient } from '../lib/supabase/service';

// ── formatting helpers (same house style as the other probes) ───────────────
const h1 = (s: string) =>
  console.log(`\n\n══ ${s} ${'═'.repeat(Math.max(0, 68 - s.length))}`);
const h2 = (s: string) =>
  console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`);
const pad = (n: number, w = 5) => String(n).padStart(w);

/** Blank exactly as the proposed gate defines it: null, or empty after trim. */
const blank = (v: unknown): boolean =>
  v === null || v === undefined || String(v).trim() === '';

/** Blank as PostgREST's `is.null` alone would see it. The gap between this
 *  and `blank()` is the whitespace/empty-string population a naive
 *  server-side filter would miss. */
const isNullOnly = (v: unknown): boolean => v === null || v === undefined;

type StatusRow = {
  id: number;
  enroleeNumber: string | null;
  applicationStatus: string | null;
  applicationTerminalReason: string | null;
  registrationStatus: string | null;
  registrationInvoice: string | null;
  registrationPaymentDate: string | null;
  assessmentStatus: string | null;
  assessmentGradeMath: string | null;
  assessmentGradeEnglish: string | null;
  feeStatus: string | null;
  feeInvoice: string | null;
  feePaymentDate: string | null;
  suppliesStatus: string | null;
  suppliesClaimedDate: string | null;
};

const STATUS_COLUMNS = [
  'id',
  'enroleeNumber',
  'applicationStatus',
  'applicationTerminalReason',
  'registrationStatus',
  'registrationInvoice',
  'registrationPaymentDate',
  'assessmentStatus',
  'assessmentGradeMath',
  'assessmentGradeEnglish',
  'feeStatus',
  'feeInvoice',
  'feePaymentDate',
  'suppliesStatus',
  'suppliesClaimedDate',
].join(', ');

/** One proposed rule: which stage it belongs to (for the freeze check), which
 *  status values arm it, and which columns it then demands. */
type Rule = {
  id: string;
  label: string;
  stageKey: StageKey;
  statusCol: keyof StatusRow;
  /** Status value → the columns required at that value. */
  requires: Record<string, (keyof StatusRow)[]>;
};

const RULES: Rule[] = [
  {
    id: 'R1',
    label: "registration 'Finished' → invoice + payment date",
    stageKey: 'registration',
    statusCol: 'registrationStatus',
    requires: {
      Finished: ['registrationInvoice', 'registrationPaymentDate'],
    },
  },
  {
    id: 'R2',
    label:
      "fees 'Invoiced'/'Re-invoiced' → invoice; 'Paid' → invoice + payment date",
    stageKey: 'fees',
    statusCol: 'feeStatus',
    requires: {
      Invoiced: ['feeInvoice'],
      'Re-invoiced': ['feeInvoice'],
      Paid: ['feeInvoice', 'feePaymentDate'],
    },
  },
  {
    id: 'R3',
    label: "assessment 'Finished' → math + english grade",
    stageKey: 'assessment',
    statusCol: 'assessmentStatus',
    requires: {
      Finished: ['assessmentGradeMath', 'assessmentGradeEnglish'],
    },
  },
  {
    id: 'R4',
    label: "supplies 'Claimed' → claimed date",
    stageKey: 'supplies',
    statusCol: 'suppliesStatus',
    requires: {
      Claimed: ['suppliesClaimedDate'],
    },
  },
  {
    id: 'R5',
    label: "application 'Cancelled'/'Withdrawn' → terminal reason",
    stageKey: 'application',
    statusCol: 'applicationStatus',
    requires: {
      Cancelled: ['applicationTerminalReason'],
      Withdrawn: ['applicationTerminalReason'],
    },
  },
];

type RuleTally = {
  /** Rows currently sitting at one of the rule's armed statuses. */
  armed: number;
  /** Of those, rows missing at least one required column. */
  blocked: number;
  /** Blocked rows whose stage is ALREADY frozen — the gate can never fire. */
  blockedFrozen: number;
  /** Blocked rows that are still editable — the real impact. */
  blockedEditable: number;
  /** Per required column, how many armed rows have it blank. */
  missingByCol: Map<string, number>;
  /** Per armed status value, armed / blocked. */
  byStatus: Map<string, { armed: number; blocked: number }>;
  /** Blank-but-not-null (empty or whitespace) hits, per column. The count a
   *  naive `is.null` server-side filter would MISS. */
  whitespaceOnlyByCol: Map<string, number>;
};

function emptyTally(): RuleTally {
  return {
    armed: 0,
    blocked: 0,
    blockedFrozen: 0,
    blockedEditable: 0,
    missingByCol: new Map(),
    byStatus: new Map(),
    whitespaceOnlyByCol: new Map(),
  };
}

const bump = (m: Map<string, number>, k: string, by = 1) =>
  m.set(k, (m.get(k) ?? 0) + by);

async function main() {
  const service = createServiceClient();

  h1('AY COVERAGE');
  const { data: ayRows, error: ayErr } = await service
    .from('academic_years')
    .select('ay_code, is_current')
    .order('ay_code');
  if (ayErr) {
    console.error(`Could not read academic_years: ${ayErr.message}`);
    process.exit(1);
  }
  const ayCodes = (ayRows ?? []).map((r) => r.ay_code as string);
  console.log(
    `academic_years rows: ${ayCodes.length}  [${ayCodes.join(', ')}]`
  );

  const rowsByAy = new Map<string, StatusRow[]>();
  const headCountByAy = new Map<string, number | null>();

  for (const ay of ayCodes) {
    const isCurrent = (ayRows ?? []).find((r) => r.ay_code === ay)?.is_current;
    const table = `${prefixFor(ay)}_enrolment_status`;

    // Server-side exact count first — the sanity check the paged read is
    // measured against. If these two ever disagree, the pagination is wrong
    // and every number below it is wrong too.
    const { count: headCount, error: headErr } = await service
      .from(table)
      .select('*', { count: 'exact', head: true });
    headCountByAy.set(ay, headErr ? null : (headCount ?? null));

    if (headErr) {
      console.log(
        `  ${ay}${isCurrent ? ' (current)' : ''} → ${table}: NOT READABLE` +
          `\n      ${headErr.message}`
      );
      continue;
    }

    try {
      // Ordered by `id`, NOT by enroleeNumber: `id` is the primary key
      // (012_ay_setup_helpers.sql), so it is unique and non-null, which is
      // what makes `.range()` paging stable. `enroleeNumber` is `text null`
      // on this table and a tie or a null there could drop or duplicate a
      // row across a page boundary — the same class of defect the
      // recorded_at tie-break fixes elsewhere in this repo.
      const rows = await fetchAllPages<StatusRow>(
        (from, to) =>
          service
            .from(table)
            .select(STATUS_COLUMNS)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{
            data: StatusRow[] | null;
            error: { message: string } | null;
          }>
      );
      rowsByAy.set(ay, rows);
      const agree = rows.length === headCount;
      console.log(
        `  ${ay}${isCurrent ? ' (current)' : ''} → ${table}: ` +
          `${rows.length} rows fetched, server count ${headCount} ` +
          `${agree ? '✓ agree' : '✗ DISAGREE — pagination is wrong, do not trust the numbers below'}`
      );
    } catch (err) {
      console.log(
        `  ${ay}${isCurrent ? ' (current)' : ''} → ${table}: FETCH FAILED` +
          `\n      ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Per-AY rule evaluation ────────────────────────────────────────────────
  h1('PER-AY · WHAT THE GATE WOULD REFUSE');

  const grand = {
    rowsAnyBlocked: 0,
    rowsAnyBlockedEditable: 0,
    rowsAnyBlockedAllFrozen: 0,
    totalRows: 0,
  };
  const grandByRule = new Map<string, RuleTally>();
  for (const r of RULES) grandByRule.set(r.id, emptyTally());

  for (const [ay, rows] of rowsByAy) {
    h2(`${ay} — ${rows.length} status rows`);

    const tallies = new Map<string, RuleTally>();
    for (const r of RULES) tallies.set(r.id, emptyTally());

    let rowsAnyBlocked = 0;
    let rowsAnyBlockedEditable = 0;

    for (const row of rows) {
      let anyBlocked = false;
      let anyBlockedEditable = false;

      for (const rule of RULES) {
        const status = ((row[rule.statusCol] as string | null) ?? '').trim();
        const required = rule.requires[status];
        if (!required) continue; // rule not armed on this row

        const t = tallies.get(rule.id)!;
        const g = grandByRule.get(rule.id)!;
        t.armed += 1;
        g.armed += 1;
        const bs = t.byStatus.get(status) ?? { armed: 0, blocked: 0 };
        bs.armed += 1;
        t.byStatus.set(status, bs);
        const gbs = g.byStatus.get(status) ?? { armed: 0, blocked: 0 };
        gbs.armed += 1;
        g.byStatus.set(status, gbs);

        let missing = false;
        for (const col of required) {
          const v = row[col];
          if (blank(v)) {
            missing = true;
            bump(t.missingByCol, col as string);
            bump(g.missingByCol, col as string);
            if (!isNullOnly(v)) {
              bump(t.whitespaceOnlyByCol, col as string);
              bump(g.whitespaceOnlyByCol, col as string);
            }
          }
        }
        if (!missing) continue;

        t.blocked += 1;
        g.blocked += 1;
        bs.blocked += 1;
        gbs.blocked += 1;
        anyBlocked = true;

        // Would the shipped freeze rule reject the save before the gate
        // could? Imported, not restated — see the header.
        const frozen = isAdmissionsStageFrozen(
          rule.stageKey,
          (row[rule.statusCol] as string | null) ?? null,
          row.applicationStatus
        );
        if (frozen) {
          t.blockedFrozen += 1;
          g.blockedFrozen += 1;
        } else {
          t.blockedEditable += 1;
          g.blockedEditable += 1;
          anyBlockedEditable = true;
        }
      }

      if (anyBlocked) rowsAnyBlocked += 1;
      if (anyBlockedEditable) rowsAnyBlockedEditable += 1;
    }

    grand.totalRows += rows.length;
    grand.rowsAnyBlocked += rowsAnyBlocked;
    grand.rowsAnyBlockedEditable += rowsAnyBlockedEditable;
    grand.rowsAnyBlockedAllFrozen += rowsAnyBlocked - rowsAnyBlockedEditable;

    console.log(`  rule  armed  blocked   frozen  editable   rule`);
    for (const rule of RULES) {
      const t = tallies.get(rule.id)!;
      console.log(
        `  ${rule.id}   ${pad(t.armed)}  ${pad(t.blocked, 7)}  ${pad(t.blockedFrozen, 7)}  ${pad(t.blockedEditable, 8)}   ${rule.label}`
      );
    }
    for (const rule of RULES) {
      const t = tallies.get(rule.id)!;
      if (t.armed === 0) continue;
      const statusBits = [...t.byStatus.entries()]
        .map(([s, v]) => `${s}: ${v.armed} armed / ${v.blocked} blocked`)
        .join(' · ');
      console.log(`\n  ${rule.id} ${statusBits}`);
      if (t.missingByCol.size === 0) {
        console.log(`      no missing fields`);
        continue;
      }
      for (const [col, n] of [...t.missingByCol.entries()].sort(
        (a, b) => b[1] - a[1]
      )) {
        const ws = t.whitespaceOnlyByCol.get(col) ?? 0;
        console.log(
          `      missing ${col.padEnd(26)} ${pad(n)}` +
            (ws > 0 ? `   (of which ${ws} are empty/whitespace, not null)` : '')
        );
      }
    }

    console.log(
      `\n  ▶ ${ay} distinct rows holding ≥1 blocked stage : ${rowsAnyBlocked} / ${rows.length}` +
        `\n      of which STILL EDITABLE (real impact)     : ${rowsAnyBlockedEditable}` +
        `\n      of which every hit is already frozen      : ${rowsAnyBlocked - rowsAnyBlockedEditable}`
    );
  }

  // ── Grand totals ──────────────────────────────────────────────────────────
  h1('GRAND TOTAL · ALL ACADEMIC YEARS');
  console.log(`  rule  armed  blocked   frozen  editable   rule`);
  for (const rule of RULES) {
    const g = grandByRule.get(rule.id)!;
    console.log(
      `  ${rule.id}   ${pad(g.armed)}  ${pad(g.blocked, 7)}  ${pad(g.blockedFrozen, 7)}  ${pad(g.blockedEditable, 8)}   ${rule.label}`
    );
  }
  console.log(
    `\n  Status rows read, all AYs                    : ${grand.totalRows}` +
      `\n  ▶ DISTINCT ROWS HOLDING ≥1 BLOCKED STAGE     : ${grand.rowsAnyBlocked}` +
      `\n      still editable — the gate WOULD fire     : ${grand.rowsAnyBlockedEditable}` +
      `\n      already frozen — the gate can NEVER fire : ${grand.rowsAnyBlockedAllFrozen}`
  );

  // ── Cross-check: same question, asked server-side ─────────────────────────
  //
  // R3 is the cheapest rule to restate as PostgREST filters (one status, two
  // text columns), so it is the one cross-checked. `is.null` alone is the
  // filter a first cut would reach for; the second count adds the empty-string
  // arm. Neither can express trim(), which is exactly the point being proven.
  h1('CROSS-CHECK · R3 asked server-side instead of in JS');
  console.log(
    'The JS figures above are authoritative. This block exists to prove the\n' +
      'paging and the blank test agree with the server, and to show what a\n' +
      'naive `is.null` filter would have under-reported.\n'
  );
  for (const ay of rowsByAy.keys()) {
    const table = `${prefixFor(ay)}_enrolment_status`;
    const armedQ = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('assessmentStatus', 'Finished');
    const nullOnlyQ = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('assessmentStatus', 'Finished')
      .or('assessmentGradeMath.is.null,assessmentGradeEnglish.is.null');
    const nullOrEmptyQ = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('assessmentStatus', 'Finished')
      .or(
        'assessmentGradeMath.is.null,assessmentGradeMath.eq.,assessmentGradeEnglish.is.null,assessmentGradeEnglish.eq.'
      );

    const rows = rowsByAy.get(ay)!;
    const jsArmed = rows.filter(
      (r) => (r.assessmentStatus ?? '').trim() === 'Finished'
    ).length;
    const jsBlocked = rows.filter(
      (r) =>
        (r.assessmentStatus ?? '').trim() === 'Finished' &&
        (blank(r.assessmentGradeMath) || blank(r.assessmentGradeEnglish))
    ).length;

    console.log(
      `  ${ay}  armed: server ${armedQ.error ? `ERR(${armedQ.error.message})` : armedQ.count} vs js ${jsArmed}` +
        `${!armedQ.error && armedQ.count === jsArmed ? ' ✓' : ' ✗'}`
    );
    console.log(
      `        blocked: js(trim) ${jsBlocked}` +
        ` · server is.null-only ${nullOnlyQ.error ? `ERR(${nullOnlyQ.error.message})` : nullOnlyQ.count}` +
        ` · server is.null-or-empty ${nullOrEmptyQ.error ? `ERR(${nullOrEmptyQ.error.message})` : nullOrEmptyQ.count}`
    );
  }

  // ── Status vocabulary ─────────────────────────────────────────────────────
  //
  // The rules arm on EXACT status literals. If production stores a spelling
  // the rule does not name ('Withdrawn (parent request)', 'Re-Invoiced',
  // 'CANCELLED'), the rule silently does not fire and this whole measurement
  // understates the blast radius. Every distinct value each status column
  // actually holds is printed below; anything marked `!` is a value NO rule
  // arms on, and is there to be eyeballed, not to be treated as a defect.
  h1('STATUS VOCABULARY · what the columns actually hold');
  const armedValues = new Map<string, Set<string>>();
  for (const r of RULES) {
    armedValues.set(r.statusCol as string, new Set(Object.keys(r.requires)));
  }
  for (const [ay, rows] of rowsByAy) {
    h2(`${ay}`);
    for (const rule of RULES) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const raw = row[rule.statusCol] as string | null;
        bump(counts, raw === null || raw === undefined ? '(null)' : raw);
      }
      const armed = armedValues.get(rule.statusCol as string)!;
      const line = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([v, n]) =>
            `${armed.has(v.trim()) ? '' : '!'}${JSON.stringify(v)}:${n}`
        )
        .join('  ');
      console.log(`  ${(rule.statusCol as string).padEnd(20)} ${line}`);
    }
  }

  h1('DONE — nothing was written');
  console.log(
    'Read the "still editable" column. That, and only that, is the number of\n' +
      'existing production rows the proposed gate would lock out of editing.\n'
  );
}

main().catch((err) => {
  console.error('\nProbe failed to run:', err);
  process.exit(1);
});
