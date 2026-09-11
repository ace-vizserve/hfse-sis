/**
 * What a decided approval step does to a grade change request —
 * `lib/change-requests/approval-handler.ts`.
 *
 * Pinned:
 *   1. The teacher's copy moves only when the ladder is finished, and only
 *      from 'pending'.
 *   2. Every yes is audited as `grade_change_approved`, with `final` telling a
 *      step apart from the whole request.
 *   3. The right people are emailed: the next step on 'advanced', the teacher
 *      (and appliers) on 'completed', the teacher on 'rejected'.
 *   4. A projection that does not land says the decision was recorded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const logAction = vi.fn(async (_args: Record<string, unknown>) => {});
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: Record<string, unknown>) => logAction(args),
}));

const invalidateDrillTags = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...args: unknown[]) => invalidateDrillTags(...args),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(async () => 'AY2026'),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({
    student_label: 'Kumar, Ravi (S001)',
    sheet_label: 'P5 Diamond · Maths · Term 1',
  })),
  fetchRegistrarEmails: vi.fn(async () => ['registrar@hfse.test']),
}));

const notifyRequestApproved = vi.fn(async (..._a: unknown[]) => ({
  sent: 1,
  failed: 0,
}));
const notifyRequestRejected = vi.fn(async (..._a: unknown[]) => ({
  sent: 1,
  failed: 0,
}));
vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyRequestApproved: (...a: unknown[]) => notifyRequestApproved(...a),
  notifyRequestRejected: (...a: unknown[]) => notifyRequestRejected(...a),
  notifyStepTurn: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

const STEP = {
  flow: 'markbook.grade_change' as const,
  stageOrder: 2,
  stageCount: 3,
  stageLabel: 'Head of department',
  recipients: [{ id: 'u-hod', email: 'hod@hfse.test' }],
};
const loadGradeChangeStepRecipients = vi.fn(async (..._a: unknown[]) => STEP);
const sendGradeChangeStepEmails = vi.fn(async (..._a: unknown[]) => 'sent');
vi.mock('@/lib/change-requests/approval-notify', () => ({
  loadGradeChangeStepRecipients: (...a: unknown[]) =>
    loadGradeChangeStepRecipients(...a),
  sendGradeChangeStepEmails: (...a: unknown[]) =>
    sendGradeChangeStepEmails(...a),
}));

import {
  GRADE_CHANGE_PROJECTION_FAILED,
  gradeChangeApprovalHandler,
} from '@/lib/change-requests/approval-handler';
import {
  SUBJECT_HANDLERS,
  type SubjectHandlerContext,
} from '@/lib/approvals/decide';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';

const ROW = {
  id: 'gcr-1',
  grading_sheet_id: 'sheet-1',
  grade_entry_id: 'entry-1',
  field_changed: 'qa_score',
  slot_index: null,
  current_value: '20',
  proposed_value: '24',
  reason_category: 'data_entry_error',
  justification: '<p>Mis-keyed from the paper script.</p>',
  requested_by_email: 'teacher@hfse.test',
  requested_at: '2026-09-10T00:00:00.000Z',
  reviewed_by_email: 'board@hfse.test',
  decision_note: null as string | null,
};

let updates: Array<{
  patch: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
}>;
let updateResult: { data: unknown; error: { message: string } | null };
/** What a plain read of the row finds. ROW carries no status unless a test says so. */
let readRow: Record<string, unknown>;

/** The step that closed the ladder, as `buildGradeChangeProjectionPatch` reads it. */
let closedStep: Record<string, unknown> | null;

function buildService(): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'approval_request_stages') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: closedStep, error: null }),
        };
        return chain;
      }
      if (table !== 'grade_change_requests') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({ data: readRow, error: null }),
          };
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          const entry = { patch, eqs: [] as Array<[string, unknown]> };
          updates.push(entry);
          const chain = {
            eq: (col: string, val: unknown) => {
              entry.eqs.push([col, val]);
              return chain;
            },
            select: () => chain,
            maybeSingle: async () => updateResult,
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
}

function ctx(over: Partial<SubjectHandlerContext>): SubjectHandlerContext {
  return {
    service: buildService(),
    actor: { id: 'u-board', email: 'board@hfse.test', role: 'school_admin' },
    requestId: 'apr-1',
    flow: 'markbook.grade_change',
    subjectId: 'gcr-1',
    action: 'approve',
    outcome: 'completed',
    decidedStageOrder: 3,
    nextStageOrder: null,
    note: null,
    via: 'in_app',
    ...over,
  };
}

async function flush() {
  // after() is mocked to fire-and-forget; let its promise chain settle.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  updateResult = { data: ROW, error: null };
  readRow = ROW;
  closedStep = {
    stage_order: 3,
    status: 'approved',
    decided_by: 'u-norma',
    decided_by_email: 'norma@hfse.test',
    decided_at: '2026-09-11T01:00:00.000Z',
    decision_note: null,
  };
});

describe('registration', () => {
  it('is the handler the pipeline looks up for a grade change', () => {
    expect(SUBJECT_HANDLERS[GRADE_CHANGE_SUBJECT_TYPE]).toBe(
      gradeChangeApprovalHandler
    );
  });
});

