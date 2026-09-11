/**
 * The shared decide pipeline — `lib/approvals/decide.ts`.
 *
 * The ordered approval engine (KD #196) was built for parent declarations and
 * its decide route carried that consumer's projection, register write and
 * audit inline. Grade change requests are about to become its second consumer,
 * so the pipeline was split: the engine half is generic, and what a decision
 * DOES to its subject is a handler looked up by `subject_type`.
 *
 * THREE THINGS ARE PINNED HERE:
 *
 *   1. THE REFUSALS MAP TO THE SAME HTTP CODES AS BEFORE. Being the second
 *      person to click is the normal case on a step with several approvers, and
 *      a 500 for it would read as the app breaking.
 *
 *   2. THE DECLARATION HANDLER RUNS ON EVERY DECIDED OUTCOME, and still does
 *      what the route did inline: project only on a finished ladder, mark the
 *      register only on the last approval, and write the audit row.
 *
 *   3. AN UNREGISTERED SUBJECT IS REFUSED BEFORE ANYTHING IS DECIDED. The
 *      handler is looked up ahead of `approval_advance`, so a step is never
 *      committed with nothing able to act on it. A handler that fails AFTER
 *      the commit still says the decision landed — "please try again" would
 *      send the approver back to a step that now refuses them.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Mocks ──────────────────────────────────────────────────────────────────

type AuditCall = {
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string | null; email: string | null; role: string | null };
  context: Record<string, unknown>;
};

const logAction = vi.fn<(args: AuditCall) => Promise<void>>(() =>
  Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: AuditCall) => logAction(args),
  logActions: vi.fn(() => Promise.resolve()),
}));

const invalidateDrillTags = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...args: unknown[]) => invalidateDrillTags(...args),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));

type RegisterResult =
  | { ok: true; written: number; skipped: number }
  | { ok: false; error: string };
let registerResult: RegisterResult;
const writeRegisterForDeclaration = vi.fn(() =>
  Promise.resolve(registerResult)
);
vi.mock('@/lib/declarations/register', () => ({
  writeRegisterForDeclaration: (...args: unknown[]) =>
    (writeRegisterForDeclaration as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-adviser', email: 'adviser@hfse.test' },
      role: 'teacher',
    })
  ),
}));

// ── Service stub ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const REQUEST_ID = 'req-1';
const DECLARATION_ID = 'decl-1';

let requestRow: Row | null;
let closedStepRow: Row | null = {
  decided_by: 'u-last-approver',
  decided_by_email: 'last.approver@hfse.test',
};
let rpcResult: { data: unknown; error: { message: string } | null };
let projectionError: { message: string } | null;
let declarationUpdates: Row[];
let rpcCalls: Array<{ name: string; args: Row }>;

function reads(result: unknown) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  Object.assign(obj, {
    select: self,
    eq: self,
    maybeSingle: () => Promise.resolve(result),
  });
  return obj;
}

function buildService(): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'approval_requests') {
        return reads({ data: requestRow, error: null });
      }
      if (table === 'sections') {
        return reads({ data: { name: 'P4 Diligence' }, error: null });
      }
      // The closed step, as `runSubjectFollowUp` reads it (migration 146).
      if (table === 'approval_request_stages') {
        return reads({ data: closedStepRow, error: null });
      }
      if (table === 'student_declarations') {
        const obj = reads({
          data: {
            section_id: 'sec-1',
            start_date: '2026-09-02',
            end_date: '2026-09-03',
            declaration_type: 'absence',
            with_medical: true,
            parent_note: '<p>Fever</p>',
          },
          error: null,
        });
        obj.update = (patch: Row) => {
          declarationUpdates.push(patch);
          return { eq: () => Promise.resolve({ error: projectionError }) };
        };
        return obj;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  } as unknown as SupabaseClient;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

function rpcReturns(outcome: string, extra: Row = {}) {
  rpcResult = {
    data: [
      {
        outcome,
        request_status: outcome === 'completed' ? 'approved' : 'pending',
        decided_stage_order: 1,
        next_stage_order: outcome === 'advanced' ? 2 : null,
        ...extra,
      },
    ],
    error: null,
  };
}

const ACTOR = {
  id: 'u-adviser',
  email: 'adviser@hfse.test',
  role: 'teacher' as const,
};

async function decide(
  over: Partial<{
    action: 'approve' | 'reject';
    note: string | null;
    via: 'in_app' | 'email_token';
  }> = {}
) {
  const { decideApproval } = await import('@/lib/approvals/decide');
  return decideApproval({
    service: buildService(),
    actor: ACTOR,
    requestId: REQUEST_ID,
    action: over.action ?? 'approve',
    note: over.note ?? null,
    via: over.via ?? 'in_app',
  });
}

/** Spy on the REAL declaration handler, so its effects still happen. */
async function spyOnDeclarationHandler() {
  const { SUBJECT_HANDLERS } = await import('@/lib/approvals/decide');
  const { DECLARATION_SUBJECT_TYPE } =
    await import('@/lib/declarations/approval');
  return vi.spyOn(SUBJECT_HANDLERS, DECLARATION_SUBJECT_TYPE);
}

