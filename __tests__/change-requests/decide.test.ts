import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Dependency mocks ──────────────────────────────────────────────────────
// decide.ts pulls in several server-only side-effecting modules. We stub the
// ones that hit the network / cache so the test exercises only the decision
// logic + the Supabase read/write chain.
const logActionMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...args: unknown[]) => logActionMock(...args),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(async () => 'AY9999'),
}));

const notifyApprovedMock = vi.fn(async (..._a: unknown[]) => ({
  sent: 0,
  failed: 0,
}));
const notifyRejectedMock = vi.fn(async (..._a: unknown[]) => ({
  sent: 0,
  failed: 0,
}));
vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyRequestApproved: (...a: unknown[]) => notifyApprovedMock(...a),
  notifyRequestRejected: (...a: unknown[]) => notifyRejectedMock(...a),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({ student_label: null, sheet_label: null })),
  fetchRegistrarEmails: vi.fn(async () => []),
}));

// Approval is gated on the grade_changes.approve capability rather than a role
// name. The real lookup reads role_permissions through the service client inside
// unstable_cache, which has neither a database nor a request scope here — so
// resolve it from the built-in defaults, which is the same answer production
// gets from the seeded table.
vi.mock('@/lib/auth/permission-map', async () => {
  const { DEFAULT_ROLE_CAPABILITIES } = await import('@/lib/auth/capabilities');
  return {
    getCapabilitiesForRole: async (role: string | null) =>
      role
        ? (DEFAULT_ROLE_CAPABILITIES[
            role as keyof typeof DEFAULT_ROLE_CAPABILITIES
          ] ?? [])
        : [],
    getRoleCapabilities: async () => DEFAULT_ROLE_CAPABILITIES,
    roleCan: async () => false,
    PERMISSIONS_CACHE_TAG: 'permissions',
  };
});

import {
  decideChangeRequest,
  STAGED_REQUEST_ALREADY_DECIDED,
  STAGED_REQUEST_DECIDED_ELSEWHERE,
  STAGED_REQUEST_DECIDED_NOT_SHOWN,
} from '@/lib/change-requests/decide';

// ── Minimal chainable Supabase service-client stub ────────────────────────
// Models exactly the two chains decide.ts uses against
// `grade_change_requests`:
//   .select('*').eq('id', …).single()            → returns `existing`
//   .update(…).eq().eq().select('*').maybeSingle() → returns `updated`
// plus a no-op `audit_log` insert path (logAction is mocked anyway).
//
// `selectResult` feeds .single(); `updateResult` feeds .maybeSingle().
// `capturedUpdate` records the patch object passed to .update().

type SbResult = { data: unknown; error: unknown };

function makeService(opts: {
  existing: SbResult;
  updated: SbResult;
  onUpdate?: (patch: Record<string, unknown>) => void;
}) {
  const service = {
    from(_table: string) {
      const builder: Record<string, unknown> = {};
      // read chain
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = async () => opts.existing;
      builder.maybeSingle = async () => opts.updated;
      builder.insert = async () => ({ error: null });
      // write chain
      builder.update = (patch: Record<string, unknown>) => {
        opts.onUpdate?.(patch);
        return builder;
      };
      return builder;
    },
  };
  return service as never;
}

const PRIMARY_APPROVER = 'approver-primary';
const SECONDARY_APPROVER = 'approver-secondary';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    status: 'pending',
    requested_by: 'teacher-1',
    primary_approver_id: PRIMARY_APPROVER,
    secondary_approver_id: SECONDARY_APPROVER,
    primary_reviewed_by: null,
    primary_reviewed_by_email: null,
    primary_reviewed_at: null,
    secondary_reviewed_by: null,
    grading_sheet_id: 'sheet-1',
    grade_entry_id: 'entry-1',
    field_changed: 'qa_score',
    proposed_value: '88',
    current_value: '85',
    reason_category: 'data_entry_error',
    justification: 'fixing a typo in the quarterly assessment score',
    requested_by_email: 'teacher@hfse.test',
    requested_at: '2026-06-01T00:00:00.000Z',
    decision_note: null,
    ...overrides,
  };
}

