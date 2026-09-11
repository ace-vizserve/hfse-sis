/**
 * "Any one of them approves" / "Everyone must approve" on the approvers screen
 * (migration 145) — the config writes and the two routes that carry them.
 *
 * Pinned:
 *   1. `setStageRule` writes the setting, refuses "everyone" on a form adviser
 *      step, does nothing when nothing changes, and re-points the requests
 *      already waiting WITH the actor — because relaxing a step can finish it,
 *      and what that sets moving is on that person's name.
 *   2. Adding and removing a person hands the actor on too: taking the last
 *      hold-out off an "everyone" step finishes it.
 *   3. POST accepts the setting (default "any"), refuses "everyone" on an
 *      adviser step in words, audits it, and still busts `sis-health`.
 *   4. PATCH changes it, audits before and after, and refuses before writing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const { repointMock, revalidateTagMock, logActionMock } = vi.hoisted(() => ({
  repointMock: vi.fn(async (..._args: unknown[]) => 2),
  revalidateTagMock: vi.fn(),
  logActionMock: vi.fn(async (_entry: Record<string, unknown>) => undefined),
}));

vi.mock('@/lib/approvals/materialise', () => ({
  repointWaitingStages: (...args: unknown[]) => repointMock(...args),
}));
vi.mock('@/lib/sis/users/queries', () => ({
  listStaffUsers: vi.fn(async () => []),
}));
vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: Record<string, unknown>) => logActionMock(entry),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(async () => ({
    user: { id: 'u-super', email: 'super@hfse.test' },
    role: 'superadmin',
  })),
}));

/**
 * A Supabase stand-in that answers every read of a table with a fixed row and
 * records every write. Enough for the handful of chains these functions use.
 */
type Write = {
  table: string;
  op: 'insert' | 'update' | 'delete';
  payload: unknown;
  eqs: Array<[string, unknown]>;
};
function makeService(rows: Record<string, unknown>) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let op: 'select' | Write['op'] = 'select';
    let payload: unknown;
    const eqs: Array<[string, unknown]> = [];
    const settle = async () => {
      if (op === 'select') return { data: rows[table] ?? null, error: null };
      writes.push({ table, op, payload, eqs });
      return {
        data: op === 'insert' ? (rows[`${table}:inserted`] ?? null) : null,
        error: null,
      };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqs.push([column, value]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (p: unknown) => {
        op = 'insert';
        payload = p;
        return builder;
      },
      update: (p: unknown) => {
        op = 'update';
        payload = p;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      maybeSingle: settle,
      single: settle,
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) => settle().then(resolve, reject),
    };
    return builder;
  };
  return {
    service: { from } as unknown as SupabaseClient,
    writes,
  };
}

let current = makeService({});
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => current.service,
}));

import {
  EVERYONE_NEEDS_NAMED_PEOPLE,
  assignStageApprover,
  removeStageApprover,
  setStageRule,
} from '@/lib/approvals/config';
import { POST } from '@/app/api/sis/admin/approval-stages/route';
import { PATCH } from '@/app/api/sis/admin/approval-stages/[id]/route';

const ACTOR = { id: 'u-super', email: 'super@hfse.test', role: 'superadmin' };

beforeEach(() => {
  repointMock.mockClear();
  revalidateTagMock.mockClear();
  logActionMock.mockClear();
});

// ── Config ─────────────────────────────────────────────────────────────────

