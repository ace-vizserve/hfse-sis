// scripts/verify-bell-count.ts
//
// Does the notification bell's live recount actually work?
//
// STRICTLY READ-ONLY. Every statement is a SELECT. Safe to point at production.
//
// ── THE SUSPICION THIS EXISTS TO SETTLE ───────────────────────────────────
//
// Mr Ace, 2026-08-27: "i noticed declarations is not realtime in SIS".
//
// `lib/sidebar/use-declaration-count.ts` recounts in the BROWSER with:
//
//   .from('approval_request_stages')
//   .select('id, approval_requests!inner(flow, status)', { count: 'exact' })
//
// Migration 126 put `approval_requests` behind `for select to authenticated
// using (false)`, and 127/128/129/130 never granted it back — 129 added a
// policy to `approval_request_stages` ONLY. Under RLS an inner join to a
// relation that returns nothing drops every parent row.
//
// ⚠ AND THE FAILURE IS QUIETER THAN "IT ERRORS". 126 created a POLICY but
// never revoked the table GRANT, so PostgREST does not raise 42501 — it just
// filters everything out and returns `{ count: 0, error: null }`. The hook's
// "log it and freeze" branch is gated on `error`, so it never fires: the badge
// silently sets itself to 0 on the first realtime event, with nothing in the
// console and nothing on screen to suggest anything went wrong.
//
// ── WHAT THIS SCRIPT CAN AND CANNOT PROVE ─────────────────────────────────
//
// ⚠ BE HONEST ABOUT THE ANON CALL. A bare `createClient(url, anonKey)` has no
// session, so `auth.uid()` is null and 129's policy admits nothing either —
// BOTH tables come back empty and the two are indistinguishable. Reading that
// as proof would be a false positive.
//
// So the decisive evidence is the pair:
//   (a) the POLICY TEXT on each table, read from `pg_policies`; and
//   (b) a service-vs-anon row count on `approval_requests` — rows exist, and
//       an unprivileged caller sees none of them, with no error.
//
// Give it a real approver's credentials and it becomes a direct proof instead:
//
//   npx tsx --env-file=.env.local scripts/verify-bell-count.ts \
//     --email someone@hfse.edu.sg --password '...'
//
// That signs in and runs the hook's own query twice — once as written, once
// without the join — so the difference between them IS the finding.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-bell-count.ts
//
// Exit 0 when the recount can work, 1 when it cannot.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { createServiceClient } from '../lib/supabase/service';
import { DECLARATION_APPROVAL_FLOW } from '../lib/schemas/approval-flows';

const heading = (text: string) =>
  console.log(`\n${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}`);

const problems: string[] = [];
const fail = (why: string) => problems.push(why);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** The engine tables the browser recount touches. */
const ENGINE_TABLES = [
  'approval_requests',
  'approval_request_stages',
  'approval_stages',
  'approval_stage_approvers',
] as const;