const adminUser = (id: string) => ({
  id,
  email: `${id}@hfse.test`,
  role: 'school_admin',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decideChangeRequest', () => {
  it('approve as primary flips status→approved + stamps approved_at', async () => {
    let captured: Record<string, unknown> = {};
    const service = makeService({
      existing: { data: baseRow(), error: null },
      updated: { data: baseRow({ status: 'approved' }), error: null },
      onUpdate: (p) => {
        captured = p;
      },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.status).toBe('approved');
    expect(captured.status).toBe('approved');
    expect(captured.approved_at).toBeTruthy();
    expect(captured.primary_reviewed_by).toBe(PRIMARY_APPROVER);
    expect(captured.primary_decision).toBe('approved');
    expect(logActionMock).toHaveBeenCalledTimes(1);
    // migration 141 — the audit row carries the capacity, not just the person.
    expect(logActionMock.mock.calls[0][0]).toMatchObject({
      actor: { id: PRIMARY_APPROVER, role: 'school_admin' },
    });
  });

  it('refuses a scraped-but-empty role before it can reach the audit log', async () => {
    // The signed-link approval route has no session to gate on, so it reaches
    // for `app_metadata.role` with a `?? ''` fallback. That '' resolves to no
    // capabilities and fails closed HERE — which is why a blank never actually
    // reaches `audit_log` through this path. `toAuditRow` still collapses ''
    // to null (its own tests pin that); this records that the coercion is a
    // backstop, not the only thing standing between a blank and the table.
    const service = makeService({
      existing: { data: baseRow(), error: null },
      updated: { data: baseRow({ status: 'approved' }), error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: {
        id: PRIMARY_APPROVER,
        email: 'approver@hfse.test',
        role: '',
      },
      via: 'email_token',
    });

    expect(result.httpStatus).toBe(403);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('second approver co-signs (secondary_* only, status untouched)', async () => {
    let captured: Record<string, unknown> = {};
    // Primary already reviewed (approved); secondary now co-signs.
    const existing = baseRow({
      status: 'approved',
      primary_reviewed_by: PRIMARY_APPROVER,
      primary_reviewed_at: '2026-06-02T00:00:00.000Z',
    });
    const service = makeService({
      existing: { data: existing, error: null },
      updated: { data: existing, error: null },
      onUpdate: (p) => {
        captured = p;
      },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(SECONDARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(true);
    expect(captured.secondary_reviewed_by).toBe(SECONDARY_APPROVER);
    expect(captured.secondary_decision).toBe('approved');
    // Co-sign must NOT touch status or any legacy/primary review column.
    expect(captured).not.toHaveProperty('status');
    expect(captured).not.toHaveProperty('reviewed_by');
    expect(captured).not.toHaveProperty('primary_reviewed_by');
  });

  it('reject requires a non-empty note (empty → ok:false, 400)', async () => {
    const service = makeService({
      existing: { data: baseRow(), error: null },
      updated: { data: baseRow({ status: 'rejected' }), error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'reject',
      actingUser: adminUser(PRIMARY_APPROVER),
      decisionNote: '   ',
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/decision note is required/i);
    // Never reached the DB write / audit on a validation bail.
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('reject with a note succeeds', async () => {
    let captured: Record<string, unknown> = {};
    const service = makeService({
      existing: { data: baseRow(), error: null },
      updated: { data: baseRow({ status: 'rejected' }), error: null },
      onUpdate: (p) => {
        captured = p;
      },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'reject',
      actingUser: adminUser(PRIMARY_APPROVER),
      decisionNote: 'Scores look correct as entered.',
      via: 'in_app',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('rejected');
    expect(captured.status).toBe('rejected');
    expect(captured.decision_note).toBe('Scores look correct as entered.');
    // reject must NOT stamp approved_at.
    expect(captured.approved_at).toBeUndefined();
  });

  it('same approver acting twice is guarded', async () => {
    // Primary already reviewed; the SAME user tries to act again → would be
    // the secondary path, but sameUserAlreadyReviewed blocks it.
    const existing = baseRow({
      status: 'approved',
      primary_reviewed_by: PRIMARY_APPROVER,
      primary_reviewed_at: '2026-06-02T00:00:00.000Z',
    });
    const service = makeService({
      existing: { data: existing, error: null },
      updated: { data: existing, error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/already reviewed/i);
  });

  it('acting on an already-decided (applied) request → 400 terminal', async () => {
    const service = makeService({
      existing: { data: baseRow({ status: 'applied' }), error: null },
      updated: { data: null, error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/cannot approve/i);
  });

  it('optimistic-concurrency miss (no row updated) → 409', async () => {
    const service = makeService({
      existing: { data: baseRow(), error: null },
      // .maybeSingle() returns null → another admin handled it first.
      updated: { data: null, error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/already handled/i);
  });

  it('not-found request → 404', async () => {
    const service = makeService({
      existing: { data: null, error: { message: 'no rows' } },
      updated: { data: null, error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'missing',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.error).toBe('request not found');
  });

  // The academic coordinator FILES and APPLIES change requests; approving them
  // is a different role's job, which is the separation of duties the
  // dual-reviewer trail exists to create. She holds grade_changes.read but not
  // .approve.
  it('a role without grade_changes.approve cannot review → 403', async () => {
    const service = makeService({
      existing: { data: baseRow(), error: null },
      updated: { data: baseRow({ status: 'approved' }), error: null },
    });

    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: {
        id: 'reg-1',
        email: 'r@hfse.test',
        role: 'academic_coordinator',
      },
      via: 'in_app',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(403);
    expect(result.error).toMatch(/not allowed to approve or reject/i);
  });
});

// ── Migration 144: requests decided step by step ───────────────────────────
//
// A row with `approval_flow` set is decided on the ordered approval engine,
// never here. These pin the two halves of that: the old decision paths refuse
// it outright, and a withdrawal closes the ladder BEFORE the row.

type StagedCalls = {
  updates: Array<Record<string, unknown>>;
  /** The `.eq()` filters on each update, in the same order as `updates`. */
  updateFilters?: Array<Array<[string, unknown]>>;
  rpc: Array<{ fn: string; args: unknown }>;
  tables: string[];
};

function makeStagedService(opts: {
  existing: Record<string, unknown>;
  /** `status` is what the re-read after `request_closed` finds. */
  approvalRequest?: { id: string; status?: string } | null;
  /** Fail the SECOND read of approval_requests — the one after the RPC. */
  approvalRereadFails?: boolean;
  /** The decided step `approval_request_stages` hands back. */
  decidedStage?: Record<string, unknown> | null;
  cancelOutcome?: 'cancelled' | 'request_closed' | 'request_not_found';
  updated?: Record<string, unknown> | null;
  calls: StagedCalls;
}) {
  let approvalReads = 0;
  return {
    from(table: string) {
      opts.calls.tables.push(table);
      const builder: Record<string, unknown> = {};
      let filters: Array<[string, unknown]> | null = null;
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        filters?.push([col, val]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.single = async () => ({ data: opts.existing, error: null });
      builder.maybeSingle = async () => {
        if (table === 'approval_requests') {
          approvalReads += 1;
          if (approvalReads > 1 && opts.approvalRereadFails) {
            return { data: null, error: { message: 'connection reset' } };
          }
          return { data: opts.approvalRequest ?? null, error: null };
        }
        if (table === 'approval_request_stages') {
          return { data: opts.decidedStage ?? null, error: null };
        }
        return {
          data:
            opts.updated === undefined
              ? { ...opts.existing, status: 'cancelled' }
              : opts.updated,
          error: null,
        };
      };
      builder.update = (patch: Record<string, unknown>) => {
        opts.calls.updates.push(patch);
        filters = [];
        opts.calls.updateFilters?.push(filters);
        return builder;
      };
      return builder;
    },
    rpc: async (fn: string, args: unknown) => {
      opts.calls.rpc.push({ fn, args });
      return {
        data: [{ outcome: opts.cancelOutcome ?? 'cancelled' }],
        error: null,
      };
    },
  } as never;
}

const stagedRow = (overrides: Record<string, unknown> = {}) =>
  baseRow({
    approval_flow: 'markbook.grade_change',
    primary_approver_id: null,
    secondary_approver_id: null,
    ...overrides,
  });

describe('decideChangeRequest — a request decided step by step', () => {
  it.each(['approve', 'reject', 'undo_rejection'] as const)(
    '%s is refused with 409 and writes nothing',
    async (action) => {
      const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
      const result = await decideChangeRequest({
        service: makeStagedService({
          existing: stagedRow(
            action === 'undo_rejection' ? { status: 'rejected' } : {}
          ),
          calls,
        }),
        requestId: 'req-1',
        action,
        actingUser: adminUser('anyone'),
        decisionNote: action === 'reject' ? 'A real reason.' : null,
        via: 'in_app',
      });

      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(409);
      expect(result.error).toBe(STAGED_REQUEST_DECIDED_ELSEWHERE);
      expect(calls.updates).toEqual([]);
      expect(calls.rpc).toEqual([]);
      expect(logActionMock).not.toHaveBeenCalled();
    }
  );

  it('the refusal does not depend on a missing reason — reject with no note is still 409, not 400', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({ existing: stagedRow(), calls }),
      requestId: 'req-1',
      action: 'reject',
      actingUser: adminUser('anyone'),
      decisionNote: '<p></p>',
      via: 'email_token',
    });
    expect(result.httpStatus).toBe(409);
  });

  it('a legacy row is untouched by the guard', async () => {
    const service = makeService({
      existing: { data: baseRow({ approval_flow: null }), error: null },
      updated: { data: baseRow({ status: 'approved' }), error: null },
    });
    const result = await decideChangeRequest({
      service,
      requestId: 'req-1',
      action: 'approve',
      actingUser: adminUser(PRIMARY_APPROVER),
      via: 'in_app',
    });
    expect(result.ok).toBe(true);
  });

  it('cancel by the requester closes the ladder, then the row, with the usual audit row', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1' },
        cancelOutcome: 'cancelled',
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: { id: 'teacher-1', email: 't@hfse.test', role: 'teacher' },
      via: 'in_app',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(calls.rpc).toEqual([
      { fn: 'approval_cancel', args: { p_request_id: 'appr-1' } },
    ]);
    // The ladder is closed BEFORE the row is written.
    expect(calls.tables.indexOf('approval_requests')).toBeLessThan(
      calls.tables.lastIndexOf('grade_change_requests')
    );
    expect(calls.updates).toEqual([{ status: 'cancelled' }]);
    expect(logActionMock).toHaveBeenCalledTimes(1);
    expect(logActionMock.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_cancelled',
    });
  });

  it('cancel that loses the race to a decision is 409, cancels nothing and audits nothing', async () => {
    // The approver's own write reached the row first, so nothing is pending
    // any more by the time this side tries.
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'approved' },
        decidedStage: {
          decided_by: 'u-board',
          decided_by_email: 'board@hfse.test',
          decided_at: '2026-09-10T01:00:00.000Z',
          decision_note: null,
        },
        cancelOutcome: 'request_closed',
        updated: null,
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: { id: 'teacher-1', email: 't@hfse.test', role: 'teacher' },
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(409);
    expect(result.error).toBe(STAGED_REQUEST_ALREADY_DECIDED);
    expect(calls.updates.some((u) => u.status === 'cancelled')).toBe(false);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('only the requester may cancel — the ladder is never touched for anyone else', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1' },
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: { id: 'someone-else', email: 's@hfse.test', role: 'teacher' },
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(403);
    expect(calls.rpc).toEqual([]);
  });

  it('a request no longer pending is not cancelled, and the ladder is not touched', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow({ status: 'approved' }),
        approvalRequest: { id: 'appr-1' },
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: { id: 'teacher-1', email: 't@hfse.test', role: 'teacher' },
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(400);
    expect(calls.rpc).toEqual([]);
  });
});

// The ladder commits first and the row is written after, as a second
// statement. When that second write fails, the ladder is closed under a row
// still reading `pending`, and every later click is answered `request_closed`.
// These pin the teacher's Cancel finishing the job instead of telling her
// "someone already decided it" over a request her screen still shows waiting.
describe('decideChangeRequest — cancel over a ladder that closed without its row', () => {
  const teacher = { id: 'teacher-1', email: 't@hfse.test', role: 'teacher' };

  it('a withdrawal that reached the ladder but not the row is finished on the next try', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'cancelled' },
        cancelOutcome: 'request_closed',
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: teacher,
      via: 'in_app',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(calls.updates).toEqual([{ status: 'cancelled' }]);
    expect(logActionMock).toHaveBeenCalledTimes(1);
    expect(logActionMock.mock.calls[0][0]).toMatchObject({
      action: 'grade_change_cancelled',
    });
  });

  it('an approval left behind is written onto the row from the step that finished it, then 409', async () => {
    const calls: StagedCalls = {
      updates: [],
      updateFilters: [],
      rpc: [],
      tables: [],
    };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'approved' },
        decidedStage: {
          decided_by: 'u-board',
          decided_by_email: 'board@hfse.test',
          decided_at: '2026-09-10T01:00:00.000Z',
          decision_note: null,
        },
        cancelOutcome: 'request_closed',
        updated: { id: 'req-1' },
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: teacher,
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(409);
    expect(result.error).toBe(STAGED_REQUEST_ALREADY_DECIDED);
    expect(calls.updates).toEqual([
      {
        status: 'approved',
        reviewed_by: 'u-board',
        reviewed_by_email: 'board@hfse.test',
        reviewed_at: '2026-09-10T01:00:00.000Z',
        approved_at: '2026-09-10T01:00:00.000Z',
      },
    ]);
    // Only ever over a row still pending — never over one that moved on.
    expect(calls.updateFilters).toEqual([
      [
        ['id', 'req-1'],
        ['status', 'pending'],
      ],
    ]);
    // The teacher did not decide anything, so nothing is logged in her name.
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('a turn-down left behind carries the approver’s reason onto the row', async () => {
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'rejected' },
        decidedStage: {
          decided_by: 'u-hod',
          decided_by_email: null,
          decided_at: '2026-09-10T02:00:00.000Z',
          decision_note: '<p>The paper shows 20.</p>',
        },
        cancelOutcome: 'request_closed',
        updated: { id: 'req-1' },
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: teacher,
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(409);
    expect(calls.updates).toEqual([
      {
        status: 'rejected',
        reviewed_by: 'u-hod',
        reviewed_by_email: '(unknown)',
        reviewed_at: '2026-09-10T02:00:00.000Z',
        decision_note: '<p>The paper shows 20.</p>',
      },
    ]);
  });

  it('says the status could not be updated — not "refresh" — when the row cannot be brought in line', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'approved' },
        // No decided step to read the decision from.
        decidedStage: null,
        cancelOutcome: 'request_closed',
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: teacher,
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(500);
    expect(result.error).toBe(STAGED_REQUEST_DECIDED_NOT_SHOWN);
    expect(result.error).not.toMatch(/refresh/i);
    expect(calls.updates).toEqual([]);
    expect(logActionMock).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('asks her to try again when the closed request cannot be re-read', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: StagedCalls = { updates: [], rpc: [], tables: [] };
    const result = await decideChangeRequest({
      service: makeStagedService({
        existing: stagedRow(),
        approvalRequest: { id: 'appr-1', status: 'cancelled' },
        approvalRereadFails: true,
        cancelOutcome: 'request_closed',
        calls,
      }),
      requestId: 'req-1',
      action: 'cancel',
      actingUser: teacher,
      via: 'in_app',
    });

    expect(result.httpStatus).toBe(500);
    expect(result.error).toMatch(/try again/i);
    expect(calls.updates).toEqual([]);
    errors.mockRestore();
  });
});
