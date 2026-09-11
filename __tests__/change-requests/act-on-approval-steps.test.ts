/**
 * The one-click email link for a grade change filed on the approval steps.
 *
 * Pinned:
 *   1. The confirm page offers Confirm only to somebody on the step that is
 *      waiting right now, and tells everyone else where it stands.
 *   2. The POST decides a stepped request through `decideApproval` as the
 *      token's person, marked as from the email — and a row filed before
 *      migration 144 still goes through `decideChangeRequest`, untouched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestLadder } from '@/lib/approvals/inbox';

let payload: {
  requestId: string;
  action: 'approve' | 'reject';
  approverId: string;
} | null;
vi.mock('@/lib/change-requests/action-token', () => ({
  verifyActionToken: vi.fn(() => payload),
}));

const decideApproval = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  status: 200,
  body: {
    ok: true,
    outcome: 'advanced',
    message: 'Approved. It has moved on to the next step.',
  } as Record<string, unknown>,
}));
vi.mock('@/lib/approvals/decide', () => ({
  decideApproval: (...a: unknown[]) => decideApproval(...a),
}));

const decideChangeRequest = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  httpStatus: 200,
  status: 'approved',
}));
vi.mock('@/lib/change-requests/decide', () => ({
  decideChangeRequest: (...a: unknown[]) => decideChangeRequest(...a),
}));

let approvalFlow: string | null;
let approvalRequestId: string | null;
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'grade_change_requests') {
            return {
              data: { id: 'gcr-1', approval_flow: approvalFlow },
              error: null,
            };
          }
          if (table === 'approval_requests') {
            return {
              data: approvalRequestId ? { id: approvalRequestId } : null,
              error: null,
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
      return chain;
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: {
              id,
              email: 'hod@hfse.test',
              app_metadata: { role: 'school_admin' },
              user_metadata: {},
            },
          },
          error: null,
        }),
      },
    },
  })),
}));

import { POST } from '@/app/api/change-requests/act/route';
import { classifyGradeChangeActState } from '@/lib/change-requests/approval-act';

function act(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/change-requests/act', {
      method: 'POST',
      body: JSON.stringify({ token: 'signed', ...body }),
    }) as unknown as import('next/server').NextRequest
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  payload = { requestId: 'gcr-1', action: 'approve', approverId: 'u-hod' };
  approvalFlow = 'markbook.grade_change';
  approvalRequestId = 'apr-1';
});

describe('POST /api/change-requests/act — a request on the approval steps', () => {
  it('decides the step as the token’s person, through the email door', async () => {
    const res = await act({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      outcome: 'advanced',
      message: 'Approved. It has moved on to the next step.',
    });

    expect(decideApproval).toHaveBeenCalledTimes(1);
    expect(decideApproval.mock.calls[0][0]).toMatchObject({
      actor: { id: 'u-hod', email: 'hod@hfse.test', role: 'school_admin' },
      requestId: 'apr-1',
      action: 'approve',
      note: null,
      via: 'email_token',
    });
    expect(decideChangeRequest).not.toHaveBeenCalled();
  });

  it('passes a refusal straight through — somebody not on the step is told so', async () => {
    decideApproval.mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: {
        error: 'This one is not yours to decide.',
        outcome: 'not_authorised',
      },
    });
    const res = await act({});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'This one is not yours to decide.',
      outcome: 'not_authorised',
    });
  });

  it('refuses a rejection with no reason before anything is decided', async () => {
    payload = { requestId: 'gcr-1', action: 'reject', approverId: 'u-hod' };
    const res = await act({ decision_note: '<p></p>' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/teacher is shown this/i);
    expect(decideApproval).not.toHaveBeenCalled();
  });

  it('hands a rejection’s reason to the step decision', async () => {
    payload = { requestId: 'gcr-1', action: 'reject', approverId: 'u-hod' };
    await act({ decision_note: '<p>The paper shows 20.</p>' });
    expect(decideApproval.mock.calls[0][0]).toMatchObject({
      action: 'reject',
      note: '<p>The paper shows 20.</p>',
    });
  });

  it('answers 404 when the steps behind the request are missing', async () => {
    approvalRequestId = null;
    const res = await act({});
    expect(res.status).toBe(404);
    expect(decideApproval).not.toHaveBeenCalled();
  });

  it('keeps a request filed before the steps on the old path', async () => {
    approvalFlow = null;
    const res = await act({});
    expect(res.status).toBe(200);
    expect(decideChangeRequest).toHaveBeenCalledTimes(1);
    expect(decideChangeRequest.mock.calls[0][0]).toMatchObject({
      requestId: 'gcr-1',
      actingUser: { id: 'u-hod', role: 'school_admin' },
      via: 'email_token',
    });
    expect(decideApproval).not.toHaveBeenCalled();
  });
});

// ── Who the confirm page offers the button to ─────────────────────────────

function ladder(over: Partial<RequestLadder> = {}): RequestLadder {
  return {
    requestId: 'apr-1',
    flow: 'markbook.grade_change',
    subjectType: 'grade_change_request',
    subjectId: 'gcr-1',
    status: 'pending',
    currentStageOrder: 2,
    filedBy: 'u-teacher',
    filedByEmail: 'teacher@hfse.test',
    filedAt: '2026-09-10T00:00:00.000Z',
    decidedAt: null,
    stages: [
      {
        stageOrder: 1,
        label: 'Form class adviser',
        resolver: 'form_adviser',
        status: 'approved',
        sectionId: 'sec-1',
        approverPool: [],
        approvalRule: 'any',
        decisions: [],
        decidedBy: 'u-adviser',
        decidedByEmail: 'adviser@hfse.test',
        decidedAt: '2026-09-10T02:00:00.000Z',
        decisionNote: null,
      },
      {
        stageOrder: 2,
        label: 'Head of department',
        resolver: 'named',
        status: 'pending',
        sectionId: null,
        approverPool: ['u-hod', 'u-deputy'],
        approvalRule: 'any',
        decisions: [],
        decidedBy: null,
        decidedByEmail: null,
        decidedAt: null,
        decisionNote: null,
      },
      {
        stageOrder: 3,
        label: 'Principal',
        resolver: 'named',
        status: 'waiting',
        sectionId: null,
        approverPool: ['u-principal'],
        approvalRule: 'any',
        decisions: [],
        decidedBy: null,
        decidedByEmail: null,
        decidedAt: null,
        decisionNote: null,
      },
    ],
    ...over,
  };
}

const NONE = new Set<string>();

describe('classifyGradeChangeActState', () => {
  it('offers Confirm to somebody on the step that is waiting', () => {
    expect(classifyGradeChangeActState(ladder(), 'u-deputy', NONE)).toEqual({
      kind: 'can_act',
      requestId: 'apr-1',
      stageOrder: 2,
      stageCount: 3,
      stageLabel: 'Head of department',
    });
  });

  it('offers Confirm on a form adviser step to whoever advises the class now', () => {
    const atStepOne = ladder({
      currentStageOrder: 1,
      stages: ladder().stages.map((s) =>
        s.stageOrder === 1
          ? { ...s, status: 'pending', decidedBy: null, decidedAt: null }
          : s.stageOrder === 2
            ? { ...s, status: 'waiting' }
            : s
      ),
    });
    expect(
      classifyGradeChangeActState(atStepOne, 'u-relief', new Set(['sec-1']))
        .kind
    ).toBe('can_act');
    expect(classifyGradeChangeActState(atStepOne, 'u-relief', NONE).kind).toBe(
      'not_yours'
    );
  });

  it('tells a later step’s person it is not their turn yet', () => {
    expect(classifyGradeChangeActState(ladder(), 'u-principal', NONE)).toEqual({
      kind: 'not_yet',
      stageOrder: 2,
      stageCount: 3,
      stageLabel: 'Head of department',
    });
  });

  it('tells an earlier step’s person they have already decided', () => {
    expect(
      classifyGradeChangeActState(ladder(), 'u-adviser', new Set(['sec-1']))
        .kind
    ).toBe('already_decided');
  });

  it('tells anybody else it is not theirs', () => {
    expect(classifyGradeChangeActState(ladder(), 'u-stranger', NONE).kind).toBe(
      'not_yours'
    );
  });

  it('never offers Confirm to the teacher who filed it, even on a step they sit on', () => {
    // The filer advises the class, and the request is at the form adviser
    // step — exactly who that step would admit.
    const atStepOne = ladder({
      currentStageOrder: 1,
      filedBy: 'u-adviser',
      stages: ladder().stages.map((s) =>
        s.stageOrder === 1
          ? { ...s, status: 'pending', decidedBy: null, decidedAt: null }
          : s.stageOrder === 2
            ? { ...s, status: 'waiting' }
            : s
      ),
    });
    expect(
      classifyGradeChangeActState(atStepOne, 'u-adviser', new Set(['sec-1']))
    ).toEqual({
      kind: 'own_request',
      stageOrder: 1,
      stageCount: 3,
      stageLabel: 'Form class adviser',
    });
    // Somebody else advising the same class still can.
    expect(
      classifyGradeChangeActState(atStepOne, 'u-relief', new Set(['sec-1']))
        .kind
    ).toBe('can_act');
  });

  it('offers nothing on a closed request, whoever holds the link', () => {
    expect(
      classifyGradeChangeActState(ladder({ status: 'rejected' }), 'u-hod', NONE)
    ).toEqual({ kind: 'closed', requestStatus: 'rejected' });
    expect(classifyGradeChangeActState(null, 'u-hod', NONE)).toEqual({
      kind: 'not_found',
    });
  });

  // ── A step that needs everyone (migration 145) ─────────────────────────
  function allStepApprovedBy(...userIds: string[]): RequestLadder {
    return ladder({
      stages: ladder().stages.map((s) =>
        s.stageOrder === 2
          ? {
              ...s,
              approvalRule: 'all' as const,
              decisions: userIds.map((userId) => ({
                userId,
                email: `${userId}@hfse.test`,
                decision: 'approve' as const,
                decidedAt: '2026-09-11T01:00:00.000Z',
                note: null,
              })),
            }
          : s
      ),
    });
  }

  it('refuses somebody who already approved a step that needs everyone, with the engine’s own sentence', () => {
    expect(
      classifyGradeChangeActState(allStepApprovedBy('u-hod'), 'u-hod', NONE)
    ).toEqual({
      kind: 'already_approved',
      stageOrder: 2,
      stageCount: 3,
      stageLabel: 'Head of department',
      message: "You've already approved this step. It's waiting on the others.",
    });
  });

  it('still offers Confirm to the one on that step who has not approved yet', () => {
    expect(
      classifyGradeChangeActState(allStepApprovedBy('u-hod'), 'u-deputy', NONE)
        .kind
    ).toBe('can_act');
  });
});