let spies: Array<{ mockRestore: () => void }> = [];

// Load the module graph once, up front. The first dynamic import pulls in the
// route, the schemas and the attendance helpers, and under a full parallel run
// that alone can outlast the first test's 5-second budget.
beforeAll(async () => {
  await import('@/lib/approvals/decide');
  await import('@/app/api/approvals/[requestId]/decide/route');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  requestRow = {
    id: REQUEST_ID,
    flow: 'attendance.student_declaration',
    subject_type: 'student_declaration',
    subject_id: DECLARATION_ID,
  };
  rpcReturns('completed');
  projectionError = null;
  declarationUpdates = [];
  rpcCalls = [];
  registerResult = { ok: true, written: 2, skipped: 0 };
});

afterEach(() => {
  for (const s of spies) s.mockRestore();
  spies = [];
});

// ── 1. Refusals ────────────────────────────────────────────────────────────

describe('an outcome that decided nothing', () => {
  it.each([
    ['not_authorised', 403],
    ['request_not_found', 404],
    ['stage_already_decided', 409],
    ['request_closed', 409],
    // Migration 145 — a second yes on a step that needs everyone.
    ['already_approved', 409],
  ] as const)('%s answers %i with its own sentence', async (outcome, code) => {
    const { APPROVAL_OUTCOME_MESSAGES } =
      await import('@/lib/approvals/state-machine');
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    rpcReturns(outcome);

    const result = await decide();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(code);
    expect(result.body).toEqual({
      error: APPROVAL_OUTCOME_MESSAGES[outcome],
      outcome,
    });
    // Nothing was decided, so nothing may be projected or audited.
    expect(spy).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
    expect(declarationUpdates).toEqual([]);
  });

  it('answers 404 without deciding when the request row is gone', async () => {
    requestRow = null;
    const result = await decide();
    expect(result.status).toBe(404);
    expect(rpcCalls).toEqual([]);
  });

  it('answers 500 "try again" when the engine itself failed', async () => {
    // The RPC erroring means nothing was committed, so — unlike every failure
    // AFTER it — retrying is the right advice.
    rpcResult = { data: null, error: { message: 'connection reset' } };
    const result = await decide();
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/try again/i);
  });
});

// ── 2. The declaration handler ─────────────────────────────────────────────

