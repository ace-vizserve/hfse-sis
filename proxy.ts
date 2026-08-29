import { updateSession } from '@/lib/supabase/proxy';
import { type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
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
    // outright. Measured, not guessed, on 2026-08-29.
    //
    // Cross-origin CORS for those routes is set per-route via lib/cors.ts.
    //
    // Also skipped: Next internals and static assets.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