describe('the last step approves it', () => {
  it('marks the request approved, audits it as final, and emails the teacher', async () => {
    const result = await gradeChangeApprovalHandler(ctx({}));

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      status: 'approved',
      reviewed_by: 'u-board',
      reviewed_by_email: 'board@hfse.test',
    });
    expect(updates[0].patch.approved_at).toEqual(expect.any(String));
    expect(updates[0].patch.reviewed_at).toEqual(expect.any(String));
    expect(updates[0].eqs).toEqual([
      ['id', 'gcr-1'],
      ['status', 'pending'],
    ]);

    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_approved',
      entityType: 'grade_change_request',
      entityId: 'gcr-1',
      context: {
        request_id: 'apr-1',
        flow: 'markbook.grade_change',
        final: true,
        stage_order: 3,
        next_stage_order: null,
        via: 'in_app',
      },
    });
    expect(invalidateDrillTags).toHaveBeenCalledWith('markbook', 'AY2026');

    await flush();
    expect(notifyRequestApproved).toHaveBeenCalledTimes(1);
    expect(notifyRequestApproved.mock.calls[0][1]).toBe('teacher@hfse.test');
    expect(notifyRequestApproved.mock.calls[0][2]).toEqual([
      'registrar@hfse.test',
    ]);
    expect(sendGradeChangeStepEmails).not.toHaveBeenCalled();
  });
});

describe('a step turns it down', () => {
  it('marks the request rejected with the reason, and emails the teacher', async () => {
    const result = await gradeChangeApprovalHandler(
      ctx({
        action: 'reject',
        outcome: 'rejected',
        decidedStageOrder: 1,
        note: '<p>The paper shows 20.</p>',
      })
    );

    expect(result.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({
      status: 'rejected',
      decision_note: '<p>The paper shows 20.</p>',
      reviewed_by: 'u-board',
    });
    expect(updates[0].patch).not.toHaveProperty('approved_at');
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_rejected',
      context: { final: false, stage_order: 1 },
    });

    await flush();
    expect(notifyRequestRejected).toHaveBeenCalledTimes(1);
    expect(notifyRequestRejected.mock.calls[0][1]).toBe('teacher@hfse.test');
    expect(notifyRequestApproved).not.toHaveBeenCalled();
  });
});

describe('an intermediate step approves it', () => {
  it('leaves the request pending, audits a step, and emails the next step', async () => {
    const result = await gradeChangeApprovalHandler(
      ctx({ outcome: 'advanced', decidedStageOrder: 1, nextStageOrder: 2 })
    );

    expect(result).toEqual({
      ok: true,
      message: 'Approved. It has moved on to the next step.',
    });
    expect(updates).toEqual([]);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_approved',
      context: { final: false, stage_order: 1, next_stage_order: 2 },
    });

    await flush();
    expect(loadGradeChangeStepRecipients).toHaveBeenCalledWith(
      expect.anything(),
      {
        flow: 'markbook.grade_change',
        gradeChangeRequestId: 'gcr-1',
        stageOrder: 2,
      }
    );
    expect(sendGradeChangeStepEmails).toHaveBeenCalledWith(expect.anything(), {
      gradeChangeRequestId: 'gcr-1',
      step: STEP,
    });
    expect(notifyRequestApproved).not.toHaveBeenCalled();
    expect(notifyRequestRejected).not.toHaveBeenCalled();
  });
});

describe('one yes on a step that needs everyone (migration 145)', () => {
  it('moves nothing, emails nobody, and audits a step that is still waiting', async () => {
    const result = await gradeChangeApprovalHandler(
      ctx({ outcome: 'recorded', decidedStageOrder: 2, nextStageOrder: null })
    );

    expect(result).toEqual({
      ok: true,
      message: 'Approved. This step is still waiting on the others.',
    });
    expect(updates).toEqual([]);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_approved',
      entityId: 'gcr-1',
      context: {
        outcome: 'recorded',
        final: false,
        stage_order: 2,
        next_stage_order: null,
      },
    });

    await flush();
    expect(loadGradeChangeStepRecipients).not.toHaveBeenCalled();
    expect(sendGradeChangeStepEmails).not.toHaveBeenCalled();
    expect(notifyRequestApproved).not.toHaveBeenCalled();
    expect(notifyRequestRejected).not.toHaveBeenCalled();
  });
});

