import 'server-only';

import { loadAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';
import { hiddenModulesForTeacher } from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';
import { createServiceClient } from '@/lib/supabase/service';

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
  if (role !== 'teacher') return [];
  try {
    const assignments = await loadAssignmentsForUser(
      createServiceClient(),
      userId
    );
    return hiddenModulesForTeacher(role, assignments);
  } catch (err) {
    console.warn(
      '[sidebar] could not resolve teacher assignments; showing every module:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
