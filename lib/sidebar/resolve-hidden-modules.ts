import 'server-only';

import { loadEffectiveAssignmentsForUserMemo } from '@/lib/auth/assignments-cache';
import type { Role } from '@/lib/auth/roles';
import {
  hiddenModulesForTeacher,
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
 *   • `profile` takes `viewRole`. It answers "which of the two teaching jobs
 *     is this person doing", and in the Teacher lens a teaching admin is doing
 *     exactly the job her assignment rows describe. Left on the account role
 *     it would be `NO_TEACHING_PROFILE` forever, so her home page would offer
 *     no teacher actions in a view whose whole purpose is teacher work.
 *
 * `viewRole` DEFAULTS to `role`, so every caller that does not care —
 * `resolveHiddenModules` and its nine layouts — behaves exactly as before,
 * short-circuit included, and pays no query.
 */
export async function resolveTeacherNavScope(
  role: Role | null,
  userId: string,
  viewRole: Role | null = role
): Promise<TeacherNavScope> {
  // Skip the read only when NEITHER answer could be non-trivial. An admin in
  // the Admin lens still short-circuits (both roles are the account role);
  // an admin in the Teacher lens does not, because the profile half now has
  // something real to say.
  if (role !== 'teacher' && viewRole !== 'teacher') {
    return { hiddenModules: [], profile: NO_TEACHING_PROFILE };
  }
  try {
    // Request-scoped memo, not a fresh query: a single navigation asks this
    // same question from the palette, this resolver and the classroom layout.
    // Same loader, same data, same conditions — see lib/auth/assignments-cache.ts.
    // For a teaching admin `getViewContext()` has already made this call to
    // decide her entitlement, so this one costs nothing.
    const assignments = await loadEffectiveAssignmentsForUserMemo(userId);
    return {
      hiddenModules: hiddenModulesForTeacher(role, assignments),
      profile: teachingProfileFor(viewRole, assignments),
    };
  } catch (err) {
    console.warn(
      '[sidebar] could not resolve teacher assignments; showing every module:',
      err instanceof Error ? err.message : err
    );
    return {
      hiddenModules: [],
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
 * this costs nothing on the layouts oversight actually uses. Only a teacher
 * triggers the assignment read.
 *
 * Deliberately does NOT forward a `viewRole`: the module list is keyed on the
 * real role by design (see the ruling on `resolveTeacherNavScope` above), and
 * leaving the argument off is also what keeps the short-circuit — and so the
 * zero-query promise in the paragraph above — intact for every module layout.
 *
 * Fails OPEN: if the assignment read throws, nothing is hidden. Showing a tile
 * that turns out to be empty is a small annoyance; hiding a form adviser's
 * Attendance module because a query blipped would take away their daily work
 * surface, which is far worse. This is navigation, not authorization — the
 * real gates are ROUTE_ACCESS, the page guards, and RLS, none of which this
 * touches.
 */
export async function resolveHiddenModules(
  role: Role | null,
  userId: string
): Promise<SidebarModule[]> {
  const { hiddenModules } = await resolveTeacherNavScope(role, userId);
  return hiddenModules;
}