describe('setStageRule', () => {
  it('writes the setting and re-points waiting requests with the actor', async () => {
    const { service, writes } = makeService({
      approval_stages: { id: 'st-1', resolver: 'named', approval_rule: 'any' },
    });
    const result = await setStageRule(service, 'st-1', 'all', ACTOR as never);

    expect(result).toEqual({
      ok: true,
      changed: true,
      previous: 'any',
      repointed: 2,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: 'approval_stages',
      op: 'update',
      payload: expect.objectContaining({ approval_rule: 'all' }),
      eqs: [['id', 'st-1']],
    });
    expect(repointMock).toHaveBeenCalledWith(service, 'st-1', ACTOR);
  });

  it('refuses "everyone" on a form adviser step, and writes nothing', async () => {
    const { service, writes } = makeService({
      approval_stages: {
        id: 'st-1',
        resolver: 'form_adviser',
        approval_rule: 'any',
      },
    });
    const result = await setStageRule(service, 'st-1', 'all', ACTOR as never);
    expect(result).toEqual({ ok: false, reason: 'needs_named_people' });
    expect(writes).toEqual([]);
    expect(repointMock).not.toHaveBeenCalled();
  });

  it('does nothing when the step already has that setting', async () => {
    const { service, writes } = makeService({
      approval_stages: { id: 'st-1', resolver: 'named', approval_rule: 'all' },
    });
    const result = await setStageRule(service, 'st-1', 'all', ACTOR as never);
    expect(result).toMatchObject({ ok: true, changed: false, repointed: 0 });
    expect(writes).toEqual([]);
    expect(repointMock).not.toHaveBeenCalled();
  });

  it('says so when the step is gone', async () => {
    const { service } = makeService({ approval_stages: null });
    expect(await setStageRule(service, 'st-x', 'any', ACTOR as never)).toEqual({
      ok: false,
      reason: 'stage_not_found',
    });
  });
});

