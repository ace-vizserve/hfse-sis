import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  openApprovalRequest,
  repointWaitingStages,
} from '@/lib/approvals/materialise';

/**
 * Nobody approves their own request — the engine half.
 *
 * Pinned:
 *   1. `openApprovalRequest` leaves `excludeUserIds` out of every NAMED step's
 *      frozen pool, and a caller that passes nothing (declarations) gets the
 *      pool it always got.
 *   2. `repointWaitingStages`, which rebuilds a waiting pool whenever the
 *      school edits a step, does not quietly put the filer back.
 */

type Row = Record<string, unknown>;

/** A chainable stub: every filter returns the chain; awaiting it resolves. */
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

describe('openApprovalRequest — excludeUserIds', () => {
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
              },
              {
                id: 'cfg-2',
                stage_order: 2,
                label: 'Grade change approvers',
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
                user_id: 'u-teacher',
                applies_to_level_type: null,
              },
              {
                stage_id: 'cfg-2',
                user_id: 'u-chandana',
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

  const BASE = {
    flow: 'markbook.grade_change' as const,
    subjectType: 'grade_change_request',
    subjectId: 'gcr-1',
    sectionId: 'sec-1',
    levelType: 'primary' as const,
    filedBy: 'u-teacher',
    filedByEmail: 'teacher@hfse.test',
  };

  it('keeps the named people out of the frozen pool', async () => {
    const captured = { stageRows: [] as Row[] };
    const result = await openApprovalRequest(makeService(captured), {
      ...BASE,
      excludeUserIds: ['u-teacher'],
    });
    expect(result).toEqual({ opened: true, requestId: 'apr-1', stageCount: 2 });
    expect(captured.stageRows[1].approver_pool).toEqual(['u-chandana']);
    // A derived step holds no pool either way — the pipeline guards that one.
    expect(captured.stageRows[0].approver_pool).toEqual([]);
  });

  it('changes nothing for a caller that excludes nobody', async () => {
    const captured = { stageRows: [] as Row[] };
    await openApprovalRequest(makeService(captured), BASE);
    expect(captured.stageRows[1].approver_pool).toEqual([
      'u-teacher',
      'u-chandana',
    ]);
  });
});

describe('repointWaitingStages — the filer stays off', () => {
  function makeService(
    filedBy: string | null,
    pools: unknown[]
  ): SupabaseClient {
    return {
      from(table: string) {
        if (table === 'approval_stages') {
          return chain(() => ({
            data: {
              id: 'cfg-2',
              flow: 'markbook.grade_change',
              stage_order: 2,
              label: 'Grade change approvers',
              resolver: 'named',
            },
            error: null,
          }));
        }
        if (table === 'approval_stage_approvers') {
          return chain(() => ({
            data: [
              { user_id: 'u-teacher', applies_to_level_type: null },
              { user_id: 'u-chandana', applies_to_level_type: null },
              { user_id: 'u-gary', applies_to_level_type: null },
            ],
            error: null,
          }));
        }
        if (table === 'approval_request_stages') {
          return chain(() => ({
            data: [
              {
                id: 'ars-2',
                label: 'Grade change approvers',
                level_type: 'primary',
                approver_pool: ['u-chandana'],
                approval_requests: { filed_by: filedBy },
              },
            ],
            error: null,
          }));
        }
        throw new Error(`unexpected table ${table}`);
      },
      // Migration 146: the pool is written through the locked call, and the
      // pool it is handed is what this test is about.
      rpc(_name: string, args: Row) {
        pools.push(args.p_pool);
        return Promise.resolve({
          data: [{ outcome: 'unchanged', request_status: 'pending' }],
          error: null,
        });
      },
    } as unknown as SupabaseClient;
  }

  it('adds the newly named person without putting the filer back', async () => {
    const pools: unknown[] = [];
    const changed = await repointWaitingStages(
      makeService('u-teacher', pools),
      'cfg-2'
    );
    expect(changed).toBe(1);
    expect(pools).toEqual([['u-chandana', 'u-gary']]);
  });

  it('keeps everyone when the filer is unknown', async () => {
    const pools: unknown[] = [];
    await repointWaitingStages(makeService(null, pools), 'cfg-2');
    expect(pools).toEqual([['u-teacher', 'u-chandana', 'u-gary']]);
  });
});
