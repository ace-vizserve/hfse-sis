import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getRoleFromClaims, type Role } from '@/lib/auth/roles';

/** Lightweight user identity from JWT claims — no network round-trip. */
export type SessionUser = { id: string; email: string; role: Role | null };

/**
 * Extract user identity from the session JWT via `getClaims()`.
 * This avoids the Supabase Auth network call that `getUser()` makes.
 * Returns `null` if no valid session exists.
 *
 * Wrapped in React's `cache()` — root layout, module layout, and page.tsx
 * all call this per navigation (~84 call sites); cache() dedupes them to a
 * single `getClaims()` call per request instead of one per call site. This
 * is a request-scoped memoization only — it does not reduce the underlying
 * network fallback that occurs on legacy HS256 (non-JWKS) Supabase projects.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | null | undefined;
  if (!claims?.sub) return null;
  return {
    id: String(claims.sub),
    email: String(claims.email ?? ''),
    role: getRoleFromClaims(claims),
  };
});

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — ignore; middleware refreshes sessions.
          }
        },
      },
    },
  );
}
