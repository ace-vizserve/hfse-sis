import { NextResponse, type NextRequest } from 'next/server';

import { ACTIVE_ROLE_COOKIE } from '@/lib/auth/active-role';
import {
  DEFAULT_SWITCH_DESTINATION,
  safeInAppPath,
} from '@/lib/auth/in-app-path';
import type { Role } from '@/lib/auth/roles';
import { getViewContext } from '@/lib/auth/view-context';

// POST /api/account/active-role   body: { role: Role, next?: string }
//
// Switches which lens the viewer sees the app through — see
// lib/auth/active-role.ts for the rule, and for why `activeRole` renders while
// `role` still authorises.
//
// ⚠ `next` NARROWS THE "ALWAYS GO TO `/`" RULE — IT DOES NOT REVERSE IT.
// Mr Ace's original instruction stands for the profile popover: switching
// lenses while deep inside a page that belongs to the OTHER job can strand
// you, and `/` is coherent in either view. The one place that is wrong is the
// "not one of your classes" notice, where the viewer is being told to switch
// BECAUSE of the page they are on — bouncing them to `/` there would make them
// find their way back to a page they had already reached. So a request with no
// `next` behaves exactly as before, and the response shape is unchanged for it.
//
// ⚠ AND `next` IS AN OPEN-REDIRECT SURFACE. It is a destination chosen by the
// client, so it is validated HERE, server-side, and the caller is expected to
// navigate to the value this route echoes back rather than to its own input —
// that is what makes the server the authority rather than a second opinion.
// The check itself lives in lib/auth/in-app-path.ts with its own tests.
//
// A `next` that fails the check is dropped to `/` rather than 400'd: the
// SWITCH is valid and should still happen, and refusing it would leave the
// viewer stuck in the view they are trying to leave — a worse outcome than a
// slightly surprising landing page, and one an attacker could trigger
// deliberately.
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
  const requestedNext = (body as { next?: unknown } | null)?.next;

  if (!parsed || typeof requested !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!view.entitled.includes(requested as Role)) {
    return NextResponse.json({ error: 'not_entitled' }, { status: 400 });
  }

  // Absent `next` keeps the original response shape byte for byte, which is
  // what the profile popover and `__tests__/auth/active-role-route.test.ts`
  // both already expect. Only a caller that ASKED for a destination is told
  // about one.
  const destination =
    requestedNext === undefined
      ? null
      : (safeInAppPath(requestedNext) ?? DEFAULT_SWITCH_DESTINATION);

  const response = NextResponse.json(
    destination === null
      ? { activeRole: requested }
      : { activeRole: requested, next: destination }
  );
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
