import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getRoleFromClaims, type Role } from '@/lib/auth/roles';

// Trimmed caller identity for API route handlers. Mirrors `SessionUser` from
// `lib/supabase/server.ts`. Only `.id` and `.email` are exposed; `.role` is
// alongside on the outer object. Anything else (app_metadata, user_metadata,
// phone, aud, etc.) is intentionally dropped — routes that need more than
// id+email+role should call `createServiceClient().auth.admin.getUserById(id)`
// for the full record.
export type RequireRoleUser = { id: string; email: string | null };

// Use inside API route handlers to assert the caller holds one of the allowed
// roles. Returns either { user, role } or a NextResponse to return directly.
//
// Authenticates via `supabase.auth.getClaims()` (local JWT verification), not
// `getUser()` — same pattern as `getSessionUser()` in `lib/supabase/server.ts`.
// Saves one Supabase Auth network round-trip per API call.
export async function requireRole(allowed: Role[]) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | null | undefined;
  if (!claims?.sub) {
    return {
      error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    } as const;
  }
  const role = getRoleFromClaims(claims);
  if (!role || !allowed.includes(role)) {
    return {
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    } as const;
  }
  const user: RequireRoleUser = {
    id: String(claims.sub),
    email: (claims.email as string | undefined) ?? null,
  };
  return { user, role } as const;
}
