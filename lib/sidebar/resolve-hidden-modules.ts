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
 * ⚠ BOTH HALVES READ THE ONE ROLE IN FORCE. There is no second, parallel
 * "view" role any more: switching rewrites `app_metadata.active_role`, so a
 * teaching admin working as a teacher genuinely IS `role === 'teacher'` here,
 * and both answers follow her without either being told separately.
 *
 *   • `hiddenModules` only ever NARROWS a teacher — `hiddenModulesForTeacher`
 *     returns `[]` for everyone else, and says at its own definition why. So an
 *     admin working as an admin loses nothing from her module switcher.
 *
 *   • `profile` answers "which of the two teaching jobs is this person doing",
 *     which is exactly what her assignment rows describe once she is working
 *     as a teacher.
 */
export async function resolveTeacherNavScope(
  role: Role | null,
  userId: string
): Promise<TeacherNavScope> {
  // Only a teacher can have either answer come back non-trivial, so every
  // other role skips the read entirely and pays no query.
  if (role !== 'teacher') {
    return { hiddenModules: [], profile: NO_TEACHING_PROFILE };
  }
  try {
    // Request-scoped memo, not a fresh query: a single navigation asks this
    // same question from the palette, this resolver and the classroom layout.
    // Same loader, same data, same conditions — see lib/auth/assignments-cache.ts.
    const assignments = await loadEffectiveAssignmentsForUserMemo(userId);
    return {
      hiddenModules: hiddenModulesForTeacher(role, assignments),
      profile: teachingProfileFor(role, assignments),
    };
  } catch (err) {
    console.warn(
      '[sidebar] could not resolve teacher assignments; showing every module:',
      err instanceof Error ? err.message : err
    );
    return {
      // Fail-open: nothing that failed read would have told us may hide a
      // module.
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
 * Fails OPEN on the read: if the assignment query throws, nothing that query
 * would have told us hides a module. Showing a tile that turns out to be empty
 * is a small annoyance; hiding a form adviser's Attendance module because a
 * query blipped would take away their daily work surface, which is far worse.
 * This is navigation, not authorization — the real gates are ROUTE_ACCESS, the
 * page guards, and RLS, none of which this touches.
 */
export async function resolveHiddenModules(
  role: Role | null,
  userId: string
): Promise<SidebarModule[]> {
  const { hiddenModules } = await resolveTeacherNavScope(role, userId);
  return hiddenModules;
}
