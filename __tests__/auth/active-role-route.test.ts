/**
 * POST /api/account/active-role — the entitlement recomputation.
 *
 * This handler is the only security-relevant server code in the role-switcher
 * foundation: it is the one place a value chosen by the VIEWER is turned into
 * stored state. Everything else in the phase is pure, or reads.
 *
 * ⚠ WHAT IS MOCKED, AND WHY IT STOPS ONE FILE SHORT OF THE ROUTE.
 * `getViewContext` is deliberately NOT mocked. Stubbing it would leave the test
 * asserting that the route checks a list handed to it, which is the easy half.
 * The claim worth pinning is that the list is DERIVED PER REQUEST from the
 * session and the assignments table, so the mocks sit one layer further down —
 * the session (`getSessionUser`), the assignments read, and the cookie jar —
 * and the real entitlement rule runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: () => getSessionUserMock(),
}));

const assignmentsMock = vi.fn();
vi.mock('@/lib/auth/assignments-cache', () => ({
  loadEffectiveAssignmentsForUserMemo: (...args: unknown[]) =>
    assignmentsMock(...args),
}));

// The request's cookie jar. Only the read side is needed — the route writes its
// cookie onto the RESPONSE, which is what the assertions below inspect.
const incomingCookie: { value: string | undefined } = { value: undefined };
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'hfse_active_role' && incomingCookie.value !== undefined
        ? { name, value: incomingCookie.value }
        : undefined,
  }),
}));

// The audit write. `createServiceClient()` reads env vars that are not set
// under vitest and throws without them, so the module is stubbed; `logAction`
// is stubbed alongside it so the switch entry can be asserted on directly.
const serviceClient = { __service: true };
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => serviceClient,
}));

const logActionMock = vi.fn();
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...args: unknown[]) => logActionMock(...args),
}));

import { POST } from '@/app/api/account/active-role/route';
import { ACTIVE_ROLE_COOKIE } from '@/lib/auth/active-role';

/** One assignment row — only its presence matters to entitlement. */
const ONE_ASSIGNMENT = [
  { id: 'ta-1', section_id: 'sec-1', role: 'form_adviser' },
];

function post(body: unknown, raw?: string) {
  return new Request('http://localhost/api/account/active-role', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  }) as never;
}

/** The six live school_admin accounts that also teach — the whole reason for this. */
function signedInAsTeachingAdmin() {
  getSessionUserMock.mockResolvedValue({
    id: 'user-1',
    email: 'admin@hfse.test',
    role: 'school_admin',
  });
  assignmentsMock.mockResolvedValue(ONE_ASSIGNMENT);
}

beforeEach(() => {
  vi.clearAllMocks();
  incomingCookie.value = undefined;
});

