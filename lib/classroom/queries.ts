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
import {
  gatherTimelineEntityIds,
  TIMELINE_ROW_LIMIT,
} from '@/lib/classroom/timeline';
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

export type ClassroomTimelineRow = {
  id: string;
  action: string;
  actor_email: string;
  context: Record<string, unknown>;
  created_at: string;
};

/**
 * "What happened in this class" — the most recent `TIMELINE_ROW_LIMIT`
 * audit_log rows whose entity_id names this section, one of its grading
 * sheets, one of its section_students rows (any status), or an
 * evaluation_writeups row belonging to one of its students. See
 * lib/classroom/timeline.ts for why this is the right (and only indexed)
 * way to scope the query, and for what is deliberately excluded.
 */
export async function getClassroomTimeline(
  sectionId: string
): Promise<ClassroomTimelineRow[]> {
  const service = createServiceClient();

  const [{ data: sheets }, { data: enrolments }] = await Promise.all([
    service.from('grading_sheets').select('id').eq('section_id', sectionId),
    service
      .from('section_students')
      .select('id, student_id')
      .eq('section_id', sectionId),
  ]);

  const sheetIds = (sheets ?? []).map((s) => s.id as string);
  const sectionStudentIds = (enrolments ?? []).map((e) => e.id as string);
  const studentIds = Array.from(
    new Set(
      (enrolments ?? [])
        .map((e) => e.student_id as string | null)
        .filter((id): id is string => !!id)
    )
  );

  let writeupIds: string[] = [];
  if (studentIds.length > 0) {
    const { data: writeups } = await service
      .from('evaluation_writeups')
      .select('id')
      .in('student_id', studentIds);
    writeupIds = (writeups ?? []).map((w) => w.id as string);
  }

  const entityIds = gatherTimelineEntityIds({
    sectionId,
    sheetIds,
    sectionStudentIds,
    writeupIds,
  });

  const { data: rows } = await service
    .from('audit_log')
    .select('id, action, actor_email, context, created_at')
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })
    .limit(TIMELINE_ROW_LIMIT);

  return (rows ?? []) as ClassroomTimelineRow[];
}
