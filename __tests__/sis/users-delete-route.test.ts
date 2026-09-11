import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Dependency mocks for the DELETE route, mirroring the established
// route-handler test pattern (__tests__/sis/withdrawal-preserves-outcome.test.ts).
//
// vi.mock(...) factories are hoisted above every top-level statement in this
// file, so a factory can only safely reference a mockXxx variable through a
// LAZY closure (a function that reads it when CALLED, not when the factory
// itself runs) — reading it directly as the factory's own return value hits
// a "cannot access before initialization" TDZ error, since the const hasn't
// been assigned yet at that point.

let mockAuthUser = { id: 'caller-1', email: 'caller@hfse.test' };
// The route gates on `staff.manage_accounts` rather than the superadmin role
// directly (the capability layer). Same holders — superadmin only — so these
// tests are unchanged in intent; only the mocked module moved.
const mockRequireCapability = vi.fn(() =>
  Promise.resolve({
    user: mockAuthUser,
    role: 'superadmin' as const,
    capabilities: ['staff.manage_accounts'] as const,
  })
);
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: () => mockRequireCapability(),
  requireAnyCapability: () => mockRequireCapability(),
}));

// Both handlers bust the cached staff list (lib/auth/staff-list.ts's
// `teacher-emails` tag) on success — a deleted account that stayed in it would
// keep turning up in teacher pickers and name lookups for five minutes. The
// real `revalidateTag` needs Next's request store, which does not exist under
// vitest, so it is stubbed rather than worked around.
const mockRevalidateTag = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

type LogActionParams = {
  action: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
} & Record<string, unknown>;
const mockLogAction = vi.fn((_params: LogActionParams) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (params: LogActionParams) => mockLogAction(params),
}));

// getUserFootprint/isLastSuperadmin are already unit-tested in
// __tests__/sis/user-deletion.test.ts against their real implementation —
// mocked here so this suite tests only the ROUTE's guard ordering and
// wiring, not the footprint/last-superadmin logic itself.
const mockGetUserFootprint = vi.fn(
  (_service: unknown, _userId: string, _role: string | null) =>
    Promise.resolve<string[]>([])
);
const mockIsLastSuperadmin = vi.fn(
  (_users: unknown, _targetId: string) => false
);
// The approval-step pair was added when deleting an account started bringing
// in-flight requests on its steps in line (migration 146 review). Mocked here
// for the same reason as the two above — this suite pins the ROUTE's order:
// the steps are read BEFORE the delete (the cascade erases the rows that say
// which they were), the delete is refused if they cannot be read, and the
// re-point runs only AFTER a delete that landed.
let mockNamedStageIds: string[] = [];
let mockNamedStagesError: Error | null = null;
const mockListApprovalStagesNamingUser = vi.fn(
  (_service: unknown, _userId: string) =>
    mockNamedStagesError
      ? Promise.reject(mockNamedStagesError)
      : Promise.resolve(mockNamedStageIds)
);
const mockRepointStagesAfterUserDeletion = vi.fn(
  (_service: unknown, _stageIds: readonly string[], _actor: unknown) =>
    Promise.resolve()
);
vi.mock('@/lib/sis/user-deletion', () => ({
  getUserFootprint: (service: unknown, userId: string, role: string | null) =>
    mockGetUserFootprint(service, userId, role),
  isLastSuperadmin: (users: unknown, targetId: string) =>
    mockIsLastSuperadmin(users, targetId),
  listApprovalStagesNamingUser: (service: unknown, userId: string) =>
    mockListApprovalStagesNamingUser(service, userId),
  repointStagesAfterUserDeletion: (
    service: unknown,
    stageIds: readonly string[],
    actor: unknown
  ) => mockRepointStagesAfterUserDeletion(service, stageIds, actor),
}));

type FakeUser = {
  id: string;
  email: string;
  app_metadata?: { role?: string } | null;
  user_metadata?: { role?: string } | null;
};

