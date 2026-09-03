/**
 * POST /api/account/active-role — the entitlement recomputation.
 *
 * This handler is the only security-relevant server code in the role switcher:
 * it is the one place a value chosen by the VIEWER is turned into stored state,
 * and what it stores is the role that AUTHORISES every subsequent request.
 * Everything else in the feature is pure, or reads.
 *
 * ⚠ WHAT IS MOCKED, AND WHY IT STOPS ONE FILE SHORT OF THE ROUTE.
 * The entitled set is NOT stubbed. Stubbing it would leave the test asserting
 * that the route checks a list handed to it, which is the easy half. The claim
 * worth pinning is that the list is DERIVED PER REQUEST from the account
 * itself, so the mocks sit one layer further down — the session and the Auth
 * admin API — and the real rule (`getUserRoleSet`) runs.
 *
 * ⚠ AND THE ACCOUNT IS READ FRESH, NOT TAKEN FROM THE SESSION. The JWT can be
 * an hour old, so a role granted or removed since is not in it. Several tests
 * below pin that direction explicitly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: () => getSessionUserMock(),
}));

// The Auth admin API — the read that decides entitlement and the write that
// performs the switch.
const getUserByIdMock = vi.fn();
const updateUserByIdMock = vi.fn();
const serviceClient = {
  auth: {
    admin: {
      getUserById: (...args: unknown[]) => getUserByIdMock(...args),
      updateUserById: (...args: unknown[]) => updateUserByIdMock(...args),
    },
  },
};
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => serviceClient,
}));

const logActionMock = vi.fn();
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...args: unknown[]) => logActionMock(...args),
}));

import { POST } from '@/app/api/account/active-role/route';

function post(body: unknown, raw?: string) {
  return new Request('http://localhost/api/account/active-role', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  }) as never;
}

/** Puts an account behind the Auth admin read, in the stored metadata shape. */
function accountHolds(appMetadata: Record<string, unknown>) {
  getUserByIdMock.mockResolvedValue({
    data: { user: { id: 'user-1', app_metadata: appMetadata } },
    error: null,
  });
}

/** The case the whole feature exists for: an admin who also teaches. */
function signedInAsTeachingAdmin() {
  getSessionUserMock.mockResolvedValue({
    id: 'user-1',
    email: 'admin@hfse.test',
    role: 'school_admin',
    roles: ['school_admin', 'teacher'],
  });
  accountHolds({
    role: ['school_admin', 'teacher'],
    active_role: 'school_admin',
  });
}

/** An account that holds one role — 38 of the 44, and every one before an edit. */
function signedInAsSingleRoleAdmin() {
  getSessionUserMock.mockResolvedValue({
    id: 'user-1',
    email: 'admin@hfse.test',
    role: 'school_admin',
    roles: ['school_admin'],
  });
  accountHolds({ role: 'school_admin' });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserByIdMock.mockResolvedValue({ data: {}, error: null });
});

