import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getRoleFromClaims, type Role } from '@/lib/auth/roles';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { Capability } from '@/lib/auth/capabilities';

export type RequireCapabilityUser = { id: string; email: string | null };

// The capability sibling of `requireRole` (lib/auth/require-role.ts).
//
// Signature, return shape and status codes are DELIBERATELY identical, so
// migrating a route is a one-line swap:
//
//    const auth = await requireRole(['p_file_officer', 'superadmin']);
//    const auth = await requireCapability('documents_post_enrolment.upload');
//
// and everything downstream (`if ('error' in auth) return auth.error;`,
// `auth.user.id`, `auth.role`) keeps working unchanged. That is what lets the
// other ~90 `requireRole` sites stay exactly as they are: this is additive, not
// a migration everyone has to finish.
//
// `auth.role` is still returned. Routes that need a role-specific branch after
// the gate (there are 35 such narrowings today) keep working, and a route that
// genuinely reasons about identity rather than permission should keep doing so.
//
// Authenticates via `getClaims()` — local JWT verification, no Auth round-trip,
// same as `requireRole` and `getSessionUser()` (KD #35). The capability lookup
// itself is a cached read (lib/auth/permission-map.ts), so the common path costs
// nothing after the first call in a cache window.
export async function requireCapability(capability: Capability) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | null | undefined;
  if (!claims?.sub) {
    return {
      error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    } as const;
  }

  const role = getRoleFromClaims(claims);
  const capabilities = await getCapabilitiesForRole(role);
  if (!role || !capabilities.includes(capability)) {
    return {
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    } as const;
  }

  const user: RequireCapabilityUser = {
    id: String(claims.sub),
    email: (claims.email as string | undefined) ?? null,
  };
  return { user, role: role as Role, capabilities } as const;
}

/** Assert one of several capabilities — for a route serving two surfaces whose
 *  permissions differ (the notify / promise routes, which act on either side of
 *  enrolment depending on the request body). Prefer the single-capability form
 *  where the route has one meaning. */
export async function requireAnyCapability(candidates: readonly Capability[]) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | null | undefined;
  if (!claims?.sub) {
    return {
      error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    } as const;
  }

  const role = getRoleFromClaims(claims);
  const capabilities = await getCapabilitiesForRole(role);
  if (!role || !candidates.some((c) => capabilities.includes(c))) {
    return {
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    } as const;
  }

  const user: RequireCapabilityUser = {
    id: String(claims.sub),
    email: (claims.email as string | undefined) ?? null,
  };
  return { user, role: role as Role, capabilities } as const;
}
