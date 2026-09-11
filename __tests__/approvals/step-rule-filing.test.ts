import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A step's rule (migration 145) on its way onto a request's ladder.
 *
 * Pinned:
 *   1. `openApprovalRequest` copies each step's rule, and never writes 'all'
 *      onto a form adviser step (the database would refuse the whole filing).
 *   2. `repointWaitingStages` carries a changed rule onto steps waiting for
 *      it AND the live one (migration 146), and writes every change through
 *      `approval_repoint_request_stage`, which holds the request lock — never
 *      a direct update a decision could race.
 *   3. When that call closes a live step, the subject's follow-up runs in the
 *      acting admin's name. With no admin, a live 'all' step (the only kind a
 *      rewrite can close) is left alone entirely.
 *   4. Rows are found by the configured step they came from, so a rename does
 *      not cut them off; the label is only the fallback for older rows.
 */

const runSubjectFollowUp = vi.fn(async (..._a: unknown[]) => null);
vi.mock('@/lib/approvals/decide', () => ({
  runSubjectFollowUp: (...a: unknown[]) => runSubjectFollowUp(...a),
}));

import {
  openApprovalRequest,
  repointWaitingStages,
  ruleForFiling,
} from '@/lib/approvals/materialise';

type Row = Record<string, unknown>;

function chain(result: () => { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    c[m] = () => c;
  }
  c.maybeSingle = () => Promise.resolve(result());
  c.single = () => Promise.resolve(result());
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve);
  return c;
}

const ADMIN = {
  id: 'u-admin',
  email: 'admin@hfse.test',
  role: 'superadmin' as const,
};

beforeEach(() => {
  runSubjectFollowUp.mockClear();
});

describe('ruleForFiling', () => {
  it("keeps 'all' only on a named step", () => {
    expect(ruleForFiling({ resolver: 'named', approval_rule: 'all' })).toBe(
      'all'
    );
    expect(
      ruleForFiling({ resolver: 'form_adviser', approval_rule: 'all' })
    ).toBe('any');
    expect(ruleForFiling({ resolver: 'named' })).toBe('any');
    expect(ruleForFiling({ resolver: 'named', approval_rule: null })).toBe(
      'any'
    );
  });
});

