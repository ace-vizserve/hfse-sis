import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getUserRole, isRouteAllowed } from '@/lib/auth/roles';

const PUBLIC_PATHS = ['/login', '/api/auth/callback', '/parent/enter'];

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    const role = getUserRole(user);
    url.pathname = role === null ? '/parent' : '/';
    return NextResponse.redirect(url);
  }

  if (user) {
    const role = getUserRole(user);
    if (role === null) {
      // Parent user (no staff role in app_metadata.role). Only /parent/*,
      // /account, and /login are allowed. Everything else redirects to /parent.
      const isParentPath =
        pathname === '/parent' ||
        pathname.startsWith('/parent/') ||
        pathname === '/account' ||
        pathname === '/login';
      if (!isParentPath) {
        const url = request.nextUrl.clone();
        url.pathname = '/parent';
        return NextResponse.redirect(url);
      }
    } else {
      // Staff user — existing role-based route gate.
      if (!isRouteAllowed(pathname, role)) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
