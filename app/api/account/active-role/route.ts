import { NextResponse, type NextRequest } from 'next/server';

import { ACTIVE_ROLE_COOKIE } from '@/lib/auth/active-role';
import type { Role } from '@/lib/auth/roles';
import { getViewContext } from '@/lib/auth/view-context';

// POST /api/account/active-role   body: { role: Role }
//
// Switches which lens the viewer sees the app through — see
// lib/auth/active-role.ts for the rule, and for why `activeRole` renders while
// `role` still authorises. Nothing consumes the lens yet; this is the writer
// half of the foundation.
//
// ⚠ NO `requireRole` HERE, and that is not an oversight. Every other route
// gates on "is your role in this list"; the gate here is narrower than any
// list could be — the requested value must be in the CALLER'S OWN entitled
// set, recomputed server-side by `getViewContext`. A `requireRole` in front of
// it would admit exactly the same people and read as though it were doing the
// work, when the entitlement check below is what actually decides.
//
// ⚠ THE BODY IS A REQUEST, NOT A GRANT. It is checked against entitlement that
// this request derived from the session JWT and the assignments table; nothing
// the client sends can widen it. `resolveActiveRole` re-checks on every read
// too, so even a cookie written here stops working the moment the account
// stops earning it.
export async function POST(request: NextRequest) {
  const view = await getViewContext();
  if (!view) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // A malformed or absent body is a bad request, not a crash — and a DIFFERENT
  // bad request from an unentitled one. The two are split because the switcher
  // will render the answer: "you may not use that view" is something to show a
  // person, while a body that did not parse is a bug in the caller.
  let body: unknown = null;
  let parsed = true;
  try {
    body = await request.json();
  } catch {
    parsed = false;
  }
  const requested = (body as { role?: unknown } | null)?.role;

  if (!parsed || typeof requested !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!view.entitled.includes(requested as Role)) {
    return NextResponse.json({ error: 'not_entitled' }, { status: 400 });
  }

  const response = NextResponse.json({ activeRole: requested });
  response.cookies.set(ACTIVE_ROLE_COOKIE, requested, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // A YEAR, not a session cookie. The switcher exists for the people who do
    // two jobs, and making a teaching admin re-pick their view every morning
    // would be friction aimed at exactly the users it was built for. Losing the
    // choice is not a risk worth guarding against either: the active view is
    // always on show in the profile popover, and `resolveActiveRole` re-checks
    // the value against entitlement on every single request, so a stale cookie
    // can only ever resolve to a lens the account still earns.
    maxAge: 60 * 60 * 24 * 365,
    // Plain HTTP in local dev would drop a `secure` cookie silently, so this is
    // conditional rather than unconditional.
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
