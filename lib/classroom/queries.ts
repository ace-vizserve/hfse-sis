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

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { loadEffectiveAssignmentsForUserMemo } from '@/lib/auth/assignments-cache';
import type { EffectiveAssignmentRow } from '@/lib/auth/teacher-assignments';
import {
  capabilityForSection,
  resolveClassroomScope,
  substantiveCapabilityForSection,
  type ClassroomCapability,
} from '@/lib/classroom/scope';
import type { ClassroomTerm } from '@/lib/classroom/terms';
import {
  ENROLEE_TIMELINE_ACTIONS,
  gatherTimelineEntityIds,
  TIMELINE_ROW_LIMIT,
} from '@/lib/classroom/timeline';
import { createServiceClient } from '@/lib/supabase/service';

export type ClassroomAccess = {
  /**
   * What the viewer may DO here, cover included. Gate the working surfaces on
   * this: attendance, marks, roster.
   */
  capability: ClassroomCapability | null;
  /**
   * What the viewer IS here, cover excluded. Gate the adviser's own work on
   * this — write-ups and the report card comment stay with the regular adviser
   * while they are away, so a substitute must get `null` from it.
   *
   * The two differ ONLY for an active relief. Passing `capability` where this
   * belongs is the mistake this split exists to prevent, and
   * `__tests__/auth/assignment-read-classification.test.ts` fails the build on it —
   * `evaluation_writeups` has no adviser predicate in RLS to catch it at
   * runtime.
   */
  substantiveCapability: ClassroomCapability | null;
  assignments: EffectiveAssignmentRow[];
};

export async function loadClassroomAccess(
  role: Role | null,
  userId: string,
  sectionId: string
): Promise<ClassroomAccess> {
  // The memo, not a fresh query. Every classroom page calls this independently
  // of the layout on purpose (see the header), so one navigation into a section
  // asked the same question three or four times over; the memo makes the
  // belt-and-braces re-check free rather than merely cheap. Same loader, same
  // data, same conditions — lib/auth/assignments-cache.ts.
  const assignments =
    role === 'teacher' ? await loadEffectiveAssignmentsForUserMemo(userId) : [];
  const scope = resolveClassroomScope(role, assignments);
  return {
    capability: capabilityForSection(scope, sectionId),
    substantiveCapability: substantiveCapabilityForSection(scope, sectionId),
    assignments,
  };
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
      .select('id, student_id, enrolee_number')
      .eq('section_id', sectionId),
  ]);

  const sheetIds = (sheets ?? []).map((s) => s.id as string);
  const sectionStudentIds = (enrolments ?? []).map((e) => e.id as string);
  // Transfers are keyed by enroleeNumber, not a section_students id — see the
  // fifth-source note in lib/classroom/timeline.ts. Nullable on older rows.
  const enroleeNumbers = Array.from(
    new Set(
      (enrolments ?? [])
        .map((e) => e.enrolee_number as string | null)
        .filter((n): n is string => !!n)
    )
  );
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

  // Two indexed reads rather than one `.or()`: the enrolee-number source must
  // additionally be action-filtered (an enrolee number keys every `sis.*`
  // admissions action, which would turn this into an admissions feed), and
  // expressing "id IN A, or (id IN B AND action IN C)" in PostgREST's `.or()`
  // grammar is far harder to read than merging two small result sets.
  const [{ data: byEntity }, { data: byEnrolee }] = await Promise.all([
    service
      .from('audit_log')
      .select('id, action, actor_email, context, created_at')
      .in('entity_id', entityIds)
      .order('created_at', { ascending: false })
      .limit(TIMELINE_ROW_LIMIT),
    enroleeNumbers.length > 0
      ? service
          .from('audit_log')
          .select('id, action, actor_email, context, created_at')
          .in('entity_id', enroleeNumbers)
          .in('action', ENROLEE_TIMELINE_ACTIONS as unknown as string[])
          .order('created_at', { ascending: false })
          .limit(TIMELINE_ROW_LIMIT)
      : Promise.resolve({ data: [] as ClassroomTimelineRow[] }),
  ]);

  // Merge, de-dupe by id (a row can't match both sources today, but an
  // overlap must never double-render), re-sort, then re-apply the cap — each
  // query capped independently, so the union can exceed it.
  const seen = new Set<string>();
  const merged: ClassroomTimelineRow[] = [];
  for (const r of [
    ...((byEntity ?? []) as ClassroomTimelineRow[]),
    ...((byEnrolee ?? []) as ClassroomTimelineRow[]),
  ]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return merged.slice(0, TIMELINE_ROW_LIMIT);
}

/**
 * The caller's own private class note (Classroom Settings, Phase 6), or
 * `null` if they haven't written one yet. Deliberately reads via the
 * COOKIE-SCOPED client (the `supabase` param — see migration 094's RLS
 * policy `classroom_notes_own_read`, `teacher_user_id = auth.uid()`), not
 * the service client every other read in this file uses: RLS itself is the
 * privacy boundary here, so the ordinary per-request client already returns
 * exactly and only the caller's own row — no manual `.eq('teacher_user_id',
 * userId)` filter is even necessary, and adding one wouldn't change
 * anything (a mismatched id would just return zero rows, since RLS applies
 * regardless of the query's own filters).
 */
export async function getClassroomNote(
  supabase: SupabaseClient,
  sectionId: string
): Promise<{ content: string; updatedAt: string } | null> {
  const { data } = await supabase
    .from('classroom_notes')
    .select('content, updated_at')
    .eq('section_id', sectionId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { content: string; updated_at: string };
  return { content: row.content, updatedAt: row.updated_at };
}
