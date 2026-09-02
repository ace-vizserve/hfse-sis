import 'server-only';

import { loadEffectiveAssignmentsForUserMemo } from '@/lib/auth/assignments-cache';
import type { Role } from '@/lib/auth/roles';
import {
  hiddenModulesForTeacher,
  hiddenModulesForView,
  teachingProfileFor,
  NO_TEACHING_PROFILE,
  type TeachingProfile,
} from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';

export type TeacherNavScope = {
  hiddenModules: SidebarModule[];
  profile: TeachingProfile;
};

/**
 * One assignment read, both answers: which modules are dead ends for this
 * viewer, and which of the two teaching jobs they hold.
 *
 * `resolveHiddenModules` below is now a thin wrapper on this, so the eight
 * module layouts that only need the module list keep their existing call.
 *
 * FAIL-OPEN, and note it means something DIFFERENT for each half. For modules,
 * open = hide nothing (`[]`). For the profile, open = grant BOTH jobs — because
 * the consumers filter actions OUT when a job is absent, so an all-false
 * profile on a failed read would strip a teacher's entire quick-action row.
 * That would be failing closed while looking like failing open, which is
 * exactly the bug this comment exists to prevent.
 *
 * ⚠ THE TWO HALVES ARE KEYED ON DIFFERENT ROLES, DELIBERATELY.
 *
 *   • `hiddenModules` takes the REAL `role`. It only ever NARROWS a teacher
 *     (`hiddenModulesForTeacher` returns `[]` for everyone else, and says at
 *     its own definition why). Keying it on the lens would let a teaching
 *     admin in the Teacher view lose Attendance or Evaluation from her module
 *     switcher — hiding modules from one of the few people who runs them.
 *
 *     ⚠ IT IS NOW UNIONED WITH A SECOND, PURELY ROUTE-SHAPED LIST, and the two
 *     are not the same rule wearing different clothes. `hiddenModulesForView`
 *     drops the modules the LENS cannot open at all — SIS, Records, P-Files and
 *     Admissions under a teacher view — because filtering their sidebars per
 *     item on `requiresRoles` empties them, and an empty sidebar renders as a
 *     header over nothing (role-switcher Phase 3b, 2026-09-02). That list takes
 *     the lens by definition; the assignment-shaped one above still must not.
 *     A subject-teacher-only admin in the Teacher view therefore KEEPS
 *     Attendance and Evaluation and LOSES SIS — which is the whole distinction,
 *     stated as the thing that would look wrong if the two were merged.
 *
 *   • `profile` takes `viewRole`. It answers "which of the two teaching jobs
 *     is this person doing", and in the Teacher lens a teaching admin is doing
 *     exactly the job her assignment rows describe. Left on the account role
 *     it would be `NO_TEACHING_PROFILE` forever, so her home page would offer
 *     no teacher actions in a view whose whole purpose is teacher work.
 *
 * `viewRole` DEFAULTS to `role`, so every caller that does not care behaves
 * exactly as before, short-circuit included, and pays no query.
 */