describe('changing who is on a step hands the actor on', () => {
  it('when somebody is added', async () => {
    const { service } = makeService({
      'approval_stage_approvers:inserted': { id: 'row-1' },
    });
    await assignStageApprover(service, {
      stageId: 'st-1',
      userId: 'u-gary',
      createdBy: 'u-super',
      actor: ACTOR as never,
    });
    expect(repointMock).toHaveBeenCalledWith(service, 'st-1', ACTOR);
  });

  it('when somebody is taken off — which can finish an "everyone" step', async () => {
    const { service } = makeService({
      approval_stage_approvers: {
        id: 'row-1',
        stage_id: 'st-1',
        user_id: 'u-gary',
        applies_to_level_type: null,
      },
    });
    await removeStageApprover(service, 'row-1', ACTOR as never);
    expect(repointMock).toHaveBeenCalledWith(service, 'st-1', ACTOR);
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────

/** The routes' return type admits `undefined`; a test that got none has failed. */
function answered(res: Response | undefined): Response {
  if (!res) throw new Error('the route returned no response');
  return res;
}

async function post(body: unknown): Promise<Response> {
  return answered(
    await POST(
      new Request('http://localhost/api/sis/admin/approval-stages', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    )
  );
}

async function patch(id: string, body: unknown): Promise<Response> {
  return answered(
    await PATCH(
      new Request(`http://localhost/api/sis/admin/approval-stages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    )
  );
}

describe('POST /api/sis/admin/approval-stages', () => {
  const inserted = (rule: string, resolver = 'named') => ({
    approval_stages: [{ stage_order: 1 }],
    'approval_stages:inserted': {
      id: 'st-new',
      flow: 'markbook.grade_change_aeb',
      stage_order: 2,
      label: 'Board',
      resolver,
      approval_rule: rule,
    },
  });

  it('adds a step that needs everyone, and records the setting', async () => {
    current = makeService(inserted('all'));
    const res = await post({
      flow: 'markbook.grade_change_aeb',
      label: 'Board',
      resolver: 'named',
      approval_rule: 'all',
    });
    expect(res.status).toBe(201);
    const insert = current.writes.find((w) => w.op === 'insert');
    expect(insert?.payload).toMatchObject({ approval_rule: 'all' });
    expect(logActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'approval_stage.create',
        context: expect.objectContaining({ approval_rule: 'all' }),
      })
    );
    expect(revalidateTagMock).toHaveBeenCalledWith('sis-health', 'max');
  });

  it('defaults to "any one of them" when the setting is not sent', async () => {
    current = makeService(inserted('any'));
    const res = await post({
      flow: 'markbook.grade_change_aeb',
      label: 'Board',
      resolver: 'named',
    });
    expect(res.status).toBe(201);
    const insert = current.writes.find((w) => w.op === 'insert');
    expect(insert?.payload).toMatchObject({ approval_rule: 'any' });
  });

  it('refuses "everyone" on a form adviser step, in words, before writing', async () => {
    current = makeService(inserted('all', 'form_adviser'));
    const res = await post({
      flow: 'attendance.student_declaration',
      label: 'Form class adviser',
      resolver: 'form_adviser',
      approval_rule: 'all',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(EVERYONE_NEEDS_NAMED_PEOPLE);
    expect(current.writes).toEqual([]);
    expect(logActionMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/sis/admin/approval-stages/[id]', () => {
  const stageRow = (resolver: string, rule: string) => ({
    approval_stages: {
      id: 'st-1',
      flow: 'markbook.grade_change_aeb',
      stage_order: 2,
      label: 'Board',
      resolver,
      approval_rule: rule,
      is_active: true,
    },
  });

  it('changes the setting, re-points with the actor, and audits before and after', async () => {
    current = makeService(stageRow('named', 'any'));
    const res = await patch('st-1', { approval_rule: 'all' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.message).toContain('Everyone on “Board” must now approve');

    expect(repointMock).toHaveBeenCalledWith(current.service, 'st-1', ACTOR);
    expect(logActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'approval_stage.update',
        entityId: 'st-1',
        actor: ACTOR,
        context: expect.objectContaining({
          stage_label: 'Board',
          approval_rule: 'all',
          previous_approval_rule: 'any',
          repointed_waiting: 2,
        }),
      })
    );
    expect(revalidateTagMock).toHaveBeenCalledWith('sis-health', 'max');
  });

  it('refuses "everyone" on a form adviser step before anything is written', async () => {
    current = makeService(stageRow('form_adviser', 'any'));
    const res = await patch('st-1', { approval_rule: 'all', label: 'Renamed' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(EVERYONE_NEEDS_NAMED_PEOPLE);
    // Not even the rename — a request must not half-succeed.
    expect(current.writes).toEqual([]);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('allows "any one of them" on a form adviser step (it is the only setting)', async () => {
    current = makeService(stageRow('form_adviser', 'any'));
    const res = await patch('st-1', { approval_rule: 'any' });
    expect(res.status).toBe(200);
    expect(repointMock).not.toHaveBeenCalled();
  });

  it('says what changed in plain words, with no schema vocabulary', async () => {
    current = makeService(stageRow('named', 'all'));
    const res = await patch('st-1', { approval_rule: 'any' });
    const { message } = await res.json();
    expect(message).toContain('Any one person on “Board” can now approve it');
    expect(message).not.toMatch(/rule|flow|stage|pool|resolver/i);
  });

  // Migration 146: the setting reaches requests sitting on the step now, and
  // relaxing it moves on any somebody there already approved. The toast says
  // so, because it is now true.
  it('says the requests already at the step follow the change, and which move on', async () => {
    current = makeService(stageRow('named', 'all'));
    const relaxed = await (
      await patch('st-1', { approval_rule: 'any' })
    ).json();
    expect(relaxed.message).toBe(
      'Saved. Any one person on “Board” can now approve it. The 2 requests already at or heading to this step follow the change too, and any that someone on the step has already approved move on.'
    );

    current = makeService(stageRow('named', 'any'));
    repointMock.mockImplementationOnce(async () => 1);
    const tightened = await (
      await patch('st-1', { approval_rule: 'all' })
    ).json();
    expect(tightened.message).toBe(
      'Saved. Everyone on “Board” must now approve before it moves on. The 1 request already at or heading to this step follows the change too.'
    );
  });

  it('says nothing about requests when none were waiting', async () => {
    current = makeService(stageRow('named', 'any'));
    repointMock.mockImplementationOnce(async () => 0);
    const { message } = await (
      await patch('st-1', { approval_rule: 'all' })
    ).json();
    expect(message).toBe(
      'Saved. Everyone on “Board” must now approve before it moves on.'
    );
  });
});
