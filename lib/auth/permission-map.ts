import 'server-only';

import { unstable_cache } from 'next/cache';

import type { Role } from '@/lib/auth/roles';
import {
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
  type Capability,
} from '@/lib/auth/capabilities';
import { createServiceClient } from '@/lib/supabase/service';

// Reads the editable grants from `public.role_permissions` (migration 101).
//
// The vocabulary lives in lib/auth/capabilities.ts, which is pure and
// client-safe; this module is the server-only half that answers "who holds
// what right now".
//
// CACHING. Tagged `permissions`, so the editor's `revalidateTag('permissions')`
// makes an edit apply on the next page load — no re-login. That matters because
// role itself still comes from the login token (app_metadata.role, read locally
// by getClaims()); if capabilities rode in the token too, an edit would not take
// effect until the token refreshed.
//
// Two constraints this obeys, both learned the hard way elsewhere in this
// codebase:
//   * the SERVICE client, never a cookie-scoped one — a cookie-bound client
//     inside `unstable_cache` is forbidden in Next 16 (KD #54).
//   * ARRAYS in the cached value, never Sets — `unstable_cache` JSON-serialises,
//     so a Set comes back as `{}` (KD #153).
//
// FAILURE MODE. Any failure — table missing, query error, empty table — falls
// back to DEFAULT_ROLE_CAPABILITIES, which is today's behaviour. It does not
// fail open (that would grant everything) and it does not fail closed (that
// would lock every role out of the app over a transient query error). The
// fallback is also what makes this code safe to deploy BEFORE migration 101 is
// applied: with no table, every gate behaves exactly as it does today.

const TAG = 'permissions';

type RoleCapabilityMap = Record<Role, Capability[]>;

function cloneDefaults(): RoleCapabilityMap {
  return Object.fromEntries(
    Object.entries(DEFAULT_ROLE_CAPABILITIES).map(([role, caps]) => [
      role,
      [...caps],
    ])
  ) as RoleCapabilityMap;
}

async function loadRoleCapabilitiesUncached(): Promise<RoleCapabilityMap> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('role_permissions')
    .select('role, capability');

  if (error) {
    // Not fatal — see FAILURE MODE above. Warn rather than throw so a transient
    // error can't take the whole app down; the app keeps running on defaults.
    console.warn(
      '[permissions] could not read role_permissions; using built-in defaults:',
      error.message
    );
    return cloneDefaults();
  }

  const rows = (data ?? []) as Array<{ role: string; capability: string }>;
  if (rows.length === 0) {
    // Migration not applied yet, or the table was emptied. Defaults, not an
    // empty map — an empty map would silently revoke everything.
    return cloneDefaults();
  }

  // Start from every known role with an EMPTY list, not from the defaults: once
  // the table has rows it is authoritative, and merging in defaults would make a
  // deliberately-revoked capability un-revokable.
  const map = Object.fromEntries(
    Object.keys(DEFAULT_ROLE_CAPABILITIES).map((role) => [
      role,
      [] as Capability[],
    ])
  ) as RoleCapabilityMap;

  for (const row of rows) {
    if (!(row.role in map)) continue; // a role the code no longer knows
    if (!isCapability(row.capability)) continue; // a capability nothing gates on
    map[row.role as Role].push(row.capability);
  }

  return map;
}

/** Every role's capabilities. Cached 60s and on the `permissions` tag. */
export const getRoleCapabilities = unstable_cache(
  loadRoleCapabilitiesUncached,
  ['auth', 'role-capabilities'],
  { tags: [TAG], revalidate: 60 }
);

/** One role's capabilities. `null` role (a parent) holds none. */
export async function getCapabilitiesForRole(
  role: Role | null
): Promise<Capability[]> {
  if (!role) return [];
  const map = await getRoleCapabilities();
  return map[role] ?? [];
}

/** Server-side capability test for page guards and nav filtering. */
export async function roleCan(
  role: Role | null,
  capability: Capability
): Promise<boolean> {
  const capabilities = await getCapabilitiesForRole(role);
  return capabilities.includes(capability);
}

export const PERMISSIONS_CACHE_TAG = TAG;
