// scripts/verify-perf-migrations.ts
//
// Did migrations 130 to 133 actually land? Checked against a live database.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT, a `count`/`head`
// probe, or an RPC call that reads. Nothing is written and no DDL is executed,
// so it is safe to point at production.
//
// ⚠ IT DELIBERATELY DOES NOT CALL `attach_enrolment_indexes()` OR
// `create_ay_admissions_tables()`. Both are idempotent, and calling one would
// "prove" it exists — but they are DDL, and running DDL against production is
// not verification's job. Migration 132 is therefore checked as far as a
// PostgREST client can check it and NO FURTHER; the part that cannot be
// reached from here is printed as SQL for the Supabase SQL editor rather than
// glossed over. See the CANNOT PROVE section below.
//
// ── WHAT EACH MIGRATION IS ────────────────────────────────────────────────
//
//   130  narrows student_declarations_no_duplicate_filing to exclude
//        `rejected` as well as `cancelled`, so a parent can re-file after the
//        school asks for a certificate.                        (index)
//   131  approval_requests_own_work_select — the read policy the browser's
//        bell recount inner-joins through.                     (policy)
//   132  five btree indexes per AY on the enrolment tables, via an idempotent
//        attach_enrolment_indexes(slug) helper + a backfill.   (indexes)
//   133  audit_actor_emails(text[]) — `select distinct` in the database, so
//        the three module Actor dropdowns stop deriving a nine-name list by
//        reading the log.                                      (function)
//
// 133 is the DEPLOY BLOCKER: all three dropdowns call it and there is no
// fallback by decision, so the branch must not ship before it is applied.
//
// ── WHAT THIS CAN PROVE ───────────────────────────────────────────────────
//
//   * 133's function exists, returns the right answers on today's production
//     data, and returns them distinct, non-null and ordered.
//   * That the fix is a FIX: the pre-133 `.limit(200)` shape is re-run here
//     side by side, and markbook's dropdown listing 8 of 9 actors is
//     reproduced rather than asserted.
//   * That `anon` cannot execute it — the check migration 103 taught this
//     project to always make, because 103's own revoke did not take and only
//     an anon-key call found out.
//
// ── WHAT THIS CANNOT PROVE, STATED PLAINLY ────────────────────────────────
//
//   * ⚠ 132's INDEXES. PostgREST cannot query `pg_catalog`, so `pg_indexes` is
//     unreachable, and it has no `explain` verb, so the planner cannot be
//     asked which path it takes. No amount of client-side probing distinguishes
//     an indexed table from an unindexed one at 822 rows. The three acceptance
//     queries from docs/context/11-performance-patterns.md §13 are printed
//     verbatim at the end for the SQL editor. A SKIP HERE IS NOT A PASS.
//   * ⚠ 130's INDEX and 131's POLICY, for the same reason — `pg_indexes` and
//     `pg_policies` are both out of reach. What is checked instead is the
//     surrounding shape (the tables and columns they attach to), which is
//     weaker and is labelled as such.
//   * ⚠ THE `authenticated` GRANT on audit_actor_emails, unless credentials
//     are supplied. The anon check proves the revoke; it says nothing about
//     the grant, and the grant is the load-bearing half — migration 114
//     revoked exactly this class of grant on a policy helper and blanked every
//     teacher's Teachers tab until 116 put it back. Pass --email/--password
//     for a real signed-in call:
//
//       npx tsx --env-file=.env.local scripts/verify-perf-migrations.ts \
//         --email someone@hfse.edu.sg --password '...'
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-perf-migrations.ts
//
// ⚠ EXIT CODE IS ALWAYS 0. This script REPORTS; it does not gate. Read the
// verdict lines, do not read the exit status.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '../lib/supabase/service';

const REPO_ROOT = join(__dirname, '..');

type Check = { name: string; state: 'ok' | 'fail' | 'skip'; detail: string };
const checks: Check[] = [];
const record = (name: string, state: Check['state'], detail: string) =>
  checks.push({ name, state, detail });

const heading = (text: string) =>
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

