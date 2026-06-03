import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getRoleFromClaims, isRouteAllowed } from '@/lib/auth/roles';

const PUBLIC_PATHS = ['/login', '/api/auth/callback'];

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

    if (role === null) {
      // Null-role Supabase session — force re-authentication.
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
    // the proxy on them only adds auth-gate latency to every fetch. Cross-origin
    // CORS for the parent portal is set per-route via lib/cors.ts (the only
    // /api routes called cross-origin are app/api/parent/v2/*).
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
