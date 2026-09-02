import type { Role } from '@/lib/auth/roles';

// The active-role lens: which of the jobs a staff account actually does it is
// currently LOOKING at the app as.
//
// ⚠ THE INVARIANT THIS WHOLE FEATURE RESTS ON:
//
//        role authorises.  activeRole renders.
//
// `role` — the JWT's `app_metadata.role` — keeps driving the proxy,
// ROUTE_ACCESS, `requireRole`, `requireCapability` and every RLS policy,
// untouched. `activeRole` is presentation only, and must never be read by an
// authorization gate. `__tests__/auth/active-role-never-authorises.test.ts`
// fails the build if the identifier so much as appears in one.
//
// The reason it exists: six live `school_admin` accounts at this school also
// teach, four of them as the form adviser of record for a class. Today the app
// has no way to show them a teacher's view of their own classes — their
// account role is the only lens there is.
//
// This module is PURE — no I/O, no `server-only`, no `next/headers`. It is the
// rule, not the plumbing; lib/auth/view-context.ts is the server half that
// feeds it a session and a cookie. Keeping it pure is what lets the unit tests
// state the rule directly instead of mocking a request.

/**
 * Where the chosen lens is remembered.
 *
 * `httpOnly` even though it holds no secret: the value is only ever meaningful
 * next to the account's own entitlement, which is recomputed server-side on
 * every read, so nothing client-side has any business writing it.
 */
export const ACTIVE_ROLE_COOKIE = 'hfse_active_role';

/**
 * Every lens this account may look through, most-authoritative first.
 *
 * ⚠ THE SET CAN ONLY EVER NARROW, NEVER WIDEN. It is the account's own role,
 * plus `'teacher'` only when the account genuinely holds assignment rows. No
 * input — cookie, request body, header — can add to it, which is what makes it
 * safe for the lens to be a user-controlled value at all.
 *
 * `hasAssignments` is the RELIEF-INCLUSIVE answer (see
 * lib/auth/assignments-cache.ts): a colleague standing in on someone's class
 * has teaching work today and should be able to look at it.
 *
 * Element 0 is always the account role, and `resolveActiveRole` below relies on
 * that ordering for its fallback.
 */
export function getEntitledRoles(
  role: Role | null,
  hasAssignments: boolean
): Role[] {
  // A parent. They share this Supabase project (KD #7 and the parent portal),
  // so `null` is a real, common value here rather than a defensive branch —
  // and a parent has no staff lens of any kind.
  if (!role) return [];

  // A plain teacher is already looking at the teacher's view; there is nothing
  // to switch to. Returning early also means the caller never has to read
  // assignments for the single largest group of staff accounts.
  if (role === 'teacher') return ['teacher'];

  return hasAssignments ? [role, 'teacher'] : [role];
}

/**
 * Which lens to render this request.
 *
 * ⚠ RE-VALIDATED EVERY REQUEST, deliberately — the cookie is a REQUEST, not a
 * grant. If the school takes the last class off a school_admin who had been
 * working in the teacher view, their next page load quietly puts them back in
 * the admin view rather than stranding them in a lens their account no longer
 * earns. The same check makes a hand-edited cookie a no-op.
 *
 * Falls back to `entitled[0]`, which `getEntitledRoles` guarantees is the
 * account's own role: the lens someone gets when they have expressed no
 * preference is the one they already had before this feature existed.
 */
export function resolveActiveRole(
  entitled: Role[],
  cookieValue: string | null
): Role | null {
  if (entitled.length === 0) return null;
  // `find` rather than `includes` + a cast: the match is what narrows the
  // cookie's `string` to a `Role`, so there is no unchecked assertion here.
  return entitled.find((r) => r === cookieValue) ?? entitled[0];
}