describe('POST /api/account/active-role', () => {
  it('accepts a role the account holds and stores it as the active one', async () => {
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'teacher' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ role: 'teacher' });

    expect(updateUserByIdMock).toHaveBeenCalledTimes(1);
    const [userId, updates] = updateUserByIdMock.mock.calls[0] as [
      string,
      { app_metadata: Record<string, unknown> },
    ];
    expect(userId).toBe('user-1');
    expect(updates.app_metadata.active_role).toBe('teacher');
    // ⚠ THE ROLE LIST SURVIVES THE WRITE. `updateUserById` REPLACES
    // `app_metadata` wholesale, so spreading the stored object is the only
    // thing standing between a role switch and an account losing every role it
    // holds — which would read as a parent app-wide and lock the person out.
    expect(updates.app_metadata.role).toEqual(['school_admin', 'teacher']);
  });

  it('refuses a role the account does not hold, and writes nothing', async () => {
    // A single-role admin asking for the teacher role. Teaching work no longer
    // implies the role — an account holds it or it does not.
    signedInAsSingleRoleAdmin();

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('recomputes entitlement from the account, never from the body', async () => {
    // The escalation attempt this route exists to refuse: a school_admin asking
    // to become superadmin. Nothing in the body can widen the set, and the
    // proof it was DERIVED is that the account read was made for the session's
    // own user id.
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'superadmin' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(getUserByIdMock).toHaveBeenCalledWith('user-1');
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('reads the account, not the session, so a fresh grant works immediately', async () => {
    // The session's JWT is up to an hour old and still says one role. The
    // account was granted a second one a minute ago. Waiting out the token
    // would make the switcher look broken to the person who was just told
    // their new role was ready.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
      roles: ['school_admin'],
    });
    accountHolds({
      role: ['school_admin', 'teacher'],
      active_role: 'school_admin',
    });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(200);
    expect(updateUserByIdMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a role removed since the token was minted', async () => {
    // The same staleness in the other direction, which is the direction that
    // matters for access: the token still lists a role the account no longer
    // holds, and the switch must not resurrect it.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
      roles: ['school_admin', 'teacher'],
    });
    accountHolds({ role: ['school_admin'], active_role: 'school_admin' });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('lets an account that stores a single role string re-pick that role', async () => {
    // No backfill ran, so `role` is still a plain string on every account that
    // has not been edited. The set is one entry, and it resolves.
    signedInAsSingleRoleAdmin();

    const res = await POST(post({ role: 'school_admin' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'school_admin' });
  });

  it('refuses a parent, who holds no role at all', async () => {
    // Parents share this Supabase project, so `role: null` reaches this route.
    getSessionUserMock.mockResolvedValue({
      id: 'parent-1',
      email: 'parent@hfse.test',
      role: null,
      roles: [],
    });
    getUserByIdMock.mockResolvedValue({
      data: { user: { id: 'parent-1', app_metadata: {} } },
      error: null,
    });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('401s when there is no session', async () => {
    getSessionUserMock.mockResolvedValue(null);

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('401s when the account cannot be read', async () => {
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
      roles: ['school_admin', 'teacher'],
    });
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'x' } });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(401);
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of claiming the switch happened', async () => {
    // The client refreshes its session on a 200. Reporting success on a write
    // that did not land would send it to fetch a token identical to the one it
    // has, and the app would look frozen in the old role with no explanation.
    signedInAsTeachingAdmin();
    updateUserByIdMock.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'switch_failed' });
    expect(logActionMock).not.toHaveBeenCalled();
  });

  // ── The switch itself is an audit event (migration 141) ─────────────────
  //
  // Mr Ace's reason for wanting the actor's role recorded at all: "best for
  // audit trail as well since they switched roles." This entry is what makes
  // the rest legible — the marks entered at 09:20 read differently once the
  // log says the person moved into the Teacher role at 09:14.

  it('logs the switch with both roles and the role it was made from', async () => {
    signedInAsTeachingAdmin();

    await POST(post({ role: 'teacher' }));

    expect(logActionMock).toHaveBeenCalledTimes(1);
    const entry = logActionMock.mock.calls[0][0] as {
      service: unknown;
      actor: { id: string; email: string; role: string | null };
      action: string;
      entityType: string;
      entityId: string;
      context: Record<string, unknown>;
    };
    expect(entry.action).toBe('user.view.switch');
    expect(entry.entityType).toBe('user_account');
    expect(entry.entityId).toBe('user-1');
    expect(entry.service).toBe(serviceClient);
    // The role she was working in when she asked — the row is written before
    // the new one is in anybody's token, and stamping it with the role she is
    // moving TO would misdate the change.
    expect(entry.actor).toEqual({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
    });
    expect(entry.context).toEqual({
      from_view: 'school_admin',
      to_view: 'teacher',
    });
  });

  it('records the role stored on the ACCOUNT as the one left', async () => {
    // Not the session's copy of it, which can be an hour behind. The log has to
    // say what the person was actually working as.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'teacher',
      roles: ['school_admin', 'teacher'],
    });
    accountHolds({
      role: ['school_admin', 'teacher'],
      active_role: 'school_admin',
    });

    await POST(post({ role: 'teacher' }));

    const entry = logActionMock.mock.calls[0][0] as {
      context: Record<string, unknown>;
    };
    expect(entry.context.from_view).toBe('school_admin');
  });

  it('writes nothing when the switch is refused', async () => {
    // A refused request is not a switch. Logging it would put an event in an
    // append-only table for something that did not happen.
    signedInAsSingleRoleAdmin();

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('writes nothing when there is no session and nothing for a bad body', async () => {
    getSessionUserMock.mockResolvedValue(null);
    await POST(post({ role: 'teacher' }));
    expect(logActionMock).not.toHaveBeenCalled();

    signedInAsTeachingAdmin();
    await POST(post(null, 'not json at all'));
    expect(logActionMock).not.toHaveBeenCalled();
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it('tells a malformed body apart from an unentitled one', async () => {
    // Two different 400s on purpose: "you do not have that role" is something
    // to show a person; a body that did not parse is a bug in the caller.
    signedInAsTeachingAdmin();

    const unparseable = await POST(post(null, 'not json at all'));
    expect(unparseable.status).toBe(400);
    expect(await unparseable.json()).toEqual({ error: 'invalid_body' });

    const wrongShape = await POST(post({ role: 42 }));
    expect(await wrongShape.json()).toEqual({ error: 'invalid_body' });

    const empty = await POST(post({}));
    expect(await empty.json()).toEqual({ error: 'invalid_body' });
  });
});

/**
 * ⚠ THE ROUTE TAKES NO DESTINATION, AND THAT IS THE ABSENCE BEING PINNED.
 *
 * An earlier design accepted a client-supplied `next` so the "wrong view"
 * notice could return the viewer to the page they were on. That notice is gone
 * — a switch is a real role change now, so there is no mismatched lens left to
 * explain — and with it went an open-redirect surface. A `next` in the body is
 * ignored: the response says only which role is in force, and the client always
 * lands on `/`.
 */
describe('POST /api/account/active-role — no destination is accepted', () => {
  it('answers with the role alone', async () => {
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'teacher' });
  });

  it('ignores a destination rather than echoing one back', async () => {
    signedInAsTeachingAdmin();

    const res = await POST(
      post({ role: 'teacher', next: 'https://evil.example/steal' })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'teacher' });
    expect(body).not.toHaveProperty('next');
  });

  it('still checks entitlement when a destination is sent', async () => {
    signedInAsSingleRoleAdmin();

    const res = await POST(post({ role: 'teacher', next: '/classroom/sec-1' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });
});
