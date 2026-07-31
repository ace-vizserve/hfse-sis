import 'server-only';

import { loadAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';
import {
  hiddenModulesForTeacher,
  teachingProfileFor,
  NO_TEACHING_PROFILE,
  type TeachingProfile,
} from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';
import { createServiceClient } from '@/lib/supabase/service';

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
 */
export async function resolveTeacherNavScope(
  role: Role | null,
  userId: string
): Promise<TeacherNavScope> {
  if (role !== 'teacher') {
    return { hiddenModules: [], profile: NO_TEACHING_PROFILE };
  }
  try {
    const assignments = await loadAssignmentsForUser(
      createServiceClient(),
      userId
    );
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
      hiddenModules: [],
      profile: { advises: true, teachesSubject: true },
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