let mockTargetUser: FakeUser | null = {
  id: 'target-1',
  email: 'target@hfse.test',
  app_metadata: { role: 'teacher' },
};
let mockGetUserByIdError: { message: string } | null = null;
let mockListUsersResult: { users: FakeUser[] } | null = { users: [] };
let mockListUsersError: { message: string } | null = null;
const mockDeleteUser = vi.fn(
  (_id: string): Promise<{ error: { message: string } | null }> =>
    Promise.resolve({ error: null })
);

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        getUserById: () =>
          Promise.resolve({
            data: mockTargetUser ? { user: mockTargetUser } : null,
            error: mockGetUserByIdError,
          }),
        listUsers: () =>
          Promise.resolve({
            data: mockListUsersResult,
            error: mockListUsersError,
          }),
        deleteUser: (id: string) => mockDeleteUser(id),
      },
    },
  }),
}));

import { DELETE } from '@/app/api/sis/admin/users/[id]/route';

function buildRequest() {
  return new Request('http://localhost/api/sis/admin/users/target-1', {
    method: 'DELETE',
  }) as unknown as import('next/server').NextRequest;
}

function callDelete(id = 'target-1') {
  return DELETE(buildRequest(), {
    params: Promise.resolve({ id }),
  }) as unknown as Promise<Response>;
}