// ── The allowlists, READ FROM THE PAGES rather than retyped ────────────────
//
// Each of the three audit-log pages owns its own allowlist constant, and only
// two of them are exported. Importing the page modules into a script would
// drag in the whole server-component graph, so the constants are parsed out of
// the source instead. That is deliberately not a copy: a retyped list would
// drift from the pages silently, and drift is the exact failure this whole
// pass exists to remove. One action per line holds in all three files.
function allowlistFrom(file: string, constName: string): string[] {
  const src = readFileSync(join(REPO_ROOT, file), 'utf8');
  const start = src.indexOf(`${constName} = [`);
  if (start < 0) throw new Error(`${constName} not found in ${file}`);
  const end = src.indexOf('] as const', start);
  if (end < 0) throw new Error(`${constName} has no "] as const" in ${file}`);
  const actions: string[] = [];
  for (const line of src.slice(start, end).split('\n').slice(1)) {
    if (line.trimStart().startsWith('//')) continue;
    const m = line.match(/'([^']+)'/);
    if (m) actions.push(m[1]);
  }
  return actions;
}

/** The three pages that build an Actor <Select>, and the counts measured on
 *  production 2026-08-30 that this run is being compared against. */
const MODULES = [
  {
    label: 'markbook',
    file: 'app/(markbook)/markbook/audit-log/page.tsx',
    constName: 'MARKBOOK_AUDIT_ALLOWLIST',
    expectedActors: 9,
    expectedRows: 306,
    // The pre-133 shape listed 8 — this is the one page that was actually
    // wrong, and reproducing the 8 is what makes "fixed" a measurement.
    preFixListed: 8,
  },
  {
    label: 'attendance',
    file: 'app/(attendance)/attendance/audit-log/page.tsx',
    constName: 'ATTENDANCE_AUDIT_ACTIONS',
    expectedActors: 8,
    expectedRows: 138,
    preFixListed: 8,
  },
  {
    label: 'evaluation',
    file: 'app/(evaluation)/evaluation/audit-log/page.tsx',
    constName: 'EVALUATION_AUDIT_ALLOWLIST',
    expectedActors: 4,
    expectedRows: 29,
    // evaluation was unbounded, so its pre-fix list was already correct.
    preFixListed: 4,
  },
] as const;

