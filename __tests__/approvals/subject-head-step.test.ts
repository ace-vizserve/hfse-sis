import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sis/users/queries', () => ({
  listStaffUsers: vi.fn(async () => []),
}));

import { createStage } from '@/lib/approvals/config';
import {
  openApprovalRequest,
  repointWaitingStages,
} from '@/lib/approvals/materialise';
import {
  CreateApprovalStageSchema,
  SOW_APPROVAL_FLOW,
} from '@/lib/schemas/approval-flows';

/**
 * The "subject head" kind of step (Task 3 of the SOW module, KD #196).
 *
 * Pinned:
 *   1. A configured `subject_head` step is filed as a NAMED request step with
 *      the pool the caller worked out — `approval_request_stages.resolver`
 *      never learns the new word, so `approval_advance` is untouched.
 *   2. The filer is never in that pool.
 *   3. An empty pool still files, and the step stalls (a stall is never a skip).
 *   4. Only the scheme-of-work flow can have such a step.
 *   5. `repointWaitingStages` leaves it alone — the subject-heads setting
 *      re-points those (Task 4).
 */

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

function makeService(captured: { stageRows: Row[] }): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'approval_stages') {
        return chain(() => ({
          data: [
            {
              id: 'cfg-head',
              stage_order: 1,
              label: 'Subject head',
              resolver: 'subject_head',
              approval_rule: 'any',
            },
            {
              id: 'cfg-oic',
              stage_order: 2,
              label: 'Officer in charge',
              resolver: 'named',
              approval_rule: 'any',
            },
          ],
          error: null,
        }));
      }
      if (table === 'approval_stage_approvers') {
        return chain(() => ({
          data: [
            {
              stage_id: 'cfg-oic',
              user_id: 'u-oic',
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
  flow: SOW_APPROVAL_FLOW,
  subjectType: 'scheme_of_work',
  subjectId: 'sow-1',
  sectionId: null,
  levelType: 'primary' as const,
  filedBy: 'u-t',
  filedByEmail: 'teacher@hfse.test',
};

describe('openApprovalRequest — subject-head steps', () => {
  it('a subject-head step is filed as a named step with the given pool', async () => {
    const captured = { stageRows: [] as Row[] };
    const result = await openApprovalRequest(makeService(captured), {
      ...BASE,
      subjectHeadPool: ['u-head'],
    });
    expect(result).toEqual({ opened: true, requestId: 'apr-1', stageCount: 2 });
    const [head, oic] = captured.stageRows;
    expect(head.resolver).toBe('named');
    expect(head.approver_pool).toEqual(['u-head']);
    expect(head.approval_rule).toBe('any');
    expect(head.section_id).toBeNull();
    expect(head.config_stage_id).toBe('cfg-head');
    expect(head.status).toBe('pending');
    // The named step beside it is filed exactly as before.
    expect(oic.resolver).toBe('named');
    expect(oic.approver_pool).toEqual(['u-oic']);
  });

  it('the filer is never in a subject-head pool', async () => {
    const captured = { stageRows: [] as Row[] };
    await openApprovalRequest(makeService(captured), {
      ...BASE,
      subjectHeadPool: ['u-t', 'u-head'],
    });
    expect(captured.stageRows[0].approver_pool).toEqual(['u-head']);
  });

  it('an empty subject-head pool still files and stalls', async () => {
    const captured = { stageRows: [] as Row[] };
    const result = await openApprovalRequest(makeService(captured), {
      ...BASE,
      subjectHeadPool: [],
    });
    expect(result.opened).toBe(true);
    expect(captured.stageRows).toHaveLength(2);
    expect(captured.stageRows[0].approver_pool).toEqual([]);
    expect(captured.stageRows[0].status).toBe('pending');
  });

  it('files an empty pool when the caller passes none', async () => {
    const captured = { stageRows: [] as Row[] };
    await openApprovalRequest(makeService(captured), BASE);
    expect(captured.stageRows[0].approver_pool).toEqual([]);
  });
});

describe('the config writer — subject-head steps', () => {
  const noDb = {
    from() {
      throw new Error('should not reach the database');
    },
  } as unknown as SupabaseClient;

  it('subject_head is refused on any other flow', async () => {
    await expect(
      createStage(noDb, {
        flow: 'attendance.student_declaration',
        label: 'Subject head',
        resolver: 'subject_head',
        createdBy: 'u-admin',
      })
    ).rejects.toThrow(/scheme of work/i);

    const parsed = CreateApprovalStageSchema.safeParse({
      flow: 'markbook.grade_change',
      label: 'Subject head',
      resolver: 'subject_head',
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses "everyone must approve" on a subject-head step, in words', async () => {
    await expect(
      createStage(noDb, {
        flow: SOW_APPROVAL_FLOW,
        label: 'Subject head',
        resolver: 'subject_head',
        approvalRule: 'all',
        createdBy: 'u-admin',
      })
    ).rejects.toThrow(/subject head/i);

    const parsed = CreateApprovalStageSchema.safeParse({
      flow: SOW_APPROVAL_FLOW,
      label: 'Subject head',
      resolver: 'subject_head',
      approval_rule: 'all',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a subject-head step on the scheme of work flow', () => {
    const parsed = CreateApprovalStageSchema.safeParse({
      flow: SOW_APPROVAL_FLOW,
      label: 'Subject head',
      resolver: 'subject_head',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('repointWaitingStages — subject-head steps', () => {
  it('skips a subject-head step without touching any request', async () => {
    const touched: string[] = [];
    const service = {
      from(table: string) {
        touched.push(table);
        if (table === 'approval_stages') {
          return chain(() => ({
            data: {
              id: 'cfg-head',
              flow: SOW_APPROVAL_FLOW,
              stage_order: 1,
              label: 'Subject head',
              resolver: 'subject_head',
              approval_rule: 'any',
            },
            error: null,
          }));
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc() {
        throw new Error('should not repoint');
      },
    } as unknown as SupabaseClient;

    await expect(repointWaitingStages(service, 'cfg-head')).resolves.toBe(0);
    expect(touched).toEqual(['approval_stages']);
  });
});