describe('DELETE /api/sis/admin/users/[id]', () => {
  beforeEach(() => {
    mockAuthUser = { id: 'caller-1', email: 'caller@hfse.test' };
    mockRequireCapability.mockClear();
    mockRequireCapability.mockImplementation(() =>
      Promise.resolve({
        user: mockAuthUser,
        role: 'superadmin' as const,
        capabilities: ['staff.manage_accounts'] as const,
      })
    );
    mockLogAction.mockClear();
    mockGetUserFootprint.mockClear();
    mockGetUserFootprint.mockImplementation(() => Promise.resolve([]));
    mockIsLastSuperadmin.mockClear();
    mockIsLastSuperadmin.mockImplementation(() => false);
    mockTargetUser = {
      id: 'target-1',
      email: 'target@hfse.test',
      app_metadata: { role: 'teacher' },
    };
    mockGetUserByIdError = null;
    mockListUsersResult = { users: [] };
    mockListUsersError = null;
    mockDeleteUser.mockClear();
    mockDeleteUser.mockImplementation(() => Promise.resolve({ error: null }));
    mockNamedStageIds = [];
    mockNamedStagesError = null;
    mockListApprovalStagesNamingUser.mockClear();
    mockRepointStagesAfterUserDeletion.mockClear();
    mockRevalidateTag.mockClear();
  });

  it('blocks self-delete with 403 before any lookup', async () => {
    mockAuthUser = { id: 'target-1', email: 'target@hfse.test' };
    const res = await callDelete('target-1');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('You cannot delete your own account.');
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it('404s when the target user does not exist', async () => {
    mockTargetUser = null;
    const res = await callDelete();
    expect(res.status).toBe(404);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('fails closed (500) when listUsers errors while checking a superadmin target', async () => {
    mockTargetUser = {
      id: 'target-1',
      email: 'target@hfse.test',
      app_metadata: { role: 'superadmin' },
    };
    mockListUsersError = { message: 'transient failure' };
    const res = await callDelete();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(
      'Could not verify the superadmin count — try again.'
    );
    expect(mockIsLastSuperadmin).not.toHaveBeenCalled();
    expect(mockGetUserFootprint).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('blocks deleting the last remaining superadmin (409), never reaching the footprint check', async () => {
    mockTargetUser = {
      id: 'target-1',
      email: 'target@hfse.test',
      app_metadata: { role: 'superadmin' },
    };
    mockIsLastSuperadmin.mockImplementation(() => true);
    const res = await callDelete();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(
      'This is the last superadmin account — promote another account first.'
    );
    expect(mockGetUserFootprint).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('a non-last superadmin still passes through the footprint check afterward', async () => {
    mockTargetUser = {
      id: 'target-1',
      email: 'target@hfse.test',
      app_metadata: { role: 'superadmin' },
    };
    mockIsLastSuperadmin.mockImplementation(() => false);
    mockGetUserFootprint.mockImplementation(() =>
      Promise.resolve(['school_config'])
    );
    const res = await callDelete();
    expect(mockGetUserFootprint).toHaveBeenCalled();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.tables).toEqual(['school_config']);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('blocks a non-superadmin account with a footprint (409, names the tables), never calling deleteUser', async () => {
    mockGetUserFootprint.mockImplementation(() =>
      Promise.resolve(['evaluation_writeups', 'attendance_daily'])
    );
    const res = await callDelete();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(
      "Can't delete — this account has activity in: evaluation_writeups, attendance_daily. Use Disable instead."
    );
    expect(body.tables).toEqual(['evaluation_writeups', 'attendance_daily']);
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it('deletes a zero-footprint account and logs user.delete with email + role', async () => {
    const res = await callDelete();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDeleteUser).toHaveBeenCalledWith('target-1');
    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const call = mockLogAction.mock.calls[0][0];
    expect(call.action).toBe('user.delete');
    expect(call.entityType).toBe('user_account');
    expect(call.entityId).toBe('target-1');
    expect(call.context).toEqual({
      email: 'target@hfse.test',
      role: 'teacher',
    });
  });

  it('surfaces the exact deleteUser error message on a genuine delete failure (500)', async () => {
    mockDeleteUser.mockImplementation(() =>
      Promise.resolve({ error: { message: 'auth provider unavailable' } })
    );
    mockNamedStageIds = ['stage-1'];
    const res = await callDelete();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('auth provider unavailable');
    expect(mockLogAction).not.toHaveBeenCalled();
    // Nothing was deleted, so nothing on the step changed.
    expect(mockRepointStagesAfterUserDeletion).not.toHaveBeenCalled();
  });

  describe('approval steps the account was on', () => {
    it('reads them before the delete and brings their requests in line after, as the deleting admin', async () => {
      mockNamedStageIds = ['stage-1', 'stage-2'];
      const order: string[] = [];
      mockListApprovalStagesNamingUser.mockImplementationOnce(() => {
        order.push('read');
        return Promise.resolve(mockNamedStageIds);
      });
      mockDeleteUser.mockImplementationOnce(() => {
        order.push('delete');
        return Promise.resolve({ error: null });
      });
      mockRepointStagesAfterUserDeletion.mockImplementationOnce(() => {
        order.push('repoint');
        return Promise.resolve();
      });

      const res = await callDelete();

      expect(res.status).toBe(200);
      expect(order).toEqual(['read', 'delete', 'repoint']);
      expect(mockListApprovalStagesNamingUser.mock.calls[0][1]).toBe(
        'target-1'
      );
      expect(mockRepointStagesAfterUserDeletion.mock.calls[0][1]).toEqual([
        'stage-1',
        'stage-2',
      ]);
      expect(mockRepointStagesAfterUserDeletion.mock.calls[0][2]).toEqual({
        id: 'caller-1',
        email: 'caller@hfse.test',
        role: 'superadmin',
      });
      expect(mockRevalidateTag).toHaveBeenCalledWith('sis-health', 'max');
    });

    it('does not delete an account whose steps cannot be read', async () => {
      mockNamedStagesError = new Error('boom');
      const res = await callDelete();
      expect(res.status).toBe(500);
      expect(mockDeleteUser).not.toHaveBeenCalled();
      expect(mockLogAction).not.toHaveBeenCalled();
    });

    it('re-points nothing, and leaves the readiness strip alone, for an account on no step', async () => {
      const res = await callDelete();
      expect(res.status).toBe(200);
      expect(mockRepointStagesAfterUserDeletion).not.toHaveBeenCalled();
      expect(mockRevalidateTag).not.toHaveBeenCalledWith('sis-health', 'max');
    });
  });
});
