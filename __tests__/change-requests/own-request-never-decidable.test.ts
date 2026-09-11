/**
 * Nobody approves their own grade change request — the screens and the emails.
 *
 * The filing route keeps the filer off every NAMED step, and the decide
 * pipeline refuses them outright. What is pinned here is that nothing OFFERS
 * them the decision in between:
 *
 *   1. `canDecideCurrentStep` — the queue's Approve buttons, the activity
 *      panel's "waiting for you" — says no to the filer, including on a form
 *      adviser step for a class they advise.
 *   2. The step email is not sent to the filer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { RequestLadder } from '@/lib/approvals/inbox';

let adviserPool: string[] = [];
vi.mock('@/lib/approvals/resolve', () => ({
  resolveAdviserPools: vi.fn(
    async (_s: unknown, sectionIds: string[]) =>
      new Map(sectionIds.map((id) => [id, adviserPool]))
  ),
  loadAdvisedSectionIds: vi.fn(async () => []),
}));
vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({ student_label: null, sheet_label: null })),
}));
vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyStepTurn: vi.fn(async () => ({ sent: 1, failed: 0 })),
}));

import {
  canDecideCurrentStep,
  toStagedGradeChangeView,
} from '@/lib/change-requests/staged-scope';
import { loadGradeChangeStepRecipients } from '@/lib/change-requests/approval-notify';

function ladder(over: Partial<RequestLadder> = {}): RequestLadder {
  return {
    requestId: 'apr-1',
    flow: 'markbook.grade_change',
    subjectType: 'grade_change_request',
    subjectId: 'gcr-1',
    status: 'pending',
    currentStageOrder: 1,
    filedBy: 'u-adviser',
    filedByEmail: 'adviser@hfse.test',
    filedAt: '2026-09-10T00:00:00.000Z',
    decidedAt: null,
    stages: [
      {
        stageOrder: 1,
        label: 'Form class adviser',
        resolver: 'form_adviser',
        status: 'pending',
        sectionId: 'sec-1',
        approverPool: [],
        approvalRule: 'any',
        decisions: [],
        decidedBy: null,
        decidedByEmail: null,
        decidedAt: null,
        decisionNote: null,
      },
      {
        stageOrder: 2,
        label: 'Grade change approvers',
        resolver: 'named',
        status: 'waiting',
        sectionId: null,
        approverPool: ['u-chandana'],
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

const ADVISES_SEC_1 = new Set(['sec-1']);

describe('canDecideCurrentStep — the filer', () => {
  it('is not offered a form adviser step for the class they advise', () => {
    expect(canDecideCurrentStep(ladder(), 'u-adviser', ADVISES_SEC_1)).toBe(
      false
    );
  });

  it('is not offered a named step they somehow sit in', () => {
    const atStepTwo = ladder({
      currentStageOrder: 2,
      filedBy: 'u-chandana',
      stages: ladder().stages.map((s) =>
        s.stageOrder === 1
          ? { ...s, status: 'approved' }
          : { ...s, status: 'pending' }
      ),
    });
    expect(canDecideCurrentStep(atStepTwo, 'u-chandana', new Set())).toBe(
      false
    );
  });

  it('leaves everyone else on the step as they were', () => {
    // A relief teacher covering the same class this week.
    expect(canDecideCurrentStep(ladder(), 'u-relief', ADVISES_SEC_1)).toBe(
      true
    );
    // And a ladder whose filer is unknown.
    expect(
      canDecideCurrentStep(
        ladder({ filedBy: null }),
        'u-adviser',
        ADVISES_SEC_1
      )
    ).toBe(true);
  });

  it('reaches the table row the queue renders', () => {
    const view = toStagedGradeChangeView(ladder(), {
      userId: 'u-adviser',
      advisedSectionIds: ADVISES_SEC_1,
      nameById: new Map(),
    });
    expect(view?.canDecide).toBe(false);
  });
});

describe('canDecideCurrentStep — somebody who already decided the live step', () => {
  // Migration 145: a step that needs everyone stays pending after one yes.
  const allStep = (decidedBy: string[]) =>
    ladder({
      currentStageOrder: 2,
      filedBy: 'u-teacher',
      stages: ladder().stages.map((s) =>
        s.stageOrder === 1
          ? { ...s, status: 'approved' as const }
          : {
              ...s,
              status: 'pending' as const,
              approverPool: ['u-chandana', 'u-gary'],
              approvalRule: 'all' as const,
              decisions: decidedBy.map((userId) => ({
                userId,
                email: null,
                decision: 'approve' as const,
                decidedAt: '2026-09-11T01:00:00.000Z',
                note: null,
              })),
            }
      ),
    });

  it('is not offered the step again', () => {
    expect(
      canDecideCurrentStep(allStep(['u-chandana']), 'u-chandana', new Set())
    ).toBe(false);
  });

  it('still offers it to the person on the step who has not decided', () => {
    expect(
      canDecideCurrentStep(allStep(['u-chandana']), 'u-gary', new Set())
    ).toBe(true);
  });
});

// ── The step email ──────────────────────────────────────────────────────────

function notifyService(filedBy: string | null): SupabaseClient {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve(result);
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return c;
  };
  return {
    from(table: string) {
      if (table === 'approval_requests') {
        return chain({ data: { id: 'apr-1', filed_by: filedBy }, error: null });
      }
      if (table === 'approval_request_stages') {
        return chain({
          data: [
            {
              stage_order: 1,
              label: 'Form class adviser',
              resolver: 'form_adviser',
              approver_pool: [],
              section_id: 'sec-1',
            },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, email: `${id}@hfse.test` } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe('loadGradeChangeStepRecipients — the filer', () => {
  beforeEach(() => {
    // The filer and a co-adviser both advise the class.
    adviserPool = ['u-adviser', 'u-co-adviser'];
  });

  it('is not emailed about their own request', async () => {
    const step = await loadGradeChangeStepRecipients(
      notifyService('u-adviser'),
      {
        flow: 'markbook.grade_change',
        gradeChangeRequestId: 'gcr-1',
        stageOrder: 1,
      }
    );
    expect(step?.recipients).toEqual([
      { id: 'u-co-adviser', email: 'u-co-adviser@hfse.test' },
    ]);
  });

  it('leaves the list whole when the filer is not on the step', async () => {
    const step = await loadGradeChangeStepRecipients(notifyService('u-other'), {
      flow: 'markbook.grade_change',
      gradeChangeRequestId: 'gcr-1',
      stageOrder: 1,
    });
    expect(step?.recipients.map((r) => r.id)).toEqual([
      'u-adviser',
      'u-co-adviser',
    ]);
  });
});
