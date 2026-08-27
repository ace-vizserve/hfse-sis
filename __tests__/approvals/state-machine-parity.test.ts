import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APPROVAL_OUTCOMES,
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

const ADVANCE_SQL = stripComments(readSql('127_approval_advance.sql'));
const ADVANCE_CODE = stripDocComments(readSql('127_approval_advance.sql'));
const STAGES_SQL = stripComments(readSql('126_approval_stages.sql'));

describe('approval_advance mirrors the reducer', () => {
  it('can answer every outcome the TypeScript side knows about', () => {
    for (const outcome of APPROVAL_OUTCOMES) {
      expect(
        ADVANCE_SQL.includes(`'${outcome}'`),
        `127_approval_advance.sql never returns '${outcome}'`
      ).toBe(true);
    }
  });

  it('has a plain-English message for every outcome', () => {
    for (const outcome of APPROVAL_OUTCOMES) {
      const message = APPROVAL_OUTCOME_MESSAGES[outcome as ApprovalOutcome];
      expect(message, `no message for '${outcome}'`).toBeTruthy();
      // These are shown to a form class adviser, not to a developer.
      expect(message).not.toMatch(/stage_|request_|not_authorised/);
    }
  });

  it('checks the four refusals in the same ORDER as the reducer', () => {
    // ⚠ THIS IS THE ASSERTION THAT MATTERS MOST. Swapping the last two would
    // tell somebody they are not authorised when the truth is that a colleague
    // decided it first — "you may not" instead of "you needn't", about a
    // decision they were fully entitled to make.
    const order: ApprovalOutcome[] = [
      'request_not_found',
      'request_closed',
      'stage_already_decided',
      'not_authorised',
    ];
    const positions = order.map((outcome) =>
      ADVANCE_SQL.indexOf(`'${outcome}'`)
    );
    for (const [i, position] of positions.entries()) {
      expect(position, `'${order[i]}' is missing`).toBeGreaterThan(-1);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('locks the request row and does NOT skip locked', () => {
    expect(ADVANCE_SQL).toMatch(
      /where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
    );
    // Skipping would race past the very state change the lock exists to see —
    // migration 044 wrote the same rule down for the change-request RPC.
    expect(ADVANCE_CODE).not.toMatch(/skip\s+locked/i);
  });

  it('re-checks the actor against the step rather than trusting the caller', () => {
    expect(ADVANCE_SQL).toMatch(
      /p_actor\s*=\s*any\s*\(\s*v_stage\.approver_pool\s*\)/
    );
    expect(ADVANCE_SQL).toMatch(
      /public\.is_section_adviser\(\s*v_stage\.section_id\s*,\s*p_actor\s*\)/
    );
  });

  it('leaves later steps waiting after a rejection, rather than marking them', () => {
    // The ladder should read as "it never got there", because it never did.
    expect(ADVANCE_CODE).not.toMatch(/'skipped'/);
  });

  it('proves the assertions can fail', () => {
    // A parity test that cannot fail is the failure mode this shape has
    // actually had here before: `__tests__/api/cors-methods.test.ts` shipped a
    // regex that stopped at the wrong bracket and would have stayed green.
    const tampered = ADVANCE_CODE.replace(/for update/g, 'for share');
    expect(tampered).not.toMatch(
      /where\s+id\s*=\s*p_request_id\s*\n?\s*for update/
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