describe('the declaration handler', () => {
  it('runs on a finished ladder: projects, marks the register, audits', async () => {
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    rpcReturns('completed');

    const result = await decide({ note: 'Seen the certificate' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      requestId: REQUEST_ID,
      flow: 'attendance.student_declaration',
      subjectId: DECLARATION_ID,
      action: 'approve',
      outcome: 'completed',
      decidedStageOrder: 1,
      nextStageOrder: null,
      note: 'Seen the certificate',
      via: 'in_app',
    });

    expect(declarationUpdates).toHaveLength(1);
    expect(declarationUpdates[0]).toMatchObject({ status: 'approved' });
    expect(writeRegisterForDeclaration).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        ok: true,
        outcome: 'completed',
        message: 'Approved. 2 days marked as excused on the attendance sheet.',
        requestStatus: 'approved',
        nextStageOrder: null,
        registerDaysWritten: 2,
        registerWriteFailed: false,
      },
    });

    expect(logAction).toHaveBeenCalledTimes(1);
    const audit = logAction.mock.calls[0][0];
    expect(audit.action).toBe('declaration.approve');
    expect(audit.entityId).toBe(DECLARATION_ID);
    expect(audit.context).toMatchObject({
      request_id: REQUEST_ID,
      outcome: 'completed',
      section_name: 'P4 Diligence',
      note_present: true,
      parent_note_present: true,
      register_days_written: 2,
      register_write_failed: false,
      via: 'in_app',
    });
    // Presence only — neither note's words reach the log.
    const serialised = JSON.stringify(audit.context);
    expect(serialised).not.toContain('Seen the certificate');
    expect(serialised).not.toContain('Fever');

    expect(invalidateDrillTags).toHaveBeenCalledWith('attendance', 'AY2026');
    expect(invalidateDrillTags).toHaveBeenCalledWith('records', 'AY2026');
  });

  it('runs on a rejection: projects, but never marks the register', async () => {
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    rpcReturns('rejected');

    const result = await decide({
      action: 'reject',
      note: 'No certificate attached',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ outcome: 'rejected' });
    expect(declarationUpdates).toEqual([
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(writeRegisterForDeclaration).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(logAction.mock.calls[0][0].action).toBe('declaration.reject');
  });

  it('runs on an intermediate step, and leaves the parent status alone', async () => {
    // 'advanced' means one person said yes and the next has not — to the
    // parent that is still "with the school", because it is.
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    rpcReturns('advanced');

    const result = await decide();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      outcome: 'advanced',
      nextStageOrder: 2,
    });
    expect(declarationUpdates).toEqual([]);
    expect(writeRegisterForDeclaration).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      outcome: 'advanced',
      nextStageOrder: 2,
      registerDaysWritten: null,
    });
    expect(logAction).toHaveBeenCalledTimes(1);
  });

  it('on a yes that leaves a step waiting on others: audits it, and moves and marks nothing', async () => {
    // Migration 145. One person on a step that needs everyone approved; the
    // step has not moved, so the parent's status and the register stay put.
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    rpcReturns('recorded');

    const result = await decide({ note: 'Fine by me' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      outcome: 'recorded',
      action: 'approve',
    });
    expect(declarationUpdates).toEqual([]);
    expect(writeRegisterForDeclaration).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      outcome: 'recorded',
      message: 'Approved. This step is still waiting on the others.',
    });
    expect(logAction).toHaveBeenCalledTimes(1);
    const audit = logAction.mock.calls[0][0];
    expect(audit.action).toBe('declaration.approve');
    expect(audit.context).toMatchObject({
      request_id: REQUEST_ID,
      outcome: 'recorded',
      register_days_written: null,
      note_present: true,
    });
  });

  it('records which door the decision came through', async () => {
    rpcReturns('advanced');
    await decide({ via: 'email_token' });
    expect(logAction.mock.calls[0][0].context.via).toBe('email_token');
  });

  it('a failed projection says the decision landed, and skips the audit as before', async () => {
    projectionError = { message: 'permission denied' };
    rpcReturns('completed');

    const result = await decide();

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error:
        'The decision was recorded, but the parent may not see it yet. Tell an administrator.',
      outcome: 'completed',
    });
    expect(writeRegisterForDeclaration).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('a failed register write still reports the approval as a success', async () => {
    registerResult = { ok: false, error: 'calendar unreachable' };
    rpcReturns('completed');

    const result = await decide();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      message:
        'Approved. The attendance sheet could not be updated yet — tell an administrator.',
      registerWriteFailed: true,
    });
  });
});

// ── 3. A subject nobody registered ─────────────────────────────────────────