async function main() {
  const service = createServiceClient();

  // ══ 133 · audit_actor_emails ═════════════════════════════════════════════
  heading('133 · audit_actor_emails(text[]) — the deploy blocker');

  for (const mod of MODULES) {
    const actions = allowlistFrom(mod.file, mod.constName);

    // How many log rows the allowlist covers — context for the actor count,
    // and the number the old shape was reading to derive a handful of names.
    const rowCount = await service
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .in('action', actions);

    const rpc = await service.rpc('audit_actor_emails', {
      p_actions: actions,
    });

    if (rpc.error) {
      record(
        `133 · ${mod.label} — RPC answers`,
        'fail',
        `call failed: ${rpc.error.code ?? '(no code)'} ${rpc.error.message}` +
          ' — if this is PGRST202, migration 133 is NOT applied and all three' +
          ' Actor dropdowns will render empty.'
      );
      continue;
    }

    const emails = (
      (rpc.data ?? []) as Array<{ actor_email: string | null }>
    ).map((r) => r.actor_email);
    const nonNull = emails.filter((e): e is string => e !== null && e !== '');
    const distinct = new Set(nonNull).size === nonNull.length;
    const sorted = [...nonNull].sort();
    const ordered = nonNull.every((e, i) => e === sorted[i]);
    const rows = rowCount.count ?? -1;

    record(
      `133 · ${mod.label} — distinct actors (${actions.length} actions, ${rows} log rows)`,
      nonNull.length === mod.expectedActors ? 'ok' : 'fail',
      `expected ${mod.expectedActors}, got ${nonNull.length}` +
        (rows === mod.expectedRows
          ? `; log rows ${rows} matches the 2026-08-30 measurement`
          : `; ⚠ log rows ${rows} vs ${mod.expectedRows} measured 2026-08-30 — the log has moved, so an actor count that differs may be real`)
    );

    record(
      `133 · ${mod.label} — the rows are distinct, non-null and ordered`,
      distinct && ordered && nonNull.length === emails.length ? 'ok' : 'fail',
      `distinct=${distinct} ordered=${ordered} nulls=${emails.length - nonNull.length}`
    );

    // ── The fix, demonstrated rather than asserted ────────────────────────
    //
    // Re-runs the exact pre-133 shape: select the actor_email COLUMN, ordered
    // by email, bounded at 200 rows, de-duplicated in JS. A row limit is not
    // an actor limit, and this is where that stops being a sentence and
    // becomes a number.
    const oldShape = await service
      .from('audit_log')
      .select('actor_email')
      .in('action', actions)
      .order('actor_email')
      .limit(200);

    if (oldShape.error) {
      record(
        `133 · ${mod.label} — the pre-fix shape, for comparison`,
        'fail',
        `could not re-run the old query: ${oldShape.error.message}`
      );
    } else {
      const oldCount = new Set(
        (oldShape.data as Array<{ actor_email: string | null }>)
          .map((r) => r.actor_email)
          .filter(Boolean)
      ).size;
      const gap = nonNull.length - oldCount;
      record(
        `133 · ${mod.label} — the pre-fix .limit(200) shape, re-run`,
        oldCount === mod.preFixListed ? 'ok' : 'fail',
        `listed ${oldCount} actor(s) against the RPC's ${nonNull.length}` +
          ` (expected ${mod.preFixListed})` +
          (gap > 0
            ? ` — ${gap} person missing from the old dropdown; THIS IS THE FIX`
            : ' — this page was already accurate; it changed shape, not answer')
      );
    }
  }

  // ── The lockdown, called with the ANON key ───────────────────────────────
  //
  // 133 revokes execute from `public` and from `anon`. Migration 103 revoked
  // seven functions and it DID NOT WORK, because Supabase grants `anon`
  // directly — found only by calling them with the anon key afterwards. An
  // execution error here would mean the body ran, which is the failure.
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // ⚠ Typed as `SupabaseClient`, not `ReturnType<typeof createClient>`. The
  // latter resolves the no-Database-generic overload to a client whose `rpc`
  // accepts `undefined` args and returns `never`, which is a compile error at
  // both call sites below rather than anything to do with this database.
  let anon: SupabaseClient | null = null;
  if (!anonUrl || !anonKey) {
    record(
      '133 · anon cannot execute audit_actor_emails',
      'skip',
      'skipped — no NEXT_PUBLIC_SUPABASE_URL / anon key in the environment. Do not treat a skip as a pass.'
    );
  } else {
    anon = createClient(anonUrl, anonKey);
    const denied = await anon.rpc('audit_actor_emails', {
      p_actions: ['sheet.lock'],
    });
    const refused =
      denied.error?.code === '42501' ||
      denied.error?.code === 'PGRST202' ||
      /permission denied/i.test(denied.error?.message ?? '');
    record(
      '133 · anon cannot execute audit_actor_emails',
      refused ? 'ok' : 'fail',
      denied.error
        ? `anon got ${denied.error.code ?? '(no code)'}: ${denied.error.message}`
        : `⚠ ANON EXECUTED IT and got ${Array.isArray(denied.data) ? denied.data.length : '?'} row(s). The revoke did not take.`
    );
  }

  // ── The `authenticated` grant, which needs a real session ────────────────
  const email = arg('email');
  const password = arg('password');
  if (!email || !password || !anonUrl || !anonKey) {
    record(
      '133 · a signed-in user can execute audit_actor_emails',
      'skip',
      'skipped — pass --email/--password to check the grant directly. ⚠ This is the load-bearing half (migrations 114/116); the anon refusal above does NOT stand in for it.'
    );
  } else {
    const client = createClient(anonUrl, anonKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) {
      record(
        '133 · a signed-in user can execute audit_actor_emails',
        'skip',
        `could not sign in: ${signIn.error.message}`
      );
    } else {
      const asUser = await client.rpc('audit_actor_emails', {
        p_actions: allowlistFrom(MODULES[0].file, MODULES[0].constName),
      });
      record(
        '133 · a signed-in user can execute audit_actor_emails',
        asUser.error ? 'fail' : 'ok',
        asUser.error
          ? `${asUser.error.code ?? '(no code)'}: ${asUser.error.message} — if this is 42501 the grant to authenticated is missing and all three dropdowns are empty for real users`
          : `executed; RLS returned ${Array.isArray(asUser.data) ? asUser.data.length : 0} actor(s) for this account` +
              ' (0 is correct for an account migration 006 does not admit to the log)'
      );
      await client.auth.signOut();
    }
  }

  // ══ 132 · the five AY enrolment indexes ══════════════════════════════════
  heading('132 · the AY enrolment indexes — what a client CAN see');

  // ⚠ None of the checks in this section prove an index exists. They establish
  // the shape the indexes attach to: which AY table sets exist (so "15 indexes
  // after backfill" has a denominator), and that the camelCase columns the
  // helper quotes are really the columns production has — the failure 132's
  // header warns about, where unquoted identifiers fold to lowercase and the
  // index lands on a column that never matches.
  const ays = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code');
  const ayCodes = ((ays.data ?? []) as Array<{ ay_code: string }>).map(
    (r) => r.ay_code
  );
  const slugs = ayCodes.map((c) => `ay${c.slice(2)}`);
  record(
    '132 · academic_years — the set the backfill walks',
    ays.error ? 'fail' : slugs.length > 0 ? 'ok' : 'fail',
    ays.error
      ? `read failed: ${ays.error.message}`
      : `${slugs.length} AY(s): ${slugs.join(', ')} → expect ${slugs.length * 5} indexes named ay%_enrolment_%_idx`
  );

  // Row counts, because "this is future-proofing, not a speed-up" is a claim
  // about scale and it should be re-measured rather than repeated.
  for (const slug of slugs) {
    const c = await service
      .from(`${slug}_enrolment_applications`)
      .select('*', { count: 'exact', head: true });
    record(
      `132 · ${slug}_enrolment_applications is readable`,
      c.error ? 'fail' : 'ok',
      c.error ? `read failed: ${c.error.message}` : `${c.count} rows`
    );
  }

  // The five indexed columns, asked for by name. A column that does not exist
  // is a PostgREST error, so asking IS the check.
  const columnProbes: Array<[string, string]> = [];
  for (const slug of slugs) {
    columnProbes.push(
      [`${slug}_enrolment_applications`, 'enroleeNumber'],
      [`${slug}_enrolment_applications`, 'studentNumber'],
      [`${slug}_enrolment_status`, 'enroleeNumber'],
      [`${slug}_enrolment_status`, 'applicationStatus'],
      [`${slug}_enrolment_documents`, 'enroleeNumber']
    );
  }
  const badColumns: string[] = [];
  for (const [table, column] of columnProbes) {
    const probe = await service.from(table).select(`"${column}"`).limit(1);
    if (probe.error)
      badColumns.push(`${table}."${column}": ${probe.error.message}`);
  }
  record(
    '132 · every column the helper indexes exists, camelCase intact',
    badColumns.length === 0 ? 'ok' : 'fail',
    badColumns.length === 0
      ? `${columnProbes.length} column(s) probed across ${slugs.length} AY(s), all present`
      : badColumns.join(' | ')
  );

  record(
    '132 · the indexes themselves',
    'skip',
    'NOT CHECKABLE FROM HERE. PostgREST cannot read pg_catalog and has no explain verb, so neither pg_indexes nor the planner is reachable. The three acceptance queries are printed below — run them in the Supabase SQL editor. ⚠ A Seq Scan is the EXPECTED result at this row count; query 2 is the honest proof.'
  );

  // ══ 130 / 131 · confirming the earlier pair ══════════════════════════════
  heading(
    '130 / 131 · already applied 2026-08-27/28 — confirming, not assuming'
  );

  const decls = await service
    .from('student_declarations')
    .select('id, status, filed_by, declaration_type, start_date, end_date')
    .limit(1);
  record(
    '130 · student_declarations carries the five index columns + status',
    decls.error ? 'fail' : 'ok',
    decls.error
      ? `read failed: ${decls.error.message}`
      : 'readable — the columns the partial unique index keys on are all present'
  );
  record(
    '130 · the partial unique index excludes rejected',
    'skip',
    'NOT CHECKABLE FROM HERE — pg_indexes is unreachable over PostgREST. SQL below.'
  );

  const reqs = await service.from('approval_requests').select('id').limit(1);
  record(
    '131 · approval_requests is readable by the service role',
    reqs.error ? 'fail' : 'ok',
    reqs.error
      ? `read failed: ${reqs.error.message}`
      : 'readable (service bypasses RLS)'
  );

  if (anon) {
    // ⚠ Deliberately NOT recorded as evidence for 131. With no session
    // auth.uid() is null, so 131's policy admits nothing and the result is
    // identical to 126's `using (false)`. The two are indistinguishable from
    // here; this line exists to say so, not to pass.
    const anonReqs = await anon
      .from('approval_requests')
      .select('id', { count: 'exact', head: true });
    record(
      '131 · the own-work read policy',
      'skip',
      `NOT CHECKABLE FROM HERE — an anon call returns ${anonReqs.count ?? 0} row(s) with ${anonReqs.error ? `error ${anonReqs.error.code}` : 'no error'}, which is what BOTH 126's deny-all and 131's own-work policy produce for a caller with no session. Read the policy text in the SQL editor (below), or sign a real approver in and watch the bell.`
    );
  }

  // ══ Report ═══════════════════════════════════════════════════════════════
  heading('Checks');
  let failed = 0;
  let skipped = 0;
  for (const c of checks) {
    if (c.state === 'fail') failed += 1;
    if (c.state === 'skip') skipped += 1;
    const tag =
      c.state === 'ok' ? 'OK  ' : c.state === 'fail' ? 'FAIL' : 'SKIP';
    console.log(`  ${tag} ${c.name}\n       ${c.detail}`);
  }
  console.log(
    `\n${checks.length - failed - skipped} passed, ${failed} failed, ${skipped} not checkable from a PostgREST client.`
  );

  // ── The SQL that still has to be run by hand ─────────────────────────────
  heading('Run these in the Supabase SQL editor — nothing above covers them');
  console.log(`
-- 132, query 1. Fifteen rows, five per AY.
select tablename, indexname from pg_indexes
 where schemaname = 'public' and indexname like 'ay%\\_enrolment\\_%\\_idx'
 order by tablename, indexname;

-- 132, query 2. The index is usable, and correctly quoted.
-- ⚠ A Seq Scan WITHOUT the setting is the expected result at this row count
-- and is not a failure. This is the honest proof: forcing the planner off a
-- sequential scan must yield the index by name, which also proves the
-- camelCase double-quoting held.
set enable_seqscan = off;
explain select 1 from public.ay2025_enrolment_applications
 where "enroleeNumber" = 'x';
-- expect: Index Scan using ay2025_enrolment_applications_enrolee_idx
reset enable_seqscan;

-- 132, query 3. Idempotent, and the RPC still works.
-- ⚠ These two are DDL. verify-perf-migrations.ts will not run them, on
-- purpose. Run them only if you want the idempotency proved.
select public.attach_enrolment_indexes('ay2025');    -- no-op, no error
select public.create_ay_admissions_tables('ay2027'); -- still succeeds

-- 130. The duplicate-filing index must exclude BOTH cancelled and rejected.
select indexdef from pg_indexes
 where schemaname = 'public'
   and indexname = 'student_declarations_no_duplicate_filing';

-- 131. The own-work read policy on approval_requests.
select policyname, cmd, qual from pg_policies
 where schemaname = 'public' and tablename = 'approval_requests'
 order by policyname;

-- 133. The grants, read rather than inferred.
select r.rolname, has_function_privilege(r.rolname,
         'public.audit_actor_emails(text[])', 'execute') as can_execute
  from pg_roles r
 where r.rolname in ('anon', 'authenticated', 'service_role')
 order by r.rolname;
-- expect: anon false, authenticated true, service_role true
`);

  // Exit 0 ALWAYS. This script reports; the verdict lines above are the
  // result, not the exit status.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(0);
});
