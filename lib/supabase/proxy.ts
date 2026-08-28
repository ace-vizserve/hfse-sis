import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie and hands back the caller's claims.
 *
 * ⚠ THIS FUNCTION DECIDES NOTHING. It refreshes and reports; every redirect and
 * every role gate lives in `proxy.ts`. That split is deliberate — when the
 * session refresh and the access rules share a function, "who may be here" and
 * "is this cookie still good" get tangled, and the Supabase starter's version
 * of this file ships with a `/login` redirect baked in that silently drops
 * every gate this app relies on.
 *
 * Uses `getClaims()` rather than `getUser()` to avoid a network round-trip to
 * Supabase Auth on every navigation: it verifies the JWT signature locally
 * against the cached JWKS. (Requires asymmetric signing keys; it falls back to
 * `getUser()` internally on legacy HS256 projects.)
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  claims: Record<string, unknown> | null;
}> {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // ⚠ Do not put code between `createServerClient` and `getClaims()`. A mistake
  // here is very hard to debug — it shows up as users being logged out at
  // random.
  const { data } = await supabase.auth.getClaims();

  return { response, claims: data?.claims ?? null };
}
