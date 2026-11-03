import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Every write route starts with requireRole(['superadmin']). The mock answers
// for the caller, as the real helper does, by checking the role against the
// list the ROUTE passed in: a route that widened its list would let these
// callers through and fail the 403 tests.
let callerRole: string = 'superadmin';
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: async (allowed: string[]) =>
    allowed.includes(callerRole)
      ? {
          user: { id: 'super-1', email: 'super@hfse.test' },
          role: callerRole,
        }
      : {
          error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
        },
}));

type AuditParams = {
  action: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
};
const logAction = vi.fn((_params: AuditParams) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (params: AuditParams) => logAction(params),
}));

type FakeUser = {
  id: string;
  email: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string;
};

let users: FakeUser[] = [];
const updateUserById = vi.fn((_id: string, _attrs: Record<string, unknown>) =>
  Promise.resolve<{ error: { message: string } | null }>({ error: null })
);
const createUser = vi.fn((attrs: { email: string }) =>
  Promise.resolve<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>({ data: { user: { id: `new-${attrs.email}` } }, error: null })
);
const service = {
  auth: {
    admin: {
      listUsers: () => Promise.resolve({ data: { users }, error: null }),
      updateUserById,
      createUser,
    },
  },
};
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service,
}));

const passwordRoute =
  await import('@/app/api/sis/admin/parent-portal/accounts/password/route');
const accountRoute =
  await import('@/app/api/sis/admin/parent-portal/accounts/route');
const { generateTemporaryPassword, listParentAccounts } =
  await import('@/lib/parent-portal/accounts');
const { auditActionLabel, auditContextSummary } =
  await import('@/lib/audit/humanize');

// `requireRole`'s result type lets `auth.error` read as possibly undefined, so
// every route using it is typed as maybe returning nothing. These always answer.
const postPassword = async (request: NextRequest) =>
  (await passwordRoute.POST(request)) as Response;
const postAccount = async (request: NextRequest) =>
  (await accountRoute.POST(request)) as Response;

