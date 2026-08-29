import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getRoleFromClaims, isRouteAllowed } from '@/lib/auth/roles';

/**
 * Everything the proxy does: refresh the Supabase session, then decide whether
 * this request may continue. `proxy.ts` holds only the entry point and the
 * matcher.
 */

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

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // With Fluid compute, never hold this client in a module-level variable —
  // build a fresh one per request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // ⚠ Do not put code between `createServerClient` and `getClaims()`. A mistake
  // here is very hard to debug — it shows up as users being logged out at
  // random.
  //
  // `getClaims()` rather than `getUser()` avoids a network round-trip to
  // Supabase Auth on every navigation: it verifies the JWT signature locally
  // against the cached JWKS. (Requires asymmetric signing keys; it falls back
  // to `getUser()` internally on legacy HS256 projects.)
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    return NextResponse.redirect(url);
  };

  if (!claims && !isPublic) return redirectTo('/login');

  if (claims) {
    const role = getRoleFromClaims(claims);

    if (pathname === '/login') {
      // A role-less session on the login page is left alone — see below.
      return role === null ? supabaseResponse : redirectTo('/');
    }

    // ⚠ A session with no role is a PARENT, not a staff member with a missing
    // grant — parents are role-less by design (KD #195), and there is no
    // parent surface inside this app. Waving them through on "they have a
    // user" would render staff pages to them; RLS would starve the data, but
    // the page would still be there. Force re-authentication instead.
    if (role === null) return redirectTo('/login');

    // The role-based route gate. ⚠ This is the ONLY place `isRouteAllowed` is
    // ENFORCED; every other caller uses it to decide what to SHOW (sidebar,
    // command palette, account shortcuts). Remove it here and all 28
    // ROUTE_ACCESS rules become decoration.
    if (!isRouteAllowed(pathname, role)) return redirectTo('/');
  }

  // ⚠ Return this response object as it is. If you build a new one, pass the
  // request into `NextResponse.next({ request })` and copy the cookies across,
  // or the browser and server fall out of sync and sessions end early.
  return supabaseResponse;
}