// Migration 146 review. An admin took the last hold-out off a step, or relaxed
// it to "any one of them", and the ladder finished without anybody clicking.
// The admin is the actor; they are NOT the approver.
describe('a step finished by an approver change (via repoint)', () => {
  const ADMIN = {
    id: 'u-admin',
    email: 'admin@hfse.test',
    role: 'superadmin' as const,
  };
  const repoint = (over: Partial<SubjectHandlerContext> = {}) =>
    ctx({
      actor: ADMIN,
      via: 'repoint',
      closedStepApprover: { id: 'u-norma', email: 'norma@hfse.test' },
      ...over,
    });

  it('records the real last approver as the reviewer, not the admin', async () => {
    updateResult = {
      data: { ...ROW, reviewed_by_email: 'norma@hfse.test' },
      error: null,
    };
    const result = await gradeChangeApprovalHandler(repoint());

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({
      status: 'approved',
      reviewed_by: 'u-norma',
      reviewed_by_email: 'norma@hfse.test',
      reviewed_at: '2026-09-11T01:00:00.000Z',
      approved_at: '2026-09-11T01:00:00.000Z',
    });
    expect(JSON.stringify(updates[0].patch)).not.toContain('admin');
    expect(updates[0].eqs).toContainEqual(['status', 'pending']);
  });

  it('audits as the admin, says the step edit finished it, and names the last approver', async () => {
    updateResult = {
      data: { ...ROW, reviewed_by_email: 'norma@hfse.test' },
      error: null,
    };
    await gradeChangeApprovalHandler(repoint());
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_approved',
      actor: { id: 'u-admin', email: 'admin@hfse.test' },
      context: {
        final: true,
        via: 'repoint',
        closed_by_step_edit: true,
        final_approver_email: 'norma@hfse.test',
      },
    });
  });

  it('emails the teacher that the real approver approved it', async () => {
    updateResult = {
      data: { ...ROW, reviewed_by_email: 'norma@hfse.test' },
      error: null,
    };
    await gradeChangeApprovalHandler(repoint());
    await flush();
    expect(notifyRequestApproved).toHaveBeenCalledTimes(1);
    const summary = notifyRequestApproved.mock.calls[0][0] as {
      reviewed_by_email: string;
    };
    expect(summary.reviewed_by_email).toBe('norma@hfse.test');
  });

  it('marks an intermediate step the same way, and projects nothing', async () => {
    await gradeChangeApprovalHandler(
      repoint({ outcome: 'advanced', decidedStageOrder: 2, nextStageOrder: 3 })
    );
    expect(updates).toEqual([]);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      actor: { id: 'u-admin' },
      context: {
        final: false,
        closed_by_step_edit: true,
        final_approver_email: 'norma@hfse.test',
      },
    });
  });

  it('writes nothing and says so when the closed step cannot be read', async () => {
    closedStep = null;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handled = await gradeChangeApprovalHandler(repoint());
    expect(handled).toEqual({
      ok: false,
      status: 500,
      body: { error: GRADE_CHANGE_PROJECTION_FAILED, outcome: 'completed' },
    });
    // Never falls back to the admin.
    expect(updates).toEqual([]);
    expect(logAction).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('a click is untouched — no step-edit marks on the audit row', async () => {
    await gradeChangeApprovalHandler(ctx({}));
    const context = logAction.mock.calls[0][0].context as Record<
      string,
      unknown
    >;
    expect(context).not.toHaveProperty('closed_by_step_edit');
    expect(context).not.toHaveProperty('final_approver_email');
  });
});

describe('the teacher’s copy does not move', () => {
  it.each([
    [
      'a database error',
      { data: null, error: { message: 'permission denied' } },
    ],
    ['no pending row', { data: null, error: null }],
  ] as const)(
    '%s says the decision was recorded and audits nothing',
    async (_label, result) => {
      updateResult = result as typeof updateResult;
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

      const handled = await gradeChangeApprovalHandler(ctx({}));

      expect(handled).toEqual({
        ok: false,
        status: 500,
        body: { error: GRADE_CHANGE_PROJECTION_FAILED, outcome: 'completed' },
      });
      expect(GRADE_CHANGE_PROJECTION_FAILED).toMatch(/decision was recorded/i);
      expect(logAction).not.toHaveBeenCalled();
      await flush();
      expect(notifyRequestApproved).not.toHaveBeenCalled();
      errors.mockRestore();
    }
  );

  it('a row that already moved to a DIFFERENT status is still a failure', async () => {
    updateResult = { data: null, error: null };
    readRow = { ...ROW, status: 'cancelled' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handled = await gradeChangeApprovalHandler(ctx({}));

    expect(handled).toMatchObject({ ok: false, status: 500 });
    expect(logAction).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// The teacher's Cancel can meet the closed ladder in the moment between
// `approval_advance` committing and this handler's write, and writes the same
// outcome onto the row itself (lib/change-requests/decide.ts). That is this
// decision already projected — not drift — so the audit row and the emails
// must still go out from here, once.
describe('the teacher’s copy was already brought up to date', () => {
  it.each([
    ['approval', { outcome: 'completed' as const }, 'approved'],
    [
      'turn-down',
      { action: 'reject' as const, outcome: 'rejected' as const, note: 'No.' },
      'rejected',
    ],
  ])(
    'a %s already on the row is treated as done',
    async (_label, over, status) => {
      updateResult = { data: null, error: null };
      readRow = { ...ROW, status };

      const handled = await gradeChangeApprovalHandler(ctx(over));

      expect(handled.ok).toBe(true);
      expect(logAction).toHaveBeenCalledTimes(1);
      await flush();
      expect(
        notifyRequestApproved.mock.calls.length +
          notifyRequestRejected.mock.calls.length
      ).toBe(1);
    }
  );
});