function post(path: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/sis/admin/parent-portal/${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

const PARENT: FakeUser = {
  id: 'parent-1',
  email: 'mei.tan@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: {
    fullName: 'Tan, Mei',
    relationship: 'mother',
    phone: '91234567',
  },
  email_confirmed_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: '2026-10-01T00:00:00Z',
  created_at: '2025-12-01T00:00:00Z',
};
const STAFF: FakeUser = {
  id: 'staff-1',
  email: 'teacher@hfse.edu.sg',
  app_metadata: { role: 'teacher' },
  user_metadata: { display_name: 'Ms Lhen' },
  email_confirmed_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: null,
  created_at: '2025-12-01T00:00:00Z',
};
// Two roles, in a role list with the one in force named separately: still staff.
const STAFF_TWO_ROLES: FakeUser = {
  id: 'staff-2',
  email: 'head@hfse.edu.sg',
  app_metadata: { role: ['school_admin', 'teacher'], active_role: 'teacher' },
  user_metadata: {},
};

const NEW_ACCOUNT = {
  firstName: 'Mei',
  lastName: 'Tan',
  relationship: 'mother',
  email: 'New.Parent@Example.com',
  password: 'Sup3rSecret!pw',
};

beforeEach(() => {
  callerRole = 'superadmin';
  users = [PARENT, STAFF, STAFF_TWO_ROLES];
  logAction.mockClear();
  updateUserById.mockClear();
  createUser.mockClear();
});

describe('POST accounts/password', () => {
  const good = { email: PARENT.email, password: 'NewPassw0rd!x' };

  it.each(['school_admin', 'academic_coordinator', 'admissions', 'teacher'])(
    'gives 403 to %s and changes nothing',
    async (role) => {
      callerRole = role;
      const res = await postPassword(post('accounts/password', good));
      expect(res.status).toBe(403);
      expect(updateUserById).not.toHaveBeenCalled();
      expect(logAction).not.toHaveBeenCalled();
    }
  );

  it('gives 400 for a password under 8 characters', async () => {
    const res = await postPassword(
      post('accounts/password', { email: PARENT.email, password: 'short' })
    );
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('gives 404 for an email nobody has', async () => {
    const res = await postPassword(
      post('accounts/password', {
        email: 'nobody@example.com',
        password: 'NewPassw0rd!x',
      })
    );
    expect(res.status).toBe(404);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ['a teacher', STAFF.email],
    ['the same teacher, in other capitals', 'TEACHER@HFSE.EDU.SG'],
    ['an account holding two roles', STAFF_TWO_ROLES.email],
  ])(
    'refuses %s: 403, nothing changes, nothing logged',
    async (_who, email) => {
      const res = await postPassword(
        post('accounts/password', { email, password: 'NewPassw0rd!x' })
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('This is a staff account');
      expect(updateUserById).not.toHaveBeenCalled();
      expect(logAction).not.toHaveBeenCalled();
    }
  );

  it("refuses the portal's own admin login, and leaves it off the parent list", async () => {
    const portalAdmin: FakeUser = {
      id: 'portal-admin',
      email: 'admin@parent.portal.com',
      app_metadata: {},
      user_metadata: {},
    };
    users = [PARENT, portalAdmin];

    const res = await postPassword(
      post('accounts/password', {
        email: portalAdmin.email,
        password: 'NewPassw0rd!x',
      })
    );

    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
    const { listParentAccounts } = await import('@/lib/parent-portal/accounts');
    const listed = await listParentAccounts(service as never);
    expect(listed.map((a) => a.email)).toEqual([PARENT.email]);
  });

  it('sets the password, keeps the other metadata, and marks it temporary', async () => {
    const res = await postPassword(post('accounts/password', good));
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledTimes(1);
    const [id, attrs] = updateUserById.mock.calls[0];
    expect(id).toBe(PARENT.id);
    expect(attrs).toEqual({
      password: good.password,
      user_metadata: {
        fullName: 'Tan, Mei',
        relationship: 'mother',
        phone: '91234567',
        password_changed: false,
        temporary_password: good.password,
      },
    });
  });

  it('finds the account whatever capitals the email is typed in', async () => {
    const res = await postPassword(
      post('accounts/password', { ...good, email: 'MEI.TAN@EXAMPLE.COM' })
    );
    expect(res.status).toBe(200);
    expect(updateUserById.mock.calls[0][0]).toBe(PARENT.id);
  });

  it('logs the reset under the superadmin with no password anywhere in the row', async () => {
    await postPassword(post('accounts/password', good));
    expect(logAction).toHaveBeenCalledTimes(1);
    const row = logAction.mock.calls[0][0];
    expect(row.action).toBe('parent_portal.password_reset');
    expect(row.entityType).toBe('parent_portal');
    expect(row.entityId).toBe(PARENT.id);
    expect(row.context.email).toBe(PARENT.email);
    expect(JSON.stringify(row)).not.toContain(good.password);
  });

  it('does not answer with the password', async () => {
    const res = await postPassword(post('accounts/password', good));
    expect(JSON.stringify(await res.json())).not.toContain(good.password);
  });

  it('reports a failed update and logs nothing', async () => {
    updateUserById.mockResolvedValueOnce({
      error: { message: 'auth is down' },
    });
    const res = await postPassword(post('accounts/password', good));
    expect(res.status).toBe(500);
    expect(logAction).not.toHaveBeenCalled();
  });
});

describe('POST accounts', () => {
  it.each(['school_admin', 'academic_coordinator', 'admissions', 'teacher'])(
    'gives 403 to %s and creates nothing',
    async (role) => {
      callerRole = role;
      const res = await postAccount(post('accounts', NEW_ACCOUNT));
      expect(res.status).toBe(403);
      expect(createUser).not.toHaveBeenCalled();
    }
  );

  it('gives 400 for a password under 8 characters', async () => {
    const res = await postAccount(
      post('accounts', { ...NEW_ACCOUNT, password: 'short' })
    );
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('gives 400 for a relationship other than mother or father', async () => {
    const res = await postAccount(
      post('accounts', { ...NEW_ACCOUNT, relationship: 'guardian' })
    );
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('answers 409 with the existing parent account, creating nothing', async () => {
    const res = await postAccount(
      post('accounts', { ...NEW_ACCOUNT, email: 'MEI.TAN@example.com' })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing).toEqual({
      email: PARENT.email,
      fullName: 'Tan, Mei',
      relationship: 'mother',
      emailConfirmed: true,
      lastSignInAt: PARENT.last_sign_in_at,
      createdAt: PARENT.created_at,
      isStaff: false,
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('says so when the existing account is a staff account', async () => {
    const res = await postAccount(
      post('accounts', { ...NEW_ACCOUNT, email: STAFF.email })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing.isStaff).toBe(true);
    expect(body.existing.fullName).toBe('Ms Lhen');
    expect(body.error).toContain('staff account');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates a confirmed parent account with no staff role', async () => {
    const res = await postAccount(post('accounts', NEW_ACCOUNT));
    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledTimes(1);
    const attrs = createUser.mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(attrs.email).toBe('new.parent@example.com');
    expect(attrs.password).toBe(NEW_ACCOUNT.password);
    expect(attrs.email_confirm).toBe(true);
    expect(attrs.user_metadata).toEqual({
      fullName: 'Tan, Mei',
      relationship: 'mother',
      password_changed: false,
      temporary_password: NEW_ACCOUNT.password,
    });
    expect(attrs).not.toHaveProperty('app_metadata');
    expect(await res.json()).toEqual({
      ok: true,
      account: {
        email: 'new.parent@example.com',
        fullName: 'Tan, Mei',
        relationship: 'mother',
      },
    });
  });

  it('logs the new account with no password anywhere in the row', async () => {
    await postAccount(post('accounts', NEW_ACCOUNT));
    expect(logAction).toHaveBeenCalledTimes(1);
    const row = logAction.mock.calls[0][0];
    expect(row.action).toBe('parent_portal.account_create');
    expect(row.entityType).toBe('parent_portal');
    expect(row.entityId).toBe('new-new.parent@example.com');
    expect(JSON.stringify(row)).not.toContain(NEW_ACCOUNT.password);
  });

  it('reports a failed create and logs nothing', async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'auth is down' },
    });
    const res = await postAccount(post('accounts', NEW_ACCOUNT));
    expect(res.status).toBe(500);
    expect(logAction).not.toHaveBeenCalled();
  });
});

describe('listParentAccounts', () => {
  it('drops every account with a role and sorts the rest by name', async () => {
    users = [
      { ...PARENT, id: 'p-z', user_metadata: { fullName: 'Zhang, Li' } },
      STAFF,
      STAFF_TWO_ROLES,
      PARENT,
    ];
    const out = await listParentAccounts(service as never);
    expect(out.map((a) => a.id)).toEqual(['parent-1', 'p-z']);
    expect(out[0]).toEqual({
      id: 'parent-1',
      email: PARENT.email,
      fullName: 'Tan, Mei',
      relationship: 'mother',
      emailConfirmed: true,
      lastSignInAt: PARENT.last_sign_in_at,
    });
  });

  it('never carries the temporary password out of the account', async () => {
    users = [
      {
        ...PARENT,
        user_metadata: {
          ...PARENT.user_metadata,
          temporary_password: 'Leak3d!pw',
        },
      },
    ];
    const out = await listParentAccounts(service as never);
    expect(JSON.stringify(out)).not.toContain('Leak3d!pw');
  });
});

describe('the audit log wording', () => {
  it('names each action and summarises its context in plain words', () => {
    expect(auditActionLabel('parent_portal.password_reset')).toBe(
      'Parent password reset'
    );
    expect(
      auditContextSummary('parent_portal.password_reset', {
        email: 'mei.tan@example.com',
        display_name: 'Tan, Mei',
      })
    ).toBe('Tan, Mei (mei.tan@example.com)');
    expect(
      auditContextSummary('parent_portal.account_create', {
        email: 'mei.tan@example.com',
        display_name: 'Tan, Mei',
        relationship: 'mother',
      })
    ).toBe('Tan, Mei (mei.tan@example.com) · Mother');
    expect(
      auditContextSummary('parent_portal.recovery_link_create', {
        student_name: 'Tan, Wei',
        enrolee_number: 'E270012',
        sent_to: ['mei.tan@example.com'],
      })
    ).toBe('Tan, Wei · E270012 · Sent to mei.tan@example.com');
    expect(
      auditContextSummary('parent_portal.application_transfer', {
        student_name: 'Tan, Wei',
        source_ay: 'AY2026',
        target_ay: 'AY2027',
        old_enrolee_number: 'E260012',
        new_enrolee_number: 'E270045',
        old_student_number: 'H260012',
        new_student_number: 'H260012',
      })
    ).toBe('Tan, Wei · AY2026 → AY2027 · E260012 → E270045');
  });
});

describe('generateTemporaryPassword', () => {
  it('is 14 characters with one of each kind, drawn from the portal list', () => {
    for (let i = 0; i < 200; i += 1) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(14);
      expect(p).toMatch(/[abcdefghijkmnopqrstuvwxyz]/);
      expect(p).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ]/);
      expect(p).toMatch(/[23456789]/);
      expect(p).toMatch(/[!@#$%^&*]/);
      expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9!@#$%^&*]+$/);
    }
  });
});
