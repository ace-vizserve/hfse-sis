import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: () => getSessionUserMock(),
}));

const serviceClient = {};
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => serviceClient,
}));

const logActionMock = vi.fn();
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...args: unknown[]) => logActionMock(...args),
}));

import { POST } from '@/app/api/account/password-changed/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/account/password-changed', () => {
  it('refuses a caller with no session and logs nothing', async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('logs the change against the signed-in account only', async () => {
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@hfse.test',
      role: 'teacher',
      roles: ['teacher'],
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(logActionMock).toHaveBeenCalledTimes(1);
    expect(logActionMock.mock.calls[0][0]).toEqual({
      service: serviceClient,
      actor: { id: 'user-1', email: 'teacher@hfse.test', role: 'teacher' },
      action: 'user.password.change',
      entityType: 'user_account',
      entityId: 'user-1',
      context: { self_service: true },
    });
  });
});