describe('openApprovalRequest — the rule is copied like the pool', () => {
  function makeService(captured: { stageRows: Row[] }): SupabaseClient {
    return {
      from(table: string) {
        if (table === 'approval_stages') {
          return chain(() => ({
            data: [
              {
                id: 'cfg-1',
                stage_order: 1,
                label: 'Form class adviser',
                resolver: 'form_adviser',
                // Cannot happen past the CHECK; must not fail the filing if it did.
                approval_rule: 'all',
              },
              {
                id: 'cfg-2',
                stage_order: 2,
                label: 'Academic and Examination Board',
                resolver: 'named',
                approval_rule: 'all',
              },
              {
                id: 'cfg-3',
                stage_order: 3,
                label: 'Principal',
                resolver: 'named',
              },
            ],
            error: null,
          }));
        }
        if (table === 'approval_stage_approvers') {
          return chain(() => ({
            data: [
              {
                stage_id: 'cfg-2',
                user_id: 'u-chandana',
                applies_to_level_type: null,
              },
              {
                stage_id: 'cfg-2',
                user_id: 'u-christina',
                applies_to_level_type: null,
              },
              {
                stage_id: 'cfg-3',
                user_id: 'u-norma',
                applies_to_level_type: null,
              },
            ],
            error: null,
          }));
        }
        if (table === 'approval_requests') {
          return {
            insert: () => chain(() => ({ data: { id: 'apr-1' }, error: null })),
          };
        }
        if (table === 'approval_request_stages') {
          return {
            insert: (rows: Row[]) => {
              captured.stageRows.push(...rows);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;
  }

  it('writes each step’s rule onto its ladder row', async () => {
    const captured = { stageRows: [] as Row[] };
    await openApprovalRequest(makeService(captured), {
      flow: 'markbook.grade_change_aeb',
      subjectType: 'grade_change_request',
      subjectId: 'gcr-1',
      sectionId: 'sec-1',
      levelType: 'secondary',
      filedBy: 'u-teacher',
      filedByEmail: 'teacher@hfse.test',
    });
    expect(captured.stageRows.map((r) => r.approval_rule)).toEqual([
      'any',
      'all',
      'any',
    ]);
  });
});

describe('repointWaitingStages — every write under the request lock (migration 146)', () => {
  function makeService(opts: {
    configuredRule: 'any' | 'all';
    approvers: string[];
    openRows: Row[];
    rpcCalls: Array<{ name: string; args: Row }>;
    rpcOutcome?: string;
    /** Any direct write to a ladder row is the bug 146 exists to close. */
    directWrites?: Row[];
  }): SupabaseClient {
    return {
      from(table: string) {
        if (table === 'approval_stages') {
          return chain(() => ({
            data: {
              id: 'cfg-2',
              flow: 'markbook.grade_change_aeb',
              stage_order: 2,
              label: 'Academic and Examination Board',
              resolver: 'named',
              approval_rule: opts.configuredRule,
            },
            error: null,
          }));
        }
        if (table === 'approval_stage_approvers') {
          return chain(() => ({
            data: opts.approvers.map((user_id) => ({
              user_id,
              applies_to_level_type: null,
            })),
            error: null,
          }));
        }
        if (table === 'approval_request_stages') {
          const c = chain(() => ({ data: opts.openRows, error: null }));
          c.update = (patch: Row) => {
            opts.directWrites?.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          };
          return c;
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc(name: string, args: Row) {
        opts.rpcCalls.push({ name, args });
        const outcome = opts.rpcOutcome ?? 'unchanged';
        return Promise.resolve({
          data: [
            {
              outcome,
              request_status: outcome === 'completed' ? 'approved' : 'pending',
              decided_stage_order:
                outcome === 'advanced' || outcome === 'completed' ? 2 : null,
              next_stage_order: outcome === 'advanced' ? 3 : null,
            },
          ],
          error: null,
        });
      },
    } as unknown as SupabaseClient;
  }

  const openRow = (over: Row): Row => ({
    id: 'ars-2',
    request_id: 'apr-1',
    label: 'Academic and Examination Board',
    config_stage_id: 'cfg-2',
    status: 'waiting',
    approval_rule: 'any',
    level_type: 'secondary',
    approver_pool: ['u-chandana', 'u-christina'],
    approval_requests: { filed_by: 'u-teacher' },
    ...over,
  });

  const repointCall = (pool: string[], rule: 'any' | 'all', id = 'ars-2') => ({
    name: 'approval_repoint_request_stage',
    args: { p_request_stage_id: id, p_pool: pool, p_rule: rule },
  });

  it('carries a flipped rule onto a waiting step, through the locked call, never a direct write', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const directWrites: Row[] = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({})],
        rpcCalls,
        directWrites,
      }),
      'cfg-2',
      ADMIN
    );
    expect(changed).toBe(1);
    expect(rpcCalls).toEqual([
      repointCall(['u-chandana', 'u-christina'], 'all'),
    ]);
    expect(directWrites).toEqual([]);
  });

  it('tightens the rule of a live step too — nothing closes, nothing follows', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({ status: 'pending' })],
        rpcCalls,
      }),
      'cfg-2',
      ADMIN
    );
    expect(changed).toBe(1);
    expect(rpcCalls).toEqual([
      repointCall(['u-chandana', 'u-christina'], 'all'),
    ]);
    expect(runSubjectFollowUp).not.toHaveBeenCalled();
  });

  it('relaxes a live "everyone" step somebody approved, and runs the follow-up as the admin when it closes', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'any',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({ status: 'pending', approval_rule: 'all' })],
        rpcCalls,
        rpcOutcome: 'completed',
      }),
      'cfg-2',
      ADMIN
    );
    expect(changed).toBe(1);
    expect(rpcCalls).toEqual([
      repointCall(['u-chandana', 'u-christina'], 'any'),
    ]);
    expect(runSubjectFollowUp).toHaveBeenCalledTimes(1);
    expect(runSubjectFollowUp.mock.calls[0][0]).toMatchObject({
      actor: ADMIN,
      requestId: 'apr-1',
      outcome: 'completed',
      decidedStageOrder: 2,
      nextStageOrder: null,
      via: 'repoint',
    });
  });

  it('takes the hold-out off a live all step in the same call that moves it on', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        // Christina has left the step.
        approvers: ['u-chandana'],
        openRows: [openRow({ status: 'pending', approval_rule: 'all' })],
        rpcCalls,
        rpcOutcome: 'advanced',
      }),
      'cfg-2',
      ADMIN
    );
    // One call: no separate pool write for an approver to slip in front of.
    expect(rpcCalls).toEqual([repointCall(['u-chandana'], 'all')]);
    expect(runSubjectFollowUp).toHaveBeenCalledTimes(1);
    expect(runSubjectFollowUp.mock.calls[0][0]).toMatchObject({
      outcome: 'advanced',
      decidedStageOrder: 2,
      nextStageOrder: 3,
      via: 'repoint',
    });
  });

  it('still sends a live all step whose people and rule did not change, and runs nothing when it stays', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({ status: 'pending', approval_rule: 'all' })],
        rpcCalls,
        rpcOutcome: 'unchanged',
      }),
      'cfg-2',
      ADMIN
    );
    expect(changed).toBe(0);
    expect(rpcCalls).toHaveLength(1);
    expect(runSubjectFollowUp).not.toHaveBeenCalled();
  });

  it('counts nothing for a request that closed while it waited for the lock', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({})],
        rpcCalls,
        rpcOutcome: 'skipped',
      }),
      'cfg-2',
      ADMIN
    );
    expect(rpcCalls).toHaveLength(1);
    expect(changed).toBe(0);
  });

  it('leaves a live all step entirely alone without an acting admin', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await repointWaitingStages(
      makeService({
        configuredRule: 'all',
        approvers: ['u-chandana'],
        openRows: [openRow({ status: 'pending', approval_rule: 'all' })],
        rpcCalls,
        rpcOutcome: 'advanced',
      }),
      'cfg-2'
    );
    expect(rpcCalls).toEqual([]);
    expect(runSubjectFollowUp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still fills a live any step without an acting admin — it cannot close', async () => {
    // What the repair script is for: a step nobody was on when the parent filed.
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'any',
        approvers: ['u-chandana'],
        openRows: [openRow({ status: 'pending', approver_pool: [] })],
        rpcCalls,
      }),
      'cfg-2'
    );
    expect(changed).toBe(1);
    expect(rpcCalls).toEqual([repointCall(['u-chandana'], 'any')]);
  });

  it('sends nothing for a live any step with nothing to change', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    await repointWaitingStages(
      makeService({
        configuredRule: 'any',
        approvers: ['u-chandana', 'u-christina'],
        openRows: [openRow({ status: 'pending', approval_rule: 'any' })],
        rpcCalls,
      }),
      'cfg-2',
      ADMIN
    );
    expect(rpcCalls).toEqual([]);
  });

  it('finds a renamed step’s requests by the step they came from, not the old name', async () => {
    const rpcCalls: Array<{ name: string; args: Row }> = [];
    const changed = await repointWaitingStages(
      makeService({
        configuredRule: 'any',
        approvers: ['u-chandana'],
        openRows: [
          // Filed as "Board", renamed since — still a copy of cfg-2.
          openRow({ id: 'ars-renamed', label: 'Board' }),
          // Same name as the step, but copied from a different one.
          openRow({ id: 'ars-other', config_stage_id: 'cfg-9' }),
          // Filed before 146 and not placed by the backfill: label fallback.
          openRow({ id: 'ars-legacy', config_stage_id: null }),
          openRow({
            id: 'ars-legacy-other',
            config_stage_id: null,
            label: 'Board',
          }),
        ],
        rpcCalls,
      }),
      'cfg-2',
      ADMIN
    );
    expect(rpcCalls.map((c) => c.args.p_request_stage_id)).toEqual([
      'ars-renamed',
      'ars-legacy',
    ]);
    expect(changed).toBe(2);
  });
});

