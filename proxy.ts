import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getRoleFromClaims, isRouteAllowed } from '@/lib/auth/roles';

// `/parent` covers the entire parent module (including the SSO handoff
// at `/parent/enter`). Parents authenticate via the HMAC-signed
// `parent_session` cookie set by /api/parent/handoff — they don't have
// Supabase JWT claims here, so we bypass the proxy's claim-based
// redirects and let the parent layout enforce its own cookie check.
const PUBLIC_PATHS = ['/login', '/api/auth/callback', '/parent'];

export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (claims && pathname === '/login') {
    const role = getRoleFromClaims(claims);
    // Null-role Supabase sessions are anomalies under the parent-cookie
    // design (parents authenticate via parent_session, not Supabase). If
    // someone lands on /login with a stale null-role JWT, let them sign
    // in fresh rather than bouncing them into a dead-end loop.
    if (role === null) {
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  if (claims) {
    const role = getRoleFromClaims(claims);

    // /parent/* is fully cookie-gated (parent_session). Skip Supabase
    // claim checks here so the parent SSO handoff can complete even if
    // the visitor has a stale null-role JWT in their browser. The
    // parent layout enforces its own cookie + role checks.
    const isParentArea = pathname === '/parent' || pathname.startsWith('/parent/');
    if (isParentArea) {
      return response;
    }

    if (role === null) {
      // Null-role Supabase session outside the parent area = stale
      // session (e.g. left over from the pre-cookie parent flow that
      // used setSession). Force re-authentication so the JWT picks up
      // an actual role and the user isn't stuck in a redirect loop.
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    // Staff user — existing role-based route gate.
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
    // Skip Next internals, static assets, and /api/*. API routes authenticate
    // themselves via createClient() + requireRole() in each handler; running
    // the proxy on them only adds auth-gate latency to every fetch.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