describe('POST /api/account/active-role', () => {
  it('accepts an entitled role and sets the cookie', async () => {
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'teacher' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ activeRole: 'teacher' });

    const cookie = res.cookies.get(ACTIVE_ROLE_COOKIE);
    expect(cookie?.value).toBe('teacher');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    // A year — the switcher is for people who do two jobs, and re-picking the
    // view every morning would be friction aimed at exactly those users.
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 365);
  });

  it('rejects a role the caller is not entitled to, and sets nothing', async () => {
    // Same account, no assignment rows — so no teacher lens is earned.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
    });
    assignmentsMock.mockResolvedValue([]);

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(res.cookies.get(ACTIVE_ROLE_COOKIE)).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('recomputes entitlement from the session, never from the body', async () => {
    // The escalation attempt this route exists to refuse: a school_admin asking
    // to be seen as superadmin. Nothing in the body can widen the set, and the
    // proof it was DERIVED is that the assignments read was made for the
    // session's own user id.
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'superadmin' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(assignmentsMock).toHaveBeenCalledWith('user-1');
    expect(res.cookies.get(ACTIVE_ROLE_COOKIE)).toBeUndefined();
  });

  it('ignores an incoming cookie when deciding what the caller may have', async () => {
    // A hand-edited cookie must not become entitlement by being read back.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
    });
    assignmentsMock.mockResolvedValue([]);
    incomingCookie.value = 'superadmin';

    const res = await POST(post({ role: 'superadmin' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
  });

  it('lets a plain teacher pick their own view without an assignments read', async () => {
    // `getEntitledRoles` short-circuits for teachers, so the query never runs —
    // the skip that keeps this free for the largest group of staff accounts.
    getSessionUserMock.mockResolvedValue({
      id: 'user-2',
      email: 'teacher@hfse.test',
      role: 'teacher',
    });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(200);
    expect(res.cookies.get(ACTIVE_ROLE_COOKIE)?.value).toBe('teacher');
    expect(assignmentsMock).not.toHaveBeenCalled();
  });

  it('refuses a parent, who has no staff lens at all', async () => {
    // Parents share this Supabase project, so `role: null` reaches this route.
    getSessionUserMock.mockResolvedValue({
      id: 'parent-1',
      email: 'parent@hfse.test',
      role: null,
    });

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
  });

  it('401s when there is no session', async () => {
    getSessionUserMock.mockResolvedValue(null);

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  // ── The switch itself is an audit event (migration 141) ─────────────────
  //
  // Mr Ace's reason for wanting the actor's role recorded at all: "best for
  // audit trail as well since they switched roles." This entry is what makes
  // the rest legible — the marks entered at 09:20 read differently once the
  // log says the person moved into the Teacher view at 09:14.

  it('logs the view switch with both views and the account role', async () => {
    signedInAsTeachingAdmin();
    incomingCookie.value = 'school_admin';

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
    // The account's REAL role, not the view — the view is the thing that
    // changed and it is in the context, on both sides.
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

  it('records the RESOLVED lens as the view left, not the raw cookie', async () => {
    // A cookie naming a view the account no longer earns was never what the
    // person was looking at — `resolveActiveRole` had already been ignoring
    // it — so the log must say what they actually saw.
    signedInAsTeachingAdmin();
    incomingCookie.value = 'superadmin';

    await POST(post({ role: 'teacher' }));

    const entry = logActionMock.mock.calls[0][0] as {
      context: Record<string, unknown>;
    };
    expect(entry.context.from_view).not.toBe('superadmin');
    expect(entry.context.from_view).toBe('school_admin');
  });

  it('writes nothing when the switch is refused', async () => {
    // A refused request is not a switch. Logging it would put an event in an
    // append-only table for something that did not happen.
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@hfse.test',
      role: 'school_admin',
    });
    assignmentsMock.mockResolvedValue([]);

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
  });

  it('tells a malformed body apart from an unentitled one', async () => {
    // Two different 400s on purpose: "you may not use that view" is something
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
 * The `next` destination — added so the wrong-view notice can return the
 * viewer to the page they were already on instead of dumping them at `/`.
 *
 * `lib/auth/in-app-path.ts` has the exhaustive attack table
 * (`__tests__/auth/in-app-path.test.ts`); what is asserted HERE is that the
 * route actually applies it, that it applies it to the value the CLIENT sent,
 * and that the switch still succeeds when the destination is refused.
 */
describe('POST /api/account/active-role — the destination', () => {
  it('says nothing about a destination when none was asked for', async () => {
    // The profile popover sends no `next` and still lands on `/`. The response
    // shape for it is unchanged, which is what keeps the "always go to `/`"
    // rule intact everywhere except the one surface that opted out.
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'teacher' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeRole: 'teacher' });
  });

  it('echoes back an in-app destination, query string included', async () => {
    signedInAsTeachingAdmin();

    const res = await POST(
      post({ role: 'teacher', next: '/attendance/sec-1?term_id=t2' })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      activeRole: 'teacher',
      next: '/attendance/sec-1?term_id=t2',
    });
  });

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example'],
    ['the backslash spelling of one', '/\\evil.example'],
    [
      'a scheme behind a stripped tab',
      `/${String.fromCharCode(9)}https://evil.example`,
    ],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'classroom'],
    ['a non-string', 42],
  ])('refuses %s and sends them to / instead', async (_label, next) => {
    signedInAsTeachingAdmin();

    const res = await POST(post({ role: 'teacher', next }));

    // 200, not 400, and deliberately: the SWITCH is legitimate. Refusing it
    // would strand the viewer in the view they are trying to leave — an
    // outcome an attacker could trigger on purpose — so the destination is
    // dropped to `/` and the switch goes through.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeRole: 'teacher', next: '/' });
    expect(res.cookies.get(ACTIVE_ROLE_COOKIE)?.value).toBe('teacher');
  });

  it('checks entitlement before it ever looks at the destination', async () => {
    // A destination must not become a way to make an unentitled switch look
    // like it did something.
    getSessionUserMock.mockResolvedValue({
      id: 'admin-2',
      email: 'admin2@hfse.test',
      role: 'school_admin',
    });
    assignmentsMock.mockResolvedValue([]); // teaches nothing → no teacher lens

    const res = await POST(post({ role: 'teacher', next: '/classroom/sec-1' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
    expect(res.cookies.get(ACTIVE_ROLE_COOKIE)?.value).toBeUndefined();
  });
});
