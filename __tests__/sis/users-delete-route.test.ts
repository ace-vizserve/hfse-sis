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
vi.mock('@/lib/sis/user-deletion', () => ({
  getUserFootprint: (service: unknown, userId: string, role: string | null) =>
    mockGetUserFootprint(service, userId, role),
  isLastSuperadmin: (users: unknown, targetId: string) =>
    mockIsLastSuperadmin(users, targetId),
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
    const res = await callDelete();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('auth provider unavailable');
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});