export async function resolveTeacherNavScope(
  role: Role | null,
  userId: string,
  viewRole: Role | null = role
): Promise<TeacherNavScope> {
  // Resolved BEFORE the short-circuit and outside the try, because it is pure:
  // it reads ROUTE_ACCESS and nothing else, so it costs no query and cannot
  // fail. That is also why it survives the catch below — see there.
  const lensHidden = hiddenModulesForView(role, viewRole);

  // Skip the read only when NEITHER answer could be non-trivial. An admin in
  // the Admin lens still short-circuits (both roles are the account role, so
  // `lensHidden` is empty too); an admin in the Teacher lens does not, because
  // the profile half now has something real to say.
  if (role !== 'teacher' && viewRole !== 'teacher') {
    return { hiddenModules: lensHidden, profile: NO_TEACHING_PROFILE };
  }
  try {
    // Request-scoped memo, not a fresh query: a single navigation asks this
    // same question from the palette, this resolver and the classroom layout.
    // Same loader, same data, same conditions — see lib/auth/assignments-cache.ts.
    // For a teaching admin `getViewContext()` has already made this call to
    // decide her entitlement, so this one costs nothing.
    const assignments = await loadEffectiveAssignmentsForUserMemo(userId);
    return {
      hiddenModules: mergeHidden(
        hiddenModulesForTeacher(role, assignments),
        lensHidden
      ),
      profile: teachingProfileFor(viewRole, assignments),
    };
  } catch (err) {
    console.warn(
      '[sidebar] could not resolve teacher assignments; showing every module:',
      err instanceof Error ? err.message : err
    );
    return {
      // ⚠ `lensHidden`, NOT `[]` — and that is not a weakening of the fail-open
      // rule below, it is the scope of it. Fail-open is about the ASSIGNMENT
      // READ: nothing that read would have told us may hide a module. The lens
      // half never asked the database, so a failed query is no reason to put
      // back a SIS tile whose sidebar a teacher view cannot fill.
      hiddenModules: lensHidden,
      // Fails OPEN, including on the substantive axis. This governs nav
      // visibility only — every page and route behind these tiles re-checks
      // properly — so the worst case is an offered tile that turns out empty,
      // against the worse case of hiding Attendance from a form adviser
      // because one read hiccupped.
      profile: {
        advises: true,
        advisesSubstantively: true,
        teachesSubject: true,
      },
    };
  }
}

/**
 * Server-side wrapper for `hiddenModulesForTeacher` — the module layouts call
 * this to decide which switcher tiles are dead ends for the viewer.
 *
 * Short-circuits for every non-teacher role WITHOUT touching the database, so
 * this costs nothing on the layouts oversight actually uses. Only a teacher —
 * real or looked-at-as — triggers the assignment read.
 *
 * ⚠ IT NOW FORWARDS `viewRole`, WHICH PHASE 3a DELIBERATELY DID NOT, and the
 * reason 3a gave has been re-checked rather than overruled from memory. That
 * reason was the ASSIGNMENT-shaped list, which must stay on the real role so a
 * teaching admin never loses Attendance — and it still does:
 * `hiddenModulesForTeacher` is passed `role` inside `resolveTeacherNavScope`
 * and nothing here changes that. What is forwarded feeds only the pure,
 * route-shaped `hiddenModulesForView`. The zero-query promise also holds: an
 * admin in the Admin lens passes `viewRole === role` and short-circuits exactly
 * as before, and an admin in the Teacher lens folds into the read
 * `getViewContext()` already made this request (lib/auth/assignments-cache.ts).
 *
 * A caller that omits it still gets today's behaviour, so an unconverted layout
 * degrades to "hides nothing extra" rather than to something wrong.
 *
 * Fails OPEN on the read: if the assignment query throws, nothing that query
 * would have told us hides a module. Showing a tile that turns out to be empty
 * is a small annoyance; hiding a form adviser's Attendance module because a
 * query blipped would take away their daily work surface, which is far worse.
 * This is navigation, not authorization — the real gates are ROUTE_ACCESS, the
 * page guards, and RLS, none of which this touches.
 */
export async function resolveHiddenModules(
  role: Role | null,
  userId: string,
  viewRole: Role | null = role
): Promise<SidebarModule[]> {
  const { hiddenModules } = await resolveTeacherNavScope(
    role,
    userId,
    viewRole
  );
  return hiddenModules;
}

/**
 * The two hidden-module lists as one, first-seen order preserved.
 *
 * Order is not cosmetic here: `__tests__/auth/module-visibility.test.ts` pins
 * `hiddenModulesForTeacher`'s answer as an exact array, so the assignment-shaped
 * list has to stay in front and unchanged. For every account but the six that
 * also teach the second list is empty and this returns the first one untouched.
 */
function mergeHidden(
  assignmentHidden: SidebarModule[],
  lensHidden: SidebarModule[]
): SidebarModule[] {
  if (lensHidden.length === 0) return assignmentHidden;
  return [
    ...assignmentHidden,
    ...lensHidden.filter((m) => !assignmentHidden.includes(m)),
  ];
}
