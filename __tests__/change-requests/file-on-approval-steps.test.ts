/**
 * Filing a grade change onto the approval steps — POST /api/change-requests
 * (migration 144), and the GET scope that keeps those requests out of every
 * school admin's legacy list.
 *
 * Pinned:
 *   1. The teacher names no approvers; the system picks the route and the
 *      request is opened on it.
 *   2. A route with no steps, or with a named step nobody covers for this
 *      class, is refused BEFORE anything is written, in words.
 *   3. A request whose steps could not be opened is taken back out.
 *   4. GET leaves stepped requests out of the legacy "nobody designated" arm,
 *      and does not scope the apply dialog's sheet lookup at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authRole = 'teacher';
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'u-teacher', email: 'teacher@hfse.test' },
    role: authRole,
  })),
}));

vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: vi.fn(async () => []),
  isSubjectTeacher: vi.fn(() => true),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

const logAction = vi.fn(async (_args: Record<string, unknown>) => {});
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: Record<string, unknown>) => logAction(args),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(async () => 'AY2026'),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({ student_label: null, sheet_label: null })),
  fetchRegistrarEmails: vi.fn(async () => []),
}));

vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyApprovedNotApplied: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

let flow: 'markbook.grade_change' | 'markbook.grade_change_aeb';
vi.mock('@/lib/change-requests/approval-route', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/change-requests/approval-route')
    >();
  return {
    ...actual,
    resolveGradeChangeFlow: vi.fn(async () => flow),
  };
});

vi.mock('@/lib/approvals/level-types', () => ({
  loadLevelTypesBySection: vi.fn(
    async () => new Map([['section-1', 'primary']])
  ),
}));

type Ladder = Array<{
  id: string;
  stage_order: number;
  label: string;
  resolver: 'named' | 'form_adviser';
  approvers: Array<{
    userId: string;
    appliesToLevelType: 'primary' | 'secondary' | 'preschool' | null;
  }>;
}>;
let ladder: Ladder;
let openResult: unknown;
const loadConfiguredLadder = vi.fn(async (..._a: unknown[]) => ladder);
const openApprovalRequest = vi.fn(async (..._a: unknown[]) => {
  if (openResult instanceof Error) throw openResult;
  return openResult;
});
vi.mock('@/lib/approvals/materialise', () => ({
  loadConfiguredLadder: (...a: unknown[]) => loadConfiguredLadder(...a),
  openApprovalRequest: (...a: unknown[]) => openApprovalRequest(...a),
}));

let stepOneRecipients: Array<{ id: string; email: string }>;
const loadGradeChangeStepRecipients = vi.fn(async (..._a: unknown[]) => ({
  flow,
  stageOrder: 1,
  stageCount: ladder.length,
  stageLabel: ladder[0]?.label ?? '',
  recipients: stepOneRecipients,
}));
const sendGradeChangeStepEmails = vi.fn(async (..._a: unknown[]) => 'sent');
vi.mock('@/lib/change-requests/approval-notify', () => ({
  loadGradeChangeStepRecipients: (...a: unknown[]) =>
    loadGradeChangeStepRecipients(...a),
  sendGradeChangeStepEmails: (...a: unknown[]) =>
    sendGradeChangeStepEmails(...a),
}));

// ── Service stub ───────────────────────────────────────────────────────────

let inserts: Array<Record<string, unknown>>;
let deletes: Array<[string, unknown]>;
let statusUpdates: Array<Record<string, unknown>>;
let getCalls: Array<{ method: string; args: unknown[] }>;

function listChain(calls: Array<{ method: string; args: unknown[] }>) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'eq', 'or', 'in']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'grading_sheets') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'sheet-1',
                  section_id: 'section-1',
                  subject_id: 'subject-1',
                  is_locked: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'grade_entries') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'entry-1',
                  grading_sheet_id: 'sheet-1',
                  ww_scores: [8, 9],
                  pt_scores: [7, 8, 9],
                  qa_score: 20,
                  letter_grade: null,
                  is_na: false,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'grade_change_requests') {
        return {
          select: () => listChain(getCalls),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'gcr-new', ...row },
                  error: null,
                }),
              }),
            };
          },
          delete: () => ({
            eq: async (col: string, val: unknown) => {
              deletes.push([col, val]);
              return { error: null };
            },
          }),
          update: (patch: Record<string, unknown>) => {
            statusUpdates.push(patch);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    },
  })),
}));

import { GET, POST } from '@/app/api/change-requests/route';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';

function post(body: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/change-requests', {
      method: 'POST',
      body: JSON.stringify({
        grading_sheet_id: SHEET_ID,
        grade_entry_id: ENTRY_ID,
        field_changed: 'qa_score',
        slot_index: null,
        current_value: '20',
        proposed_value: '24',
        reason_category: 'data_entry_error',
        justification: 'Mis-keyed from the paper script on Tuesday.',
        ...body,
      }),
    }) as unknown as import('next/server').NextRequest
  ) as Promise<Response>;
}

const OPENED = { opened: true, requestId: 'apr-1', stageCount: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  authRole = 'teacher';
  flow = 'markbook.grade_change';
  ladder = [
    {
      id: 'st-1',
      stage_order: 1,
      label: 'Form class adviser',
      resolver: 'form_adviser',
      approvers: [],
    },
    {
      id: 'st-2',
      stage_order: 2,
      label: 'Academic coordinator',
      resolver: 'named',
      approvers: [{ userId: 'u-chandana', appliesToLevelType: null }],
    },
  ];
  openResult = OPENED;
  stepOneRecipients = [{ id: 'u-adviser', email: 'adviser@hfse.test' }];
  inserts = [];
  deletes = [];
  statusUpdates = [];
  getCalls = [];
});

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('POST /api/change-requests — filed on the approval steps', () => {
  it('needs no approvers from the teacher, and opens the request on the chosen route', async () => {
    flow = 'markbook.grade_change_aeb';

    const res = await post();
    expect(res.status).toBe(201);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      approval_flow: 'markbook.grade_change_aeb',
      status: 'pending',
      requested_by: 'u-teacher',
    });
    expect(inserts[0]).not.toHaveProperty('primary_approver_id');
    expect(inserts[0]).not.toHaveProperty('secondary_approver_id');
    expect(inserts[0]).not.toHaveProperty('eligible_approver_snapshot');

    expect(loadConfiguredLadder).toHaveBeenCalledWith(
      expect.anything(),
      'markbook.grade_change_aeb'
    );
    expect(openApprovalRequest).toHaveBeenCalledWith(expect.anything(), {
      flow: 'markbook.grade_change_aeb',
      subjectType: 'grade_change_request',
      subjectId: 'gcr-new',
      sectionId: 'section-1',
      levelType: 'primary',
      filedBy: 'u-teacher',
      filedByEmail: 'teacher@hfse.test',
      // Nobody approves their own request: the filer is kept off every step.
      excludeUserIds: ['u-teacher'],
    });

    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_requested',
      entityId: 'gcr-new',
      context: { flow: 'markbook.grade_change_aeb', request_id: 'apr-1' },
    });
    expect(deletes).toEqual([]);

    await flush();
    expect(sendGradeChangeStepEmails).toHaveBeenCalledWith(expect.anything(), {
      gradeChangeRequestId: 'gcr-new',
      step: expect.objectContaining({ stageOrder: 1 }),
    });
    expect((await res.json()).warning).toBeNull();
  });

  it('refuses with a plain sentence when no steps are set up, and writes nothing', async () => {
    ladder = [];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'The approval steps for this kind of grade change have not been set up yet. Ask the superadmin to set them up in SIS Admin → Approvers.'
    );
    expect(inserts).toEqual([]);
    expect(openApprovalRequest).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('refuses when a named step has nobody covering this class’s half', async () => {
    // The class is Primary; step 2's only approver covers Secondary.
    ladder[1].approvers = [
      { userId: 'u-elaine', appliesToLevelType: 'secondary' },
    ];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'Nobody is set up to approve step 2 (Academic coordinator) for this class. Ask the superadmin to add someone in SIS Admin → Approvers.'
    );
    expect(inserts).toEqual([]);
  });

  it('refuses when the teacher filing is the only person on a named step', async () => {
    // A school admin files a change on a sheet where they are also the only
    // grade change approver — they cannot approve their own request.
    ladder[1].approvers = [{ userId: 'u-teacher', appliesToLevelType: null }];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "You're the only person on step 2 (Academic coordinator), and you can't approve your own request. Ask the superadmin to add someone else."
    );
    expect(inserts).toEqual([]);
    expect(openApprovalRequest).not.toHaveBeenCalled();
  });

  it('lets it through when someone else is on the step beside the filer', async () => {
    ladder[1].approvers = [
      { userId: 'u-teacher', appliesToLevelType: null },
      { userId: 'u-chandana', appliesToLevelType: null },
    ];
    const res = await post();
    expect(res.status).toBe(201);
    expect(openApprovalRequest.mock.calls[0][1]).toMatchObject({
      excludeUserIds: ['u-teacher'],
    });
  });

  it.each([
    ['is not opened', { opened: false, reason: 'no_stages_configured' }],
    ['throws', new Error('insert failed')],
  ])(
    'takes the request back out when the approval steps %s',
    async (_label, result) => {
      openResult = result;
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await post();

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe(
        'Could not send this request for approval. Nothing was filed — please try again.'
      );
      expect(deletes).toEqual([['id', 'gcr-new']]);
      expect(logAction).not.toHaveBeenCalled();
      await flush();
      expect(sendGradeChangeStepEmails).not.toHaveBeenCalled();
      errors.mockRestore();
    }
  );

  it('warns the teacher when nobody on step 1 can be emailed', async () => {
    stepOneRecipients = [];
    const res = await post();
    expect(res.status).toBe(201);
    expect((await res.json()).warning).toMatch(/contact them directly/i);
    expect(statusUpdates).toContainEqual({ notification_status: 'failed' });
    await flush();
    expect(sendGradeChangeStepEmails).not.toHaveBeenCalled();
  });

  it('ignores approver ids an older screen still sends', async () => {
    const res = await post({
      primary_approver_id: '33333333-3333-4333-8333-333333333333',
      secondary_approver_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(res.status).toBe(201);
    expect(inserts[0]).not.toHaveProperty('primary_approver_id');
  });
});

describe('GET /api/change-requests — who sees stepped requests', () => {
  async function get(query: string) {
    return (await GET(
      new Request(
        `http://localhost/api/change-requests${query}`
      ) as unknown as import('next/server').NextRequest
    )) as Response;
  }

  it('keeps stepped requests out of the legacy "nobody designated" arm', async () => {
    authRole = 'school_admin';
    const res = await get('?status=pending');
    expect(res.status).toBe(200);
    const or = getCalls.find((c) => c.method === 'or');
    expect(or?.args[0]).toBe(
      'primary_approver_id.eq.u-teacher,secondary_approver_id.eq.u-teacher,and(primary_approver_id.is.null,secondary_approver_id.is.null,approval_flow.is.null)'
    );
  });

  it('does not scope the apply dialog’s lookup for one sheet', async () => {
    authRole = 'school_admin';
    await get(`?status=approved&sheet_id=${SHEET_ID}`);
    expect(getCalls.some((c) => c.method === 'or')).toBe(false);
    expect(getCalls).toContainEqual({
      method: 'eq',
      args: ['grading_sheet_id', SHEET_ID],
    });
  });

  it('still shows a teacher only their own requests on a sheet', async () => {
    await get(`?sheet_id=${SHEET_ID}`);
    expect(getCalls).toContainEqual({
      method: 'eq',
      args: ['requested_by', 'u-teacher'],
    });
  });
});
