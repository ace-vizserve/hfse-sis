// Classroom server-only reads — section terms + per-section capability.
//
// `loadClassroomAccess` is the belt-and-braces primitive every classroom
// page calls independently (not just the layout): it re-derives the
// viewer's ClassroomCapability for this exact section from the DB, so a
// sub-route can never render RLS-bypassing service-client data for a
// capability it hasn't itself checked. See lib/classroom/scope.ts for why
// that check exists at all, and the "Authorization" section of the Phase 4
// brief for why the layout's own check isn't sufficient on its own.

import 'server-only';

import type { Role } from '@/lib/auth/roles';
import {
  loadAssignmentsForUser,
  type AssignmentRow,
} from '@/lib/auth/teacher-assignments';
import {
  capabilityForSection,
  resolveClassroomScope,
  type ClassroomCapability,
} from '@/lib/classroom/scope';
import type { ClassroomTerm } from '@/lib/classroom/terms';
import { createServiceClient } from '@/lib/supabase/service';

export type ClassroomAccess = {
  capability: ClassroomCapability | null;
  assignments: AssignmentRow[];
};

export async function loadClassroomAccess(
  role: Role | null,
  userId: string,
  sectionId: string
): Promise<ClassroomAccess> {
  const assignments =
    role === 'teacher'
      ? await loadAssignmentsForUser(createServiceClient(), userId)
      : [];
  const scope = resolveClassroomScope(role, assignments);
  return { capability: capabilityForSection(scope, sectionId), assignments };
}

export async function getTermsForAy(
  academicYearId: string
): Promise<ClassroomTerm[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('terms')
    .select('id, label, term_number, is_current, start_date, end_date')
    .eq('academic_year_id', academicYearId)
    .order('term_number', { ascending: true });
  return (data ?? []) as ClassroomTerm[];
}
