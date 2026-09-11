import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APPROVAL_CANCEL_OUTCOMES,
  APPROVAL_OUTCOMES,
  APPROVAL_REEVALUATE_OUTCOMES,
  APPROVAL_REPOINT_OUTCOMES,
  APPROVAL_RULES,
  APPROVAL_STAGE_STATUS_VALUES,
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type ApprovalOutcome,
} from '@/lib/schemas/approval-flows';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';

/**
 * The approval rule is written twice — `lib/approvals/state-machine.ts` and
 * `supabase/migrations/127_approval_advance.sql` — and this pins them together.
 *
 * ⚠ WHY TWO COPIES AT ALL. The SQL is the one that decides, because it holds
 * the row lock that makes "first to act carries it" safe. But a rule that lives
 * only inside a SECURITY DEFINER function cannot be read by a screen, so the
 * queue could not tell anybody whether a button would work before they pressed
 * it. Migration 123 made the same trade for `relief_is_live` / `isReliefLive`,
 * and `__tests__/auth/relief-window-parity.test.ts` is the test this one is
 * shaped after. Migration 115 exists because a pair like this drifted once.
 *
 * Read as text, not imported: the SQL is applied by hand against Supabase and
 * there is no migration runner in this project to execute it from a test.
 */

const SQL_DIR = join(process.cwd(), 'supabase', 'migrations');

function readSql(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf8');
}

/** SQL with `--` comment lines removed, so prose cannot satisfy an assertion. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/**
 * Also drops `comment on … is '…'` statements.
 *
 * ⚠ Needed for the negative assertions. The function's own COMMENT explains
 * that it deliberately does not `skip locked`, and a plain text search cannot
 * tell that sentence apart from the clause it is describing — the comment
 * would satisfy a test meant to prove the code does NOT contain it.
 */
function stripDocComments(sql: string): string {
  return stripComments(sql).replace(/comment on [\s\S]*?';/g, '');
}

/**
 * One function's definition, from `create or replace function` to its closing
 * `$$;` — so an assertion about `approval_advance` cannot be satisfied by a
 * neighbouring function in the same file.
 */
function functionSql(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return '';
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end === -1 ? undefined : end + 3);
}

// ⚠ 127 is kept for its lockdown block, which is where the
// `apply_change_request_atomic` grant was closed. The LIVE definition of
// `approval_advance` is migration 145's, and the reducer is pinned to that.
const ADVANCE_SQL = stripComments(readSql('127_approval_advance.sql'));
const RULES_SQL = stripComments(readSql('145_approval_step_rules.sql'));
const RULES_CODE = stripDocComments(readSql('145_approval_step_rules.sql'));
const LIVE_ADVANCE = functionSql(RULES_CODE, 'approval_advance');
const REEVALUATE = functionSql(RULES_CODE, 'approval_reevaluate_stage');
const CLOSE_HELPER = functionSql(RULES_CODE, 'approval_close_step_and_advance');
const EVERYONE_HELPER = functionSql(
  RULES_CODE,
  'approval_step_everyone_approved'
);
const FIXES_SQL = stripComments(readSql('146_approval_step_rules_fixes.sql'));
const FIXES_CODE = stripDocComments(
  readSql('146_approval_step_rules_fixes.sql')
);
const REPOINT = functionSql(FIXES_CODE, 'approval_repoint_request_stage');
const STAGES_SQL = stripComments(readSql('126_approval_stages.sql'));
const CANCEL_SQL = stripComments(
  readSql('144_grade_change_approval_flows.sql')
);
const CANCEL_CODE = stripDocComments(
  readSql('144_grade_change_approval_flows.sql')
);

