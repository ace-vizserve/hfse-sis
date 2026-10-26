import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Subject heads (Task 4 of the SOW module).
 *
 * Pinned:
 *   1. The pool for one subject and one half of the school is every untagged
 *      head plus the heads of that half, each person once.
 *   2. Changing a subject's heads re-points the live subject-head steps of
 *      that subject's schemes of work, through the migration-146 RPC with the
 *      rule 'any' and the filer kept off.
 *   3. Other subjects' requests are left alone.
 *   4. Only someone who manages approvers can change the setting.
 */

const { logActionMock, requireCapabilityMock, staffMock } = vi.hoisted(() => ({
  logActionMock: vi.fn(async (_entry: Record<string, unknown>) => undefined),
  requireCapabilityMock: vi.fn(),
  staffMock: vi.fn(),
}));

/** A staff account as `listStaffUsers` returns it. */
const staff = (id: string, disabled = false) => ({
  id,
  email: `${id}@hfse.test`,
  role: 'teacher',
  roles: ['teacher'],
  display_name: id,
  disabled,
  created_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: null,
});

vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: Record<string, unknown>) => logActionMock(entry),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));
vi.mock('@/lib/sis/users/queries', () => ({
  listStaffUsers: () => staffMock(),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('the route must refuse before touching the database');
  },
}));

import { loadFlowConfig } from '@/lib/approvals/config';
import {
  listActiveSubjectHeads,
  replaceSubjectHeads,
  subjectHeadPool,
  type SubjectHeadRow,
} from '@/lib/sow/subject-heads';
import { PUT } from '@/app/api/sis-admin/subject-heads/route';

type Row = Record<string, unknown>;

/** A query builder that records its filters and resolves to `rows`. */
function query(rows: () => Row[], log: Row[], table: string) {
  const filters: Array<[string, string, unknown]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit']) q[m] = () => q;
  q.eq = (col: string, v: unknown) => {
    filters.push(['eq', col, v]);
    return q;
  };
  q.in = (col: string, v: unknown) => {
    filters.push(['in', col, v]);
    return q;
  };
  const result = () => {
    log.push({ table, filters: [...filters] });
    return { data: rows(), error: null };
  };
  q.maybeSingle = () =>
    Promise.resolve({ ...result(), data: rows()[0] ?? null });
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve);
  return q;
}

type Fake = {
  service: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
  inserted: Row[];
  deleted: unknown[];
};

