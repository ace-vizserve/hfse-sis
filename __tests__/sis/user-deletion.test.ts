import { describe, expect, it, beforeEach, vi } from 'vitest';

const repointWaitingStages = vi.fn(
  async (_service: unknown, _stageId: string, _actor: unknown) => 0
);
vi.mock('@/lib/approvals/materialise', () => ({
  repointWaitingStages: (service: unknown, stageId: string, actor: unknown) =>
    repointWaitingStages(service, stageId, actor),
}));

import {
  getUserFootprint,
  isLastSuperadmin,
  listApprovalStagesNamingUser,
  repointStagesAfterUserDeletion,
} from '@/lib/sis/user-deletion';

// Records every (table, column) pair queried, and lets each test decide
// which (table, column) pairs should report an existing row.
const queryCalls: Array<{ table: string; column: string }> = [];
const hits = new Set<string>(); // `${table}.${column}` keys that should "match"

function mockClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string) => ({
          limit: (_n: number) => {
            queryCalls.push({ table, column });
            const matched = hits.has(`${table}.${column}`);
            return Promise.resolve({
              data: matched ? [{ id: 'row-1' }] : [],
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

describe('getUserFootprint', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    hits.clear();
  });

  it('teacher role only queries teacher-relevant tables', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'teacher');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set([
        // Twice over: the classes they hold, and any they are covering for an
        // absent colleague (migration 117, `relief_teacher_user_id`). Both are
        // columns on the same table, so the deduped set names it once.
        // Migration 117 declares no cross-schema FK — the convention its
        // neighbour teacher_user_id follows — so this footprint check is the
        // only thing stopping a delete from leaving a cover pointing at nobody.
        'teacher_assignments',
        'grade_change_requests',
        'attendance_daily',
        'evaluation_writeups',
      ])
    );
  });

  it('admissions role only queries its 2 document tables', async () => {
    // Was two tests: `p_file_officer` queried both of these and `admissions`
    // queried only `p_file_outreach`. The officer role was retired 2026-09-10
    // and admissions inherited `p_file_revisions.replaced_by_user_id` with the
    // upload capability that writes it — without it, deleting an admissions
    // account would pass the footprint check and strand the revision.
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'admissions');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set(['p_file_revisions', 'p_file_outreach'])
    );
  });

  it('returns an empty array when nothing matches', async () => {
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual([]);
  });

  it('returns the matching table name when a row exists', async () => {
    hits.add('evaluation_writeups.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual(['evaluation_writeups']);
  });

  it('dedupes when multiple columns on the same table match', async () => {
    hits.add('grade_change_requests.requested_by');
    hits.add('grade_change_requests.reviewed_by');
    const client = mockClient();
    const result = await getUserFootprint(
      client as never,
      'user-1',
      'school_admin'
    );
    expect(result).toEqual(['grade_change_requests']);
  });

  it("a null role checks the union of every role's tables", async () => {
    // level_aliases is only in academic_coordinator/school_admin/superadmin's
    // lists, never teacher's or admissions' — proves the
    // null-role fallback is broader than any single role's list.
    hits.add('level_aliases.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', null);
    expect(result).toEqual(['level_aliases']);
  });

  it('treats a query error as a match (fails closed, never silently allows delete)', async () => {
    const erroringClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    };
    const result = await getUserFootprint(
      erroringClient as never,
      'user-1',
      'admissions'
    );
    expect(result.sort()).toEqual(['p_file_outreach', 'p_file_revisions']);
  });
});

// ⚠ NOT PART OF THE FOOTPRINT, deliberately — the role table-lists above are
// unchanged. Being named on an approval step is configuration: the rows
// cascade away with the account (migration 126), so they must never block a
// delete. What they need is the requests already on those steps brought in
// line afterwards, or a step that needs everyone waits forever for a yes from
// an account that no longer exists.
describe('approval steps the account is named on', () => {
  beforeEach(() => {
    repointWaitingStages.mockReset();
    repointWaitingStages.mockImplementation(async () => 0);
  });

  it('lists each step once, however many rows name the person on it', async () => {
    const calls: Array<{ table: string; column: string; value: string }> = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: string) => {
            calls.push({ table, column, value });
            return Promise.resolve({
              // One row per half of the school on stage-1.
              data: [
                { stage_id: 'stage-1' },
                { stage_id: 'stage-1' },
                { stage_id: 'stage-2' },
              ],
              error: null,
            });
          },
        }),
      }),
    };
    const ids = await listApprovalStagesNamingUser(client as never, 'user-1');
    expect(ids).toEqual(['stage-1', 'stage-2']);
    expect(calls).toEqual([
      { table: 'approval_stage_approvers', column: 'user_id', value: 'user-1' },
    ]);
  });

  it('throws on a read error, so the route can refuse the delete', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    };
    await expect(
      listApprovalStagesNamingUser(client as never, 'user-1')
    ).rejects.toThrow('boom');
  });

  it('re-points every step with the deleting admin, and a failure on one does not stop the rest', async () => {
    const actor = {
      id: 'u-super',
      email: 'super@hfse.test',
      role: 'superadmin' as const,
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    repointWaitingStages.mockImplementationOnce(async () => {
      throw new Error('lock timeout');
    });
    await repointStagesAfterUserDeletion(
      {} as never,
      ['stage-1', 'stage-2'],
      actor
    );
    expect(repointWaitingStages.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['stage-1', actor],
      ['stage-2', actor],
    ]);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});

describe('isLastSuperadmin', () => {
  it('true when the target is the only superadmin', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'teacher' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });

  it('false when another superadmin exists besides the target', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('false when the target itself is not even a superadmin (guard only fires for superadmin targets)', () => {
    const users = [
      { id: 'a', role: 'teacher' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('true when the users list is otherwise empty of superadmins besides the target', () => {
    const users = [{ id: 'a', role: 'superadmin' }];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });
});
