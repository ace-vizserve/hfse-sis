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

import { decideChangeRequest } from '@/lib/change-requests/decide';

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
