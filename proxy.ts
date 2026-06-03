import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getRoleFromClaims, isRouteAllowed } from '@/lib/auth/roles';

const PUBLIC_PATHS = ['/login', '/api/auth/callback'];

// Cross-origin callers allowed to hit the SIS /api — the parent/admissions
// portal. Compared exactly against the request Origin header, which never
// carries a trailing slash, so neither must these (the env var is stripped
// defensively in case it's configured with one).
const allowedOrigins = [
  process.env.ADMISSIONS_PORTAL_ORIGIN?.replace(/\/$/, ''),
  'http://localhost:5173',
  'https://online-admission-staging.vercel.app',
].filter((o): o is string => Boolean(o));

// Reflect the caller's origin (credentialed requests require an exact origin,
// never '*') and allow cookies; Vary: Origin stops a shared cache from serving
// one origin's CORS header to another.
function applyCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.append('Vary', 'Origin');
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes authenticate themselves per-handler (requireRole), so the proxy
  // does NOT run the Supabase session refresh on /api — it only attaches CORS
  // for the cross-origin portal and answers OPTIONS preflight. Preserves the
  // original "no auth-gate latency on every fetch" property.
  if (pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      const preflight = new NextResponse(null, { status: 204 });
      preflight.headers.set(
        'Access-Control-Allow-Methods',
        'GET,DELETE,PATCH,POST,PUT,OPTIONS'
      );
      preflight.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With'
      );
      preflight.headers.set('Access-Control-Max-Age', '86400');
      return applyCors(request, preflight);
    }
    return applyCors(request, NextResponse.next());
  }

  const { response, claims } = await updateSession(request);

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
    // Skip Next internals + static assets. /api/* IS matched (it used to be
    // skipped) so the proxy can attach CORS for the cross-origin portal — but
    // the /api branch short-circuits before the Supabase auth/session refresh,
    // so API routes still authenticate themselves with no added gate latency.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