function makeService(): Fake {
  const log: Row[] = [];
  const inserted: Row[] = [];
  const deleted: unknown[] = [];
  const rpc = vi.fn(async () => ({
    data: [
      {
        outcome: 'unchanged',
        decided_stage_order: null,
        next_stage_order: null,
      },
    ],
    error: null,
  }));

  const tables: Record<string, () => Row[]> = {
    subject_heads: () => [
      { id: 'sh-old', user_id: 'u-old', applies_to_level_type: null },
    ],
    subjects: () => [{ name: 'Mathematics' }],
    approval_stages: () => [{ id: 'cfg-head' }],
    approval_request_stages: () => [
      {
        id: 'rs-math',
        request_id: 'apr-math',
        status: 'waiting',
        approval_rule: 'any',
        level_type: 'primary',
        approver_pool: ['u-old'],
        config_stage_id: 'cfg-head',
        approval_requests: {
          flow: 'markbook.scheme_of_work',
          status: 'pending',
          filed_by: 'u-teacher',
          subject_id: 'sub-math',
        },
      },
      {
        id: 'rs-eng',
        request_id: 'apr-eng',
        status: 'pending',
        approval_rule: 'any',
        level_type: 'primary',
        approver_pool: ['u-eng'],
        config_stage_id: 'cfg-head',
        approval_requests: {
          flow: 'markbook.scheme_of_work',
          status: 'pending',
          filed_by: 'u-teacher',
          subject_id: 'sub-eng',
        },
      },
    ],
    scheme_of_work_submissions: () => [
      { id: 'sub-math', schemes_of_work: { subject_id: 'subj-math' } },
      { id: 'sub-eng', schemes_of_work: { subject_id: 'subj-eng' } },
    ],
  };

  const service = {
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const q = query(rows, log, table);
      return {
        ...q,
        select: () => q,
        insert: (r: Row[]) => {
          inserted.push(...r);
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          in: (_col: string, ids: unknown) => {
            deleted.push(ids);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    rpc,
  } as unknown as SupabaseClient;

  return { service, rpc, inserted, deleted };
}

const ACTOR = { id: 'u-admin', email: 'admin@hfse.test' };

beforeEach(() => {
  logActionMock.mockClear();
  requireCapabilityMock.mockReset();
  staffMock.mockReset();
  staffMock.mockResolvedValue(
    ['u-admin', 'u-old', 'u-new', 'u-sec', 'u-teacher', 'u-eng'].map((id) =>
      staff(id)
    )
  );
});

/** A read-only service over fixed tables, for the head readers. */
function readService(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      return query(() => rows, [], table);
    },
  } as unknown as SupabaseClient;
}

const HEAD_ROWS: Row[] = [
  { subject_id: 'subj-math', user_id: 'u-live', applies_to_level_type: null },
  // Account deleted: no longer in the staff list.
  { subject_id: 'subj-math', user_id: 'u-gone', applies_to_level_type: null },
  // Account switched off.
  { subject_id: 'subj-math', user_id: 'u-off', applies_to_level_type: null },
];

describe('heads whose account is gone or switched off', () => {
  beforeEach(() => {
    staffMock.mockResolvedValue([staff('u-live'), staff('u-off', true)]);
  });

  it('listActiveSubjectHeads leaves them out of the pool a SOW is filed with', async () => {
    const heads = await listActiveSubjectHeads(
      readService({ subject_heads: HEAD_ROWS })
    );
    expect(subjectHeadPool(heads, 'subj-math', 'primary')).toEqual(['u-live']);
  });

  it('listActiveSubjectHeads refuses to guess when the staff list is empty', async () => {
    staffMock.mockResolvedValue([]);
    await expect(
      listActiveSubjectHeads(readService({ subject_heads: HEAD_ROWS }))
    ).rejects.toThrow(/staff list/);
  });

  it('the readiness count counts only heads who can act', async () => {
    const config = await loadFlowConfig(
      readService({
        approval_stages: [
          {
            id: 'cfg-head',
            flow: 'markbook.scheme_of_work',
            stage_order: 1,
            label: 'Subject head',
            resolver: 'subject_head',
            approval_rule: 'any',
          },
        ],
        approval_stage_approvers: [],
        subject_heads: HEAD_ROWS,
      }),
      'markbook.scheme_of_work'
    );
    expect(config.stages[0].subjectHeadCount).toBe(1);
  });

  it('a re-point leaves a switched-off head out of the waiting step', async () => {
    staffMock.mockResolvedValue([
      staff('u-new'),
      staff('u-off', true),
      staff('u-teacher'),
    ]);
    const fake = makeService();
    await replaceSubjectHeads(fake.service, ACTOR, 'subj-math', [
      { userId: 'u-new', appliesToLevelType: null },
      { userId: 'u-off', appliesToLevelType: null },
    ]);
    expect(fake.rpc).toHaveBeenCalledWith('approval_repoint_request_stage', {
      p_request_stage_id: 'rs-math',
      p_pool: ['u-new'],
      p_rule: 'any',
    });
  });
});

describe('subjectHeadPool', () => {
  it('subjectHeadPool picks untagged plus matching half, deduped', () => {
    const rows: SubjectHeadRow[] = [
      { subjectId: 'subj-math', userId: 'u-a', appliesToLevelType: null },
      { subjectId: 'subj-math', userId: 'u-b', appliesToLevelType: 'primary' },
      {
        subjectId: 'subj-math',
        userId: 'u-c',
        appliesToLevelType: 'secondary',
      },
      // Untagged AND tagged: still one person in the pool.
      { subjectId: 'subj-math', userId: 'u-a', appliesToLevelType: 'primary' },
      // Another subject never leaks in.
      { subjectId: 'subj-eng', userId: 'u-d', appliesToLevelType: null },
    ];
    expect(subjectHeadPool(rows, 'subj-math', 'primary')).toEqual([
      'u-a',
      'u-b',
    ]);
    expect(subjectHeadPool(rows, 'subj-math', 'secondary')).toEqual([
      'u-a',
      'u-c',
    ]);
    // A level with no half (or one not known) gets the untagged heads only.
    expect(subjectHeadPool(rows, 'subj-math', null)).toEqual(['u-a']);
  });
});

describe('replaceSubjectHeads', () => {
  it('replacing heads re-points a waiting SOW step to the new pool', async () => {
    const fake = makeService();
    const result = await replaceSubjectHeads(fake.service, ACTOR, 'subj-math', [
      { userId: 'u-new', appliesToLevelType: null },
      { userId: 'u-sec', appliesToLevelType: 'secondary' },
      // The filer is never on their own request's pool.
      { userId: 'u-teacher', appliesToLevelType: 'primary' },
    ]);

    expect(fake.deleted).toEqual([['sh-old']]);
    expect(fake.inserted.map((r) => r.user_id)).toEqual([
      'u-new',
      'u-sec',
      'u-teacher',
    ]);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('approval_repoint_request_stage', {
      p_request_stage_id: 'rs-math',
      p_pool: ['u-new'],
      p_rule: 'any',
    });
    expect(result).toEqual({ repointed: 1 });

    expect(logActionMock).toHaveBeenCalledTimes(1);
    const entry = logActionMock.mock.calls[0][0];
    expect(entry.action).toBe('sow.subject_head.set');
    expect(entry.entityType).toBe('subject');
    expect(entry.entityId).toBe('subj-math');
    expect((entry.context as Row).repointed_waiting).toBe(1);
  });

  it("replacing heads leaves other subjects' requests alone", async () => {
    const fake = makeService();
    await replaceSubjectHeads(fake.service, ACTOR, 'subj-math', [
      { userId: 'u-new', appliesToLevelType: null },
    ]);
    const stageIds = fake.rpc.mock.calls.map(
      (c) => (c[1] as Row).p_request_stage_id
    );
    expect(stageIds).not.toContain('rs-eng');
  });
});

describe('PUT /api/sis-admin/subject-heads', () => {
  it('PUT refuses a teacher', async () => {
    const { NextResponse } = await import('next/server');
    requireCapabilityMock.mockResolvedValue({
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await PUT(
      new Request('http://localhost/api/sis-admin/subject-heads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id: 'subj-math', heads: [] }),
      })
    );
    expect(res?.status).toBe(403);
    expect(requireCapabilityMock).toHaveBeenCalledWith('approvers.manage');
  });
});