describe('openApprovalRequest — each ladder row names the step it came from', () => {
  it('stamps config_stage_id on every row', async () => {
    const captured: Row[] = [];
    const service = {
      from(table: string) {
        if (table === 'approval_stages') {
          return chain(() => ({
            data: [
              {
                id: 'cfg-1',
                stage_order: 1,
                label: 'Adviser',
                resolver: 'form_adviser',
              },
              {
                id: 'cfg-2',
                stage_order: 3,
                label: 'Board',
                resolver: 'named',
              },
            ],
            error: null,
          }));
        }
        if (table === 'approval_stage_approvers') {
          return chain(() => ({ data: [], error: null }));
        }
        if (table === 'approval_requests') {
          return {
            insert: () => chain(() => ({ data: { id: 'apr-1' }, error: null })),
          };
        }
        return {
          insert: (rows: Row[]) => {
            captured.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    await openApprovalRequest(service, {
      flow: 'markbook.grade_change_aeb',
      subjectType: 'grade_change_request',
      subjectId: 'gcr-1',
      sectionId: 'sec-1',
      levelType: 'secondary',
      filedBy: 'u-teacher',
      filedByEmail: 'teacher@hfse.test',
    });
    expect(captured.map((r) => [r.stage_order, r.config_stage_id])).toEqual([
      [1, 'cfg-1'],
      [2, 'cfg-2'],
    ]);
  });
});
