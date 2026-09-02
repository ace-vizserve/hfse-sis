import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';

import {
  ACTIVE_ROLE_COOKIE,
  getEntitledRoles,
  resolveActiveRole,
} from '@/lib/auth/active-role';
import { loadEffectiveAssignmentsForUserMemo } from '@/lib/auth/assignments-cache';
import type { Role } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';

// The server half of the active-role lens (lib/auth/active-role.ts holds the
// rule). Answers, for the viewer of this request: who are you, what may you
// look at the app as, and which of those are you looking at right now.
//
// ⚠ WHY THIS IS A SEPARATE FUNCTION AND NOT A FIELD ON `SessionUser`.
// `getSessionUser` reads JWT claims and nothing else — its docstring promises
// "no network round-trip" and roughly 84 call sites are written on that
// promise. Entitlement needs an assignments read, so putting `activeRole` on
// `SessionUser` would make every one of those call sites pay for a database
// query to get a value only navigation and scope surfaces want. The lens lives
// here instead, and only the surfaces that need it import it. (Ruled
// 2026-09-02; the plan text said otherwise.)
//
// `cache()`d for the same reason `getSessionUser` is: layout, module layout and
// page all ask, and they should not each re-read a cookie and re-derive the
// same answer. The assignments read underneath is separately memoized, so two
// different lens consumers in one request cost one query between them.

export type ViewContext = {
  id: string;
  email: string;
  /** The account's real role. THIS is what authorises. */
  role: Role | null;
  /** Every lens this account may look through — see `getEntitledRoles`. */
  entitled: Role[];
  /** The lens being rendered. Presentation only; never gate on it. */
  activeRole: Role | null;
};

export const getViewContext = cache(async (): Promise<ViewContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  // Only an account that could GAIN the teacher lens is worth a query. A
  // parent (`null`) has no staff lens at all, and a plain teacher already has
  // exactly one — `getEntitledRoles` ignores `hasAssignments` for both, so
  // reading assignments for them would be a query whose answer is discarded.
  // That skip is what keeps this free on the two largest groups of accounts.
  const couldGainTeacherLens = user.role !== null && user.role !== 'teacher';

  let hasAssignments = false;
  if (couldGainTeacherLens) {
    try {
      const assignments = await loadEffectiveAssignmentsForUserMemo(user.id);
      hasAssignments = assignments.length > 0;
    } catch (err) {
      // FAILS CLOSED, and note this is the opposite of
      // lib/sidebar/resolve-hidden-modules.ts, which fails OPEN on the same
      // read. The difference is what a wrong answer costs: there, a failed
      // read would HIDE modules a teacher works in every day. Here, a failed
      // read only withholds an EXTRA view — the viewer keeps the lens their
      // account role has always given them, which is exactly the behaviour
      // that existed before this feature. Offering a lens on the strength of
      // a query that did not answer would be the worse direction.
      console.warn(
        '[view-context] could not resolve assignments; offering the account role only:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const entitled = getEntitledRoles(user.role, hasAssignments);

  // The cookie is only read when there is a choice for it to express. With one
  // entitled role (every plain teacher, every admin who does not teach) or none
  // (a parent), `resolveActiveRole` returns `entitled[0] ?? null` whatever the
  // cookie says — so reading it would be a `cookies()` call whose answer cannot
  // matter, and `cookies()` opts a caller into dynamic rendering. Passing
  // `null` in that case is not a shortcut past the rule; it is the same
  // function reaching the same answer.
  const cookieValue =
    entitled.length > 1
      ? ((await cookies()).get(ACTIVE_ROLE_COOKIE)?.value ?? null)
      : null;
  const activeRole = resolveActiveRole(entitled, cookieValue);

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    entitled,
    activeRole,
  };
});
