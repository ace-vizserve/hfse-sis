import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
import { getRoleFromClaims, isRouteAllowed } from '@/lib/auth/roles';

/**
 * Reachable without a session. Everything else needs one.
 *
 * ⚠ `/change-requests/act` is here for a real reason, not as a convenience.
 * It is the one-click approve / reject page an approver opens straight from an
 * email (KD #123), usually on a phone, usually logged out. Trust comes from the
 * signed action token in the URL, not from a cookie. Send it to `/login` and
 * the whole email approval flow dies silently — the approver lands on a login
 * screen with no idea why.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/callback', '/change-requests/act'];

export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (claims && pathname === '/login') {
    const role = getRoleFromClaims(claims);
    if (role === null) {
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  if (claims) {
    const role = getRoleFromClaims(claims);

    // ⚠ A session with no role is a PARENT, not a staff member with a missing
    // grant — parents are role-less by design (KD #195), and there is no
    // parent surface inside this app. Waving them through on "they have a
    // user" would render staff pages to them; RLS would starve the data, but
    // the page would still be there. Force re-authentication instead.
    if (role === null) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    // Staff user — the role-based route gate. This is the only place
    // `isRouteAllowed` is ENFORCED; every other caller uses it to decide what
    // to SHOW (sidebar, command palette, account shortcuts). Remove it here
    // and all 28 ROUTE_ACCESS rules become decoration.
    if (!isRouteAllowed(pathname, role)) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // ⚠ `api` MUST stay in this exclusion list, for correctness before speed.
    //
    // API routes authenticate themselves — `createClient()` + `requireRole()`
    // in each handler — so running the proxy over them adds a second JWT
    // verification to every fetch for nothing.
    //
    // Worse, the proxy is COOKIE-based and the parent portal is not: it calls
    // `/api/parent/v2/*` cross-origin with a Bearer token and no cookie. With
    // `api` removed from this list the proxy sees no session and redirects,
    // and Next serves the login PAGE — so a filing POST returns **200 with
    // HTML**, `res.ok` is true, and the portal reports success while nothing
    // is recorded. The CORS preflight gets a 307 and the browser blocks it
    // outright. Measured, not theorised, on 2026-08-29.
    //
    // Cross-origin CORS for those routes is set per-route via lib/cors.ts.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