async function main() {
  const service = createServiceClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // ── 1 · what the migrations declare ─────────────────────────────────────
  heading('1 · Every SELECT policy the migrations declare on these tables');

  // ⚠ Read from the migration FILES, not from `pg_policies` — that is a system
  // view and PostgREST does not expose it, so there is no honest way to query
  // it from here. What the files say is a claim about intent; section 2 is the
  // claim about behaviour, and the two together are the evidence.
  const migrationDir = join(process.cwd(), 'supabase/migrations');
  const files = readdirSync(migrationDir).filter((f) => f.endsWith('.sql'));
  const seen: Array<{ file: string; line: string }> = [];
  for (const file of files) {
    const sql = readFileSync(join(migrationDir, file), 'utf8');
    for (const table of ENGINE_TABLES) {
      // Any policy statement naming one of these tables, plus the `using`
      // clause that follows it.
      const re = new RegExp(
        `create policy\\s+(\\S+)[\\s\\S]{0,200}?on public\\.${table}\\b[\\s\\S]{0,400}?for select[\\s\\S]{0,2000}?using\\s*\\(([\\s\\S]{0,2000}?)\\)\\s*;`,
        'gi'
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        // Strip SQL comments before flattening, or the summary line is mostly
        // prose about why the policy exists rather than what it does.
        const predicate = m[2]
          .replace(/--[^\n]*/g, ' ')
          .trim()
          .replace(/\s+/g, ' ');
        seen.push({
          file,
          line: `${table} · ${m[1]} · using (${predicate.slice(0, 100)})`,
        });
      }
    }
    // 126 creates its deny policies inside a `do $$ ... foreach` block, which
    // no per-table regex can see. Name it explicitly rather than pretend.
    if (/_no_select on public\.%I/.test(sql) || /%I_no_select/.test(sql)) {
      seen.push({
        file,
        line: 'ALL FOUR TABLES · <table>_no_select · using (false)  [loop]',
      });
    }
  }
  if (seen.length === 0) {
    console.log(
      '  (no SELECT policy found in any migration — that is itself odd)'
    );
  }
  for (const s of seen) console.log(`  ${s.file.padEnd(46)} ${s.line}`);
  console.log(
    '\n  Read it as: 126 denies all four, and only `approval_request_stages` is'
  );
  console.log('  ever opened again.');

  // ── 2 · service vs anon, table by table ─────────────────────────────────
  heading('2 · Rows visible to the service client vs an unprivileged caller');

  if (!url || !anonKey) {
    fail(
      'NEXT_PUBLIC_SUPABASE_URL / ANON key missing from the environment — the ' +
        'unprivileged half cannot run, and a skip is not a pass.'
    );
  }

  const anon = url && anonKey ? createClient(url, anonKey) : null;

  for (const table of ENGINE_TABLES) {
    const svc = await service
      .from(table)
      .select('*', { count: 'exact', head: true });
    const svcCount = svc.count ?? 0;

    let anonDesc = 'skipped';
    if (anon) {
      const res = await anon
        .from(table)
        .select('*', { count: 'exact', head: true });
      anonDesc = res.error
        ? `error ${res.error.code ?? '?'}: ${res.error.message}`
        : `${res.count ?? 0} row(s), no error`;
    }
    console.log(`  ${table.padEnd(28)} service ${svcCount} · anon ${anonDesc}`);
  }

  console.log(
    '\n  ⚠ An anon client holds no session, so `auth.uid()` is null and even the'
  );
  console.log(
    '    table 129 opened returns nothing. What matters is the NO ERROR part:'
  );
  console.log(
    '    the deny is a policy, not a revoked grant, so PostgREST filters'
  );
  console.log(
    '    silently instead of raising 42501 — which is why the hook never logs.'
  );

  // ── 3 · the hook's own query, both shapes ───────────────────────────────
  heading("3 · The hook's recount, with the join and without it");

  const email = arg('email');
  const password = arg('password');

  // Service-role first: this is what the number SHOULD be, RLS aside.
  const svcJoined = await service
    .from('approval_request_stages')
    .select('id, approval_requests!inner(flow, status)', {
      count: 'exact',
      head: true,
    })
    .eq('status', 'pending')
    .eq('approval_requests.flow', DECLARATION_APPROVAL_FLOW)
    .eq('approval_requests.status', 'pending');
  console.log(
    `  service, with the join      → ${svcJoined.count ?? 0} pending step(s)` +
      (svcJoined.error ? ` (error: ${svcJoined.error.message})` : '')
  );

  if (!email || !password) {
    console.log(
      '\n  No --email / --password given, so the signed-in half is skipped.'
    );
    console.log(
      '  ⚠ That leaves this INFERRED rather than proved. To prove it, pass a'
    );
    console.log(
      '    real approver (a form class adviser, or an officer in charge).'
    );
  } else if (!anon) {
    fail('Credentials given but no anon key to sign in with.');
  } else {
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      fail(`Could not sign in as ${email}: ${signIn.error?.message}`);
    } else {
      console.log(`  signed in as ${email}`);

      const joined = await anon
        .from('approval_request_stages')
        .select('id, approval_requests!inner(flow, status)', {
          count: 'exact',
          head: true,
        })
        .eq('status', 'pending')
        .eq('approval_requests.flow', DECLARATION_APPROVAL_FLOW)
        .eq('approval_requests.status', 'pending');

      // The same question with nothing joined. `approval_request_stages` alone
      // cannot name the flow, so this over-counts across flows — which is
      // exactly why the join is there, and exactly why it has to be readable.
      const unjoined = await anon
        .from('approval_request_stages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      const requests = await anon
        .from('approval_requests')
        .select('id', { count: 'exact', head: true });

      console.log(
        `  as this person, with the join    → ${joined.count ?? 0}` +
          (joined.error ? ` (error: ${joined.error.message})` : '')
      );
      console.log(
        `  as this person, WITHOUT the join → ${unjoined.count ?? 0}` +
          (unjoined.error ? ` (error: ${unjoined.error.message})` : '')
      );
      console.log(
        `  as this person, approval_requests → ${requests.count ?? 0}` +
          (requests.error ? ` (error: ${requests.error.message})` : '')
      );

      const stagesVisible = (unjoined.count ?? 0) > 0;
      const joinedVisible = (joined.count ?? 0) > 0;

      if (stagesVisible && !joinedVisible) {
        console.log(
          '\n  🔴 PROVED. This person can see their own pending steps, and the' +
            '\n     joined query — the one the bell actually runs — returns zero.' +
            '\n     The join to `approval_requests` is what empties it.'
        );
        fail(
          'The bell recount returns 0 for a person who has work waiting. ' +
            '`approval_requests` needs a scoped SELECT policy.'
        );
      } else if (!stagesVisible) {
        console.log(
          '\n  ⚠ This person has no pending step at all, so the comparison says' +
            '\n    nothing. Pick somebody with a filing waiting on them.'
        );
      } else {
        console.log(
          '\n  ✓ The joined query returns rows for a real approver — the recount' +
            '\n    works for this person.'
        );
      }

      await anon.auth.signOut();
    }
  }

  // ── verdict ─────────────────────────────────────────────────────────────
  heading('Verdict');
  if (problems.length === 0) {
    console.log('  ✓ Nothing here contradicts the recount working.');
    console.log(
      '  ⚠ Read section 3: without credentials this is inference, not proof.'
    );
    process.exit(0);
  }
  for (const p of problems) console.log(`  🔴 ${p}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('\nProbe failed to run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