describe('a subject type with no handler', () => {
  it('is refused before anything is decided', async () => {
    const { SUBJECT_NOT_DECIDABLE } = await import('@/lib/approvals/decide');
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    requestRow = { ...(requestRow as Row), subject_type: 'nothing_registered' };
    rpcReturns('completed');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(errors);

    const result = await decide();

    // ⚠ The engine never ran. A step decided with nothing able to act on the
    // decision is the failure this ordering exists to prevent.
    expect(rpcCalls).toEqual([]);
    expect(result).toEqual({
      ok: false,
      status: 500,
      body: { error: SUBJECT_NOT_DECIDABLE },
    });
    // Nothing was recorded, so it must not claim otherwise.
    expect(String(result.body.error)).not.toMatch(/decision was recorded/i);
    expect(String(result.body.error)).toMatch(/nothing was recorded/i);

    expect(spy).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });

  it('does not resolve a prototype key as a handler', async () => {
    requestRow = { ...(requestRow as Row), subject_type: 'toString' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(errors);

    const result = await decide();
    expect(result.status).toBe(500);
    expect(rpcCalls).toEqual([]);
    expect(String(result.body.error)).toMatch(/nothing was recorded/i);
  });

  it('a handler that throws after the decision still says it was recorded', async () => {
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    spy.mockRejectedValueOnce(new Error('boom'));
    rpcReturns('completed');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(errors);

    const result = await decide();

    expect(rpcCalls).toHaveLength(1);
    expect(result.status).toBe(500);
    expect(result.body.outcome).toBe('completed');
    expect(String(result.body.error)).toMatch(/decision was recorded/i);
    // ⚠ Not "try again": the step is decided, and a retry would be refused.
    expect(String(result.body.error)).not.toMatch(/try again/i);
  });
});

// ── 4. Nobody decides their own grade change ───────────────────────────────

describe('a grade change the actor filed themselves', () => {
  async function spyOnGradeChangeHandler() {
    const { SUBJECT_HANDLERS } = await import('@/lib/approvals/decide');
    const { GRADE_CHANGE_SUBJECT_TYPE } =
      await import('@/lib/change-requests/approval-route');
    const spy = vi.spyOn(SUBJECT_HANDLERS, GRADE_CHANGE_SUBJECT_TYPE);
    spy.mockResolvedValue({ ok: true, message: 'Approved.' });
    return spy;
  }

  beforeEach(() => {
    requestRow = {
      id: REQUEST_ID,
      flow: 'markbook.grade_change',
      subject_type: 'grade_change_request',
      subject_id: 'gcr-1',
      filed_by: ACTOR.id,
    };
    rpcReturns('advanced');
  });

  it.each(['in_app', 'email_token'] as const)(
    'is refused before anything is decided (%s)',
    async (via) => {
      const spy = await spyOnGradeChangeHandler();
      spies.push(spy);

      const result = await decide({ via });

      expect(result).toEqual({
        ok: false,
        status: 403,
        body: {
          error: 'You filed this request, so someone else has to approve it.',
          outcome: 'not_authorised',
        },
      });
      // The step stays open for somebody else.
      expect(rpcCalls).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
      expect(logAction).not.toHaveBeenCalled();
    }
  );

  it('refuses a turn-down of their own request too', async () => {
    const result = await decide({ action: 'reject', note: 'Changed my mind' });
    expect(result.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it('lets somebody else on the step decide it', async () => {
    requestRow = { ...(requestRow as Row), filed_by: 'u-someone-else' };
    const spy = await spyOnGradeChangeHandler();
    spies.push(spy);

    const result = await decide();

    expect(rpcCalls).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
  });

  it('does not refuse on an unknown filer', async () => {
    requestRow = { ...(requestRow as Row), filed_by: null };
    const spy = await spyOnGradeChangeHandler();
    spies.push(spy);
    await decide();
    expect(rpcCalls).toHaveLength(1);
  });

  it('leaves declarations exactly as they were — no pre-check runs', async () => {
    const { SUBJECT_PRECHECKS } = await import('@/lib/approvals/decide');
    const { DECLARATION_SUBJECT_TYPE } =
      await import('@/lib/declarations/approval');
    expect(
      Object.prototype.hasOwnProperty.call(
        SUBJECT_PRECHECKS,
        DECLARATION_SUBJECT_TYPE
      )
    ).toBe(false);

    // Even a filer id equal to the actor's goes straight to the engine.
    requestRow = {
      id: REQUEST_ID,
      flow: 'attendance.student_declaration',
      subject_type: 'student_declaration',
      subject_id: DECLARATION_ID,
      filed_by: ACTOR.id,
    };
    rpcReturns('completed');
    const result = await decide();
    expect(rpcCalls).toHaveLength(1);
    expect(result.status).toBe(200);
  });
});

// ── 5. A step that moved on without a click (migration 145) ───────────────

describe('runSubjectFollowUp', () => {
  const ADMIN = {
    id: 'u-admin',
    email: 'admin@hfse.test',
    role: 'superadmin' as const,
  };

  it('runs the same handler a click would, as the admin, through the repoint door', async () => {
    const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);

    const handled = await runSubjectFollowUp({
      service: buildService(),
      actor: ADMIN,
      requestId: REQUEST_ID,
      outcome: 'completed',
      decidedStageOrder: 2,
      nextStageOrder: null,
      via: 'repoint',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      actor: ADMIN,
      requestId: REQUEST_ID,
      subjectId: DECLARATION_ID,
      action: 'approve',
      outcome: 'completed',
      decidedStageOrder: 2,
      note: null,
      via: 'repoint',
    });
    expect(handled?.ok).toBe(true);
    // The finished ladder is projected and marked exactly as after a click.
    expect(declarationUpdates).toEqual([
      expect.objectContaining({ status: 'approved' }),
    ]);
    expect(writeRegisterForDeclaration).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0].context.via).toBe('repoint');
  });

  it('hands on who the closed step stands in the name of, and the audit row names them beside the admin', async () => {
    const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);

    await runSubjectFollowUp({
      service: buildService(),
      actor: ADMIN,
      requestId: REQUEST_ID,
      outcome: 'completed',
      decidedStageOrder: 2,
      nextStageOrder: null,
      via: 'repoint',
    });

    expect(spy.mock.calls[0][0].closedStepApprover).toEqual({
      id: 'u-last-approver',
      email: 'last.approver@hfse.test',
    });
    const audit = logAction.mock.calls[0][0];
    // The admin made the change; the approval is the approver's.
    expect(audit.actor).toMatchObject({ id: 'u-admin' });
    expect(audit.context).toMatchObject({
      via: 'repoint',
      closed_by_step_edit: true,
      final_approver_email: 'last.approver@hfse.test',
    });
  });

  it('names nobody rather than the admin when the closed step cannot be read', async () => {
    const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
    const spy = await spyOnDeclarationHandler();
    spies.push(spy);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(errors);
    closedStepRow = null;
    try {
      await runSubjectFollowUp({
        service: buildService(),
        actor: ADMIN,
        requestId: REQUEST_ID,
        outcome: 'advanced',
        decidedStageOrder: 1,
        nextStageOrder: 2,
        via: 'repoint',
      });
    } finally {
      closedStepRow = {
        decided_by: 'u-last-approver',
        decided_by_email: 'last.approver@hfse.test',
      };
    }
    expect(spy.mock.calls[0][0].closedStepApprover).toBeNull();
    expect(logAction.mock.calls[0][0].context).toMatchObject({
      closed_by_step_edit: true,
      final_approver_email: null,
    });
  });

  it('never throws, and runs nothing, when the request is gone', async () => {
    const { runSubjectFollowUp } = await import('@/lib/approvals/decide');
    requestRow = null;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(errors);
    const handled = await runSubjectFollowUp({
      service: buildService(),
      actor: ADMIN,
      requestId: REQUEST_ID,
      outcome: 'advanced',
      decidedStageOrder: 1,
      nextStageOrder: 2,
      via: 'repoint',
    });
    expect(handled).toBeNull();
    expect(logAction).not.toHaveBeenCalled();
  });
});

