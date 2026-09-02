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
  //
  // ⚠ WHO PAYS THIS, AND WHY IT IS ACCEPTED RATHER THAN OPTIMISED (ruled
  // 2026-09-02, Phase 2 review). Since every module layout now calls
  // `getViewContext()` (to feed the "Switch view" popover), every
  // `school_admin`, `academic_coordinator`, `superadmin`, `p_file_officer` and
  // `admissions` account pays one `teacher_assignments` select on every module
  // page view — five of the six roles, everyone but `teacher` and a parent.
  //
  // The Phase 1 memo (`loadEffectiveAssignmentsForUserMemo`, keyed on `userId`
  // via React `cache()`) does NOT amortise this away, and that is not a defect
  // in the memo: it dedupes calls made with the same `userId` WITHIN one
  // request, but this request's other two consumers —
  // `lib/sidebar/resolve-hidden-modules.ts` and `lib/classroom/queries.ts` —
  // both short-circuit on `role === 'teacher'` BEFORE reading, i.e. they read
  // for the exact complement of the roles above. So for a `school_admin`
  // navigating the SIS module, nobody else in that request has already made
  // this call for the memo to fold this one into — it is a genuinely new
  // query, not a duplicate of an existing one.
  //
  // ⚠ AMENDED BY PHASE 3a, and only in the direction that helps. Those two
  // short-circuits now test the role their PAGE call sites pass, which is
  // `activeRole` — so for a teaching admin actually working in the Teacher
  // lens they no longer skip, and their read folds into this one via the memo
  // instead of being a second query. The paragraph above still describes the
  // common case exactly: an admin in the Admin lens, where `activeRole` is the
  // account role and nothing downstream reads assignments at all.
  //
  // A cross-REQUEST cache (`unstable_cache` or similar) was considered and
  // deliberately rejected: the loader's relief-cover window
  // (`lib/auth/teacher-assignments.ts`'s `sgToday()`) is time-of-day
  // dependent, and freezing that behind a cache TTL would be a correctness
  // hazard (a colleague's cover window ending mid-day, or starting, while a
  // stale answer is still being served) traded for saving one small, indexed,
  // low-row-count query. Accepted as the cost of the switcher existing at all:
  // Phase 1 already removed two-to-three `teacher_assignments` reads per
  // navigation from the classroom path (see its report), so the app is net
  // ahead even with this one added back for non-teacher roles.
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