describe('approval_advance mirrors the reducer', () => {
  it('finds the live definition to test at all', () => {
    for (const [name, body] of [
      ['approval_advance', LIVE_ADVANCE],
      ['approval_reevaluate_stage', REEVALUATE],
      ['approval_close_step_and_advance', CLOSE_HELPER],
      ['approval_step_everyone_approved', EVERYONE_HELPER],
    ] as const) {
      expect(body.length, `${name} not found in 145`).toBeGreaterThan(100);
    }
  });

  it('can answer every outcome the TypeScript side knows about', () => {
    // 'advanced' and 'completed' are answered by the shared close helper,
    // which approval_advance returns straight through.
    const answerable = LIVE_ADVANCE + CLOSE_HELPER;
    for (const outcome of APPROVAL_OUTCOMES) {
      expect(
        answerable.includes(`'${outcome}'::text`),
        `145's approval_advance never returns '${outcome}'`
      ).toBe(true);
    }
    expect(LIVE_ADVANCE).toMatch(
      /select \* from public\.approval_close_step_and_advance\(/
    );
  });

  it('has a plain-English message for every outcome', () => {
    for (const outcome of APPROVAL_OUTCOMES) {
      const message = APPROVAL_OUTCOME_MESSAGES[outcome as ApprovalOutcome];
      expect(message, `no message for '${outcome}'`).toBeTruthy();
      // These are shown to a form class adviser, not to a developer.
      expect(message).not.toMatch(/stage_|request_|not_authorised/);
    }
  });

  it('checks the five refusals in the same ORDER as the reducer', () => {
    // ⚠ THIS IS THE ASSERTION THAT MATTERS MOST. Swapping stage_already_decided
    // and not_authorised would tell somebody they are not authorised when the
    // truth is that a colleague decided it first — "you may not" instead of
    // "you needn't", about a decision they were fully entitled to make.
    // already_approved (145) comes LAST: somebody taken off a step is told it
    // is not theirs, not that they already approved it.
    const order: ApprovalOutcome[] = [
      'request_not_found',
      'request_closed',
      'stage_already_decided',
      'not_authorised',
      'already_approved',
    ];
    const positions = order.map((outcome) =>
      LIVE_ADVANCE.indexOf(`'${outcome}'`)
    );
    for (const [i, position] of positions.entries()) {
      expect(position, `'${order[i]}' is missing`).toBeGreaterThan(-1);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('refuses a second yes BEFORE it writes the decision, so the unique key is never a click handler', () => {
    const refusal = LIVE_ADVANCE.indexOf("'already_approved'");
    const insert = LIVE_ADVANCE.indexOf(
      'insert into public.approval_request_stage_decisions'
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(refusal);
    // …and nothing swallows a conflict on it.
    expect(LIVE_ADVANCE).not.toMatch(/on conflict/i);
    // The refusal is only for a step that needs everyone, and only for a yes.
    expect(LIVE_ADVANCE).toMatch(
      /v_stage\.approval_rule = 'all' and exists \([\s\S]*?d\.user_id = p_actor[\s\S]*?d\.decision = 'approve'/
    );
  });

  it('records the decision before a rejection closes the step, and before an approval can', () => {
    const insert = LIVE_ADVANCE.indexOf(
      'insert into public.approval_request_stage_decisions'
    );
    const rejectClose = LIVE_ADVANCE.search(/set status\s+= 'rejected'/);
    const recorded = LIVE_ADVANCE.indexOf("'recorded'");
    expect(rejectClose).toBeGreaterThan(insert);
    expect(recorded).toBeGreaterThan(insert);
  });

  it("closes an 'all' step only when everyone in its pool has approved", () => {
    expect(LIVE_ADVANCE).toMatch(
      /v_stage\.approval_rule = 'all'\s+and not public\.approval_step_everyone_approved\(v_stage\.id, v_stage\.approver_pool\)/
    );
  });

  it('never counts an empty pool as everyone approved', () => {
    // `[].every(...)` is true; so is "no member lacks a yes" over nothing.
    expect(EVERYONE_HELPER).toMatch(
      /cardinality\(coalesce\(p_pool, '\{\}'\)\) > 0\s+and not exists/
    );
  });

  it('locks the request row and does NOT skip locked', () => {
    expect(LIVE_ADVANCE).toMatch(
      /where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
    );
    // Skipping would race past the very state change the lock exists to see —
    // migration 044 wrote the same rule down for the change-request RPC.
    expect(RULES_CODE).not.toMatch(/skip\s+locked/i);
  });

  it('re-checks the actor against the step rather than trusting the caller', () => {
    expect(LIVE_ADVANCE).toMatch(
      /p_actor\s*=\s*any\s*\(\s*v_stage\.approver_pool\s*\)/
    );
    expect(LIVE_ADVANCE).toMatch(
      /public\.is_section_adviser\(\s*v_stage\.section_id\s*,\s*p_actor\s*\)/
    );
  });

  it('leaves later steps waiting after a rejection, rather than marking them', () => {
    // The ladder should read as "it never got there", because it never did.
    expect(RULES_CODE).not.toMatch(/'skipped'/);
  });

  it('keeps the signature and return columns 127 shipped', () => {
    for (const body of [LIVE_ADVANCE, REEVALUATE]) {
      expect(body).toMatch(
        /returns table \(\s*outcome\s+text,\s*request_status\s+text,\s*decided_stage_order smallint,\s*next_stage_order\s+smallint\s*\)/
      );
    }
    expect(LIVE_ADVANCE).toMatch(
      /p_request_id\s+uuid,\s*p_actor\s+uuid,\s*p_actor_email text,\s*p_action\s+text,\s*p_note\s+text default null/
    );
  });

  it('proves the assertions can fail', () => {
    // A parity test that cannot fail is the failure mode this shape has
    // actually had here before: `__tests__/api/cors-methods.test.ts` shipped a
    // regex that stopped at the wrong bracket and would have stayed green.
    const tampered = LIVE_ADVANCE.replace(/for update/g, 'for share');
    expect(tampered).not.toMatch(
      /where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
    );
    const emptyPoolRemoved = EVERYONE_HELPER.replace(/cardinality[^\n]*\n/, '');
    expect(emptyPoolRemoved).not.toMatch(/cardinality\(/);
  });
});

describe('approval_reevaluate_stage', () => {
  it('can answer every reevaluate outcome the TypeScript side knows about', () => {
    const answerable = REEVALUATE + CLOSE_HELPER;
    for (const outcome of APPROVAL_REEVALUATE_OUTCOMES) {
      expect(
        answerable.includes(`'${outcome}'::text`),
        `approval_reevaluate_stage never returns '${outcome}'`
      ).toBe(true);
    }
  });

  it('takes the same request lock as approval_advance, re-reads the step under it, and does NOT skip locked', () => {
    const lock = REEVALUATE.search(
      /from public\.approval_requests\s+where id = v_request_id\s+for update/
    );
    expect(lock).toBeGreaterThan(-1);
    const reread = REEVALUATE.indexOf(
      'from public.approval_request_stages\n  where id = p_request_stage_id;',
      lock
    );
    expect(reread).toBeGreaterThan(lock);
    expect(REEVALUATE).not.toMatch(/skip\s+locked/i);
  });

  it("moves only the live, named, 'all' step whose non-empty pool has all approved", () => {
    expect(REEVALUATE).toMatch(/v_stage\.status <> 'pending'/);
    expect(REEVALUATE).toMatch(
      /v_stage\.stage_order <> v_req\.current_stage_order/
    );
    expect(REEVALUATE).toMatch(/v_stage\.resolver <> 'named'/);
    expect(REEVALUATE).toMatch(/v_stage\.approval_rule <> 'all'/);
    expect(REEVALUATE).toMatch(
      /not public\.approval_step_everyone_approved\(v_stage\.id, v_stage\.approver_pool\)/
    );
  });

  it('advances through the same helper approval_advance uses', () => {
    expect(REEVALUATE).toMatch(
      /select \* from public\.approval_close_step_and_advance\(/
    );
  });
});

describe('approval_repoint_request_stage (146) mirrors repointStage', () => {
  it('finds the definition to test at all', () => {
    expect(REPOINT.length).toBeGreaterThan(100);
  });

  it('can answer every repoint outcome the TypeScript side knows about', () => {
    // 'advanced' and 'completed' come back through 145's close helper.
    const answerable = REPOINT + CLOSE_HELPER;
    for (const outcome of APPROVAL_REPOINT_OUTCOMES) {
      expect(
        answerable.includes(`'${outcome}'::text`),
        `approval_repoint_request_stage never returns '${outcome}'`
      ).toBe(true);
    }
    expect(REPOINT).toMatch(
      /select \* from public\.approval_close_step_and_advance\(/
    );
  });

  it('keeps the return columns every engine RPC shares, and takes a pool and a rule', () => {
    expect(REPOINT).toMatch(
      /returns table \(\s*outcome\s+text,\s*request_status\s+text,\s*decided_stage_order smallint,\s*next_stage_order\s+smallint\s*\)/
    );
    expect(REPOINT).toMatch(
      /p_request_stage_id uuid,\s*p_pool\s+uuid\[\],\s*p_rule\s+text/
    );
  });

  it('takes the request lock approval_advance takes, re-reads the step under it, and does NOT skip locked', () => {
    const lock = REPOINT.search(
      /from public\.approval_requests\s+where id = v_request_id\s+for update/
    );
    expect(lock).toBeGreaterThan(-1);
    const reread = REPOINT.indexOf(
      'from public.approval_request_stages\n  where id = p_request_stage_id;',
      lock
    );
    expect(reread).toBeGreaterThan(lock);
    // …and nothing is written before the lock is held.
    const write = REPOINT.indexOf('update public.approval_request_stages');
    expect(write).toBeGreaterThan(reread);
    expect(FIXES_CODE).not.toMatch(/skip\s+locked/i);
  });

  it('writes only to an open request, and only to a step not yet decided', () => {
    const guardRequest = REPOINT.search(
      /v_req\.status <> 'pending' then\s+return query select 'skipped'::text/
    );
    const guardStep = REPOINT.search(
      /v_stage\.status not in \('waiting', 'pending'\) then\s+return query select 'skipped'::text/
    );
    const write = REPOINT.indexOf('update public.approval_request_stages');
    expect(guardRequest).toBeGreaterThan(-1);
    expect(guardStep).toBeGreaterThan(guardRequest);
    expect(write).toBeGreaterThan(guardStep);
  });

  it('gives a pool only to a named step, and never "everyone" to a derived one', () => {
    expect(REPOINT).toMatch(
      /if v_stage\.resolver = 'named' then\s+v_pool := coalesce\(p_pool, '\{\}'\);\s+v_rule := p_rule;\s+else\s+v_pool := v_stage\.approver_pool;\s+v_rule := 'any';/
    );
  });

  it('moves only the live, named step', () => {
    expect(REPOINT).toMatch(
      /v_stage\.status <> 'pending'\s+or v_stage\.stage_order <> v_req\.current_stage_order\s+or v_stage\.resolver <> 'named'/
    );
  });

  it("closes an 'all' step only when everyone in the new pool approved, in the latest approver's name", () => {
    expect(REPOINT).toMatch(
      /if v_rule = 'all' then\s+if not public\.approval_step_everyone_approved\(v_stage\.id, v_pool\)/
    );
    expect(REPOINT).toMatch(
      /d\.user_id = any \(v_pool\)\s+order by d\.decided_at desc, d\.id desc/
    );
  });

  it("closes an 'any' step on one approval by somebody still on it, in the earliest approver's name", () => {
    // The relax direction — mirrored by `repointStage`'s `closedBy`.
    expect(REPOINT).toMatch(
      /else[\s\S]*?d\.decision = 'approve'\s+and d\.user_id = any \(v_pool\)\s+order by d\.decided_at asc, d\.id asc/
    );
    expect(REPOINT).toMatch(
      /if v_closer\.id is null then\s+return query select 'unchanged'::text/
    );
  });

  it('is security definer with a pinned search path, for service_role only', () => {
    expect(REPOINT).toMatch(/security definer\s+set search_path = public/);
    expect(FIXES_SQL).toContain(
      "'public.approval_repoint_request_stage(uuid, uuid[], text)'"
    );
    expect(FIXES_SQL).toMatch(
      /revoke all on function %s from public, anon, authenticated'/
    );
    expect(FIXES_SQL).toMatch(/grant execute on function %s to service_role/);
    expect(FIXES_SQL).not.toMatch(/grant execute[^\n]*to (anon|authenticated)/);
  });

  it('proves the lock and guard assertions can fail', () => {
    const tampered = REPOINT.replace(/for update/g, 'for share');
    expect(tampered).not.toMatch(
      /from public\.approval_requests\s+where id = v_request_id\s+for update/
    );
    const unguarded = REPOINT.replace(
      "not in ('waiting', 'pending')",
      "<> 'x'"
    );
    expect(unguarded).not.toMatch(
      /v_stage\.status not in \('waiting', 'pending'\) then/
    );
  });
});

describe('migration 146 — the ladder remembers its step, and history is whole', () => {
  it('adds config_stage_id with no foreign key', () => {
    expect(FIXES_SQL).toMatch(
      /alter table public\.approval_request_stages\s+add column if not exists config_stage_id uuid;/
    );
    expect(FIXES_CODE).not.toMatch(/config_stage_id uuid[^;]*references/);
  });

  it('backfills open requests only, and only where one active step carries the label', () => {
    expect(FIXES_SQL).toMatch(/having count\(\*\) = 1/);
    expect(FIXES_SQL).toMatch(
      /r\.status = 'pending'\s+and s\.config_stage_id is null/
    );
  });

  it('drops the decider foreign key if present, and backfills every decided step without the account filter', () => {
    expect(FIXES_SQL).toMatch(
      /alter table public\.approval_request_stage_decisions\s+drop constraint if exists approval_request_stage_decisions_user_id_fkey;/
    );
    const backfill = FIXES_SQL.slice(
      FIXES_SQL.indexOf('insert into public.approval_request_stage_decisions')
    );
    expect(backfill).toMatch(
      /where s\.status in \('approved', 'rejected'\)[\s\S]*?on conflict \(request_stage_id, user_id\) do nothing/
    );
    expect(backfill).not.toMatch(/auth\.users/);
    // The drop runs before the insert, or a live key would refuse the rows.
    expect(
      FIXES_SQL.indexOf(
        'drop constraint if exists approval_request_stage_decisions_user_id_fkey'
      )
    ).toBeLessThan(
      FIXES_SQL.indexOf('insert into public.approval_request_stage_decisions')
    );
  });
});

describe('migration 145 is locked down', () => {
  it('revokes both public functions from public, anon AND authenticated, for service_role only', () => {
    expect(RULES_SQL).toContain(
      "'public.approval_advance(uuid, uuid, text, text, text)'"
    );
    expect(RULES_SQL).toContain("'public.approval_reevaluate_stage(uuid)'");
    expect(RULES_SQL).toMatch(
      /revoke all on function %s from public, anon, authenticated'/
    );
    expect(RULES_SQL).toMatch(/grant execute on function %s to service_role/);
    expect(RULES_SQL).not.toMatch(/grant execute[^\n]*to authenticated/);
  });

  it('gives the lock-free helpers to nobody, service_role included', () => {
    expect(RULES_SQL).toContain(
      "'public.approval_step_everyone_approved(uuid, uuid[])'"
    );
    expect(RULES_SQL).toContain(
      "'public.approval_close_step_and_advance(uuid, uuid, uuid, text, timestamptz, text)'"
    );
    expect(RULES_SQL).toMatch(
      /revoke all on function %s from public, anon, authenticated, service_role/
    );
  });

  it('both public functions are security definer with a pinned search path', () => {
    for (const body of [LIVE_ADVANCE, REEVALUATE]) {
      expect(body).toMatch(/security definer\s+set search_path = public/);
    }
  });
});

describe('migration 145 matches the TypeScript vocabulary', () => {
  it('allows exactly the rules the TypeScript side knows, on both tables', () => {
    for (const table of ['approval_stages', 'approval_request_stages']) {
      const check = RULES_SQL.match(
        new RegExp(
          `alter table public\\.${table}\\s+add constraint ${table}_approval_rule_chk\\s+check \\(approval_rule in \\(([^)]*)\\)\\)`
        )
      );
      expect(check, `${table} rule check not found`).not.toBeNull();
      const values = check![1].split(',').map((v) => v.trim());
      expect(values).toEqual(APPROVAL_RULES.map((r) => `'${r}'`));
      expect(RULES_SQL).toMatch(
        new RegExp(
          `alter table public\\.${table}\\s+add column if not exists approval_rule text not null default 'any'`
        )
      );
    }
  });

  it("refuses 'all' on a form adviser step, on both tables", () => {
    for (const table of ['approval_stages', 'approval_request_stages']) {
      expect(RULES_SQL).toMatch(
        new RegExp(
          `alter table public\\.${table}\\s+add constraint ${table}_all_needs_named_chk\\s+check \\(approval_rule = 'any' or resolver = 'named'\\)`
        )
      );
    }
  });

  it('keeps one decision per person per step', () => {
    expect(RULES_SQL).toMatch(
      /constraint approval_request_stage_decisions_once unique \(request_stage_id, user_id\)/
    );
    expect(RULES_SQL).toMatch(
      /decision\s+text not null check \(decision in \('approve', 'reject'\)\)/
    );
  });
});

describe('the decisions table', () => {
  it('lets a signed-in person read only their own rows', () => {
    expect(RULES_SQL).toMatch(
      /alter table public\.approval_request_stage_decisions enable row level security/
    );
    expect(RULES_SQL).toMatch(
      /for select to authenticated\s+using \(user_id = auth\.uid\(\)\)/
    );
  });

  it('denies every write through PostgREST', () => {
    expect(RULES_SQL).toMatch(
      /approval_request_stage_decisions_no_insert\s+on public\.approval_request_stage_decisions\s+for insert to authenticated with check \(false\)/
    );
    expect(RULES_SQL).toMatch(
      /approval_request_stage_decisions_no_update\s+on public\.approval_request_stage_decisions\s+for update to authenticated using \(false\) with check \(false\)/
    );
    expect(RULES_SQL).toMatch(
      /approval_request_stage_decisions_no_delete\s+on public\.approval_request_stage_decisions\s+for delete to authenticated using \(false\)/
    );
  });

  it('is published to realtime with the full row, guarded against a re-run', () => {
    expect(RULES_SQL).toMatch(
      /alter table public\.approval_request_stage_decisions replica identity full/
    );
    expect(RULES_SQL).toMatch(
      /tablename = 'approval_request_stage_decisions'[\s\S]*?alter publication supabase_realtime add table public\.approval_request_stage_decisions/
    );
  });

  it('backfills already-decided steps without failing on a re-run or a removed account', () => {
    expect(RULES_SQL).toMatch(
      /where s\.status in \('approved', 'rejected'\)[\s\S]*?exists \(select 1 from auth\.users u where u\.id = s\.decided_by\)\s+on conflict \(request_stage_id, user_id\) do nothing/
    );
  });
});

describe('approval_advance is locked down', () => {
  it('revokes from public, anon AND authenticated', () => {
    // ⚠ Revoking from PUBLIC alone does not work. Migration 103 tried it and an
    // anon-key caller still executed all seven functions, because Supabase
    // grants `anon` directly; migration 104 is the fix and this is its shape.
    expect(ADVANCE_SQL).toMatch(
      /revoke all on function %s from public, anon, authenticated/
    );
    expect(ADVANCE_SQL).toMatch(/grant execute on function %s to service_role/);
  });

  it('locks down approval_advance itself', () => {
    expect(ADVANCE_SQL).toContain(
      "'public.approval_advance(uuid, uuid, text, text, text)'"
    );
  });

  it('also closes the apply_change_request_atomic grant that 103 and 104 missed', () => {
    // Not this feature's function. It was granted to `authenticated` by
    // migration 044 and then left out of BOTH lockdown migrations — a
    // SECURITY DEFINER function, five caller-supplied arguments, no role check
    // of its own. If somebody deletes this line, they are reopening it.
    expect(ADVANCE_SQL).toContain(
      "'public.apply_change_request_atomic(uuid, uuid, uuid, jsonb, uuid)'"
    );
  });
});

describe('approval_cancel serialises with approval_advance', () => {
  it('can answer every cancel outcome the TypeScript side knows about', () => {
    for (const outcome of APPROVAL_CANCEL_OUTCOMES) {
      expect(
        CANCEL_SQL.includes(`'${outcome}'::text`),
        `144 never returns '${outcome}'`
      ).toBe(true);
    }
  });

  it('checks not-found before closed, the same order as approval_advance', () => {
    const notFound = CANCEL_SQL.indexOf("'request_not_found'");
    const closed = CANCEL_SQL.indexOf("'request_closed'");
    expect(notFound).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(notFound);
  });

  it('takes the same row lock and does NOT skip locked', () => {
    // A withdrawal and a decision on one request must run one after the
    // other. Skipping would let both land: a change applied that its author
    // had already taken back.
    expect(CANCEL_SQL).toMatch(
      /from public\.approval_requests\s+where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
    );
    expect(CANCEL_CODE).not.toMatch(/skip\s+locked/i);
  });

  it('is security definer with a pinned search path', () => {
    expect(CANCEL_SQL).toMatch(
      /function public\.approval_cancel\(p_request_id uuid\)[\s\S]*?security definer\s+set search_path = public/
    );
  });

  it('proves the lock assertion can fail', () => {
    const tampered = CANCEL_CODE.replace(/for update/g, 'for share');
    expect(tampered).not.toMatch(
      /from public\.approval_requests\s+where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
    );
  });
});

describe('approval_cancel is locked down', () => {
  it('revokes from public, anon AND authenticated', () => {
    // Same reason as approval_advance: Supabase grants `anon` directly, so a
    // revoke from PUBLIC alone leaves the anon key able to call it (103 → 104).
    expect(CANCEL_SQL).toMatch(
      /revoke all on function %s from public, anon, authenticated/
    );
    expect(CANCEL_SQL).toMatch(/grant execute on function %s to service_role/);
    expect(CANCEL_SQL).not.toMatch(/to authenticated/);
  });

  it('locks down approval_cancel itself', () => {
    expect(CANCEL_SQL).toContain("'public.approval_cancel(uuid)'");
  });
});

describe('migration 144 matches the TypeScript vocabulary', () => {
  it('lets a stage hold every status the TypeScript side knows about', () => {
    const check = CANCEL_SQL.match(
      /add constraint approval_request_stages_status_check\s+check \(status in \(([^)]*)\)\)/
    );
    expect(check, 'status check not found').not.toBeNull();
    for (const status of APPROVAL_STAGE_STATUS_VALUES) {
      expect(check![1]).toContain(`'${status}'`);
    }
  });

  it('a cancelled stage carries no decider', () => {
    expect(CANCEL_SQL).toMatch(
      /status in \('waiting', 'pending', 'cancelled'\)\s+and decided_by is null and decided_at is null/
    );
  });

  it('accepts exactly the two grade-change flows on grade_change_requests', () => {
    expect(CANCEL_SQL).toContain(
      `approval_flow in ('${GRADE_CHANGE_APPROVAL_FLOW}', '${GRADE_CHANGE_AEB_APPROVAL_FLOW}')`
    );
  });
});

describe('the adviser rule has exactly one definition', () => {
  it('is_section_adviser carries the whole rule', () => {
    expect(STAGES_SQL).toMatch(/ta\.role in \('form_adviser', 'co_adviser'\)/);
    expect(STAGES_SQL).toMatch(
      /public\.relief_is_live\(ta\.relief_started_on, ta\.relief_ended_on\)/
    );
  });

  it('is_adviser_for_section is a thin wrapper, not a second copy', () => {
    expect(STAGES_SQL).toMatch(
      /select public\.is_section_adviser\(p_section_id, auth\.uid\(\)\)/
    );
    // One `role in (...)` test in the whole file: the wrapper must not restate
    // it. Two copies of exactly this rule is a bill this repo has paid twice
    // already (migration 115, and the seven gates in KD #193).
    const roleTests = STAGES_SQL.match(
      /ta\.role in \('form_adviser', 'co_adviser'\)/g
    );
    expect(roleTests?.length).toBe(1);
  });

  it('KEEPS the execute grant to authenticated', () => {
    // ⚠ Migration 114 revoked execute on an RLS helper and every cookie-scoped
    // read of teacher_assignments failed — a teacher's Teachers tab went blank
    // while service-role screens went on rendering the same rows. 116 repaired
    // it. An RLS policy is evaluated as the querying role, so the helper it
    // calls must be executable by that role.
    expect(STAGES_SQL).toMatch(
      /grant execute on function public\.is_adviser_for_section\(uuid\) to authenticated/
    );
    expect(STAGES_SQL).toMatch(
      /grant execute on function public\.is_section_adviser\(uuid, uuid\) to authenticated/
    );
  });
});

describe('the engine tables are unreadable through PostgREST', () => {
  it('denies select to authenticated on all four', () => {
    // `approver_pool` is a list of who decides what. A signed-in user must not
    // be able to enumerate it — same posture as approver_assignments (013).
    expect(STAGES_SQL).toMatch(/for select to authenticated using \(false\)/);
    for (const table of [
      'approval_stages',
      'approval_stage_approvers',
      'approval_requests',
      'approval_request_stages',
    ]) {
      expect(
        STAGES_SQL.includes(`'${table}'`),
        `${table} is not in the deny-all loop`
      ).toBe(true);
      expect(STAGES_SQL).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`)
      );
    }
  });
});