// ── The route is a thin wrapper ────────────────────────────────────────────

describe('POST /api/approvals/[requestId]/decide', () => {
  async function post(body: unknown) {
    const { POST } =
      await import('@/app/api/approvals/[requestId]/decide/route');
    const res = await POST(
      new Request(`http://test/api/approvals/${REQUEST_ID}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) }
    );
    if (!res) throw new Error('the route returned no response');
    return {
      status: res.status,
      json: (await res.json()) as Record<string, unknown>,
    };
  }

  it('passes the pipeline status and body straight through', async () => {
    rpcReturns('stage_already_decided');
    const { status, json } = await post({ action: 'approve' });
    expect(status).toBe(409);
    expect(json.outcome).toBe('stage_already_decided');
  });

  it('decides as the signed-in person, marked as in-app', async () => {
    rpcReturns('completed');
    const { status, json } = await post({ action: 'approve' });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      name: 'approval_advance',
      args: {
        p_request_id: REQUEST_ID,
        p_actor: 'u-adviser',
        p_actor_email: 'adviser@hfse.test',
        p_action: 'approve',
        p_note: null,
      },
    });
    expect(logAction.mock.calls[0][0].context.via).toBe('in_app');
    expect(logAction.mock.calls[0][0].actor).toMatchObject({ role: 'teacher' });
  });

  it('refuses a body the schema refuses, before anything is decided', async () => {
    const { status } = await post({ action: 'maybe' });
    expect(status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });
});
