// Who can edit and read a scheme of work, and the rows on a teacher's
// "My schemes of work" list.
//
// `sowCapability` is PURE: the role, the caller's assignments and the one fact
// that needs a query (are they on a step of the current request?) all arrive as
// inputs, so the rule can be read and tested without a database. Routes load
// the assignments with `loadEffectiveAssignmentsForUser` and the step fact with
// `isOnCurrentApprovalStep`, then ask here.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import {
  type EffectiveAssignmentRow,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import { compareLevelLabels } from '@/lib/sis/levels';

export type SowState = 'draft' | 'in_review' | 'returned' | 'approved';
export type SowTrack = 'Standard' | 'Global';

export type SowKey = {
  termId: string;
  subjectId: string;
  levelId: string;
  track: SowTrack;
};

export type SowCapability = 'edit' | 'read' | 'none';

export const SOW_APPROVAL_SUBJECT_TYPE = 'scheme_of_work_submission';

const OFFICE_ROLES: ReadonlySet<Role> = new Set<Role>([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

export function sowCapability(input: {
  role: Role;
  userId: string;
  assignments: EffectiveAssignmentRow[];
  sow: { subjectId: string; state: SowState; classSectionIds: string[] };
  /** The caller is in the approver pool of a stage of the SOW's current request. */
  isOnCurrentApprovalStep?: boolean;
}): SowCapability {
  const { role, assignments, sow } = input;

  // Only the caller's own rows count. Relief rows already carry the caller's id
  // (see loadEffectiveAssignmentsForUser), so this also drops anything passed in
  // by mistake for somebody else.
  const mine = assignments.filter(
    (a) =>
      a.teacher_user_id === input.userId &&
      isSubjectRole(a.role) &&
      a.subject_id === sow.subjectId &&
      sow.classSectionIds.includes(a.section_id)
  );

  // Relief never edits: the regular teacher owns the plan, a substitute only
  // needs to see it to teach from it.
  const holds = mine.some((a) => a.via === 'substantive');
  if (holds && (sow.state === 'draft' || sow.state === 'returned')) {
    return 'edit';
  }
  if (mine.length > 0) return 'read';
  if (OFFICE_ROLES.has(role)) return 'read';
  if (input.isOnCurrentApprovalStep) return 'read';
  return 'none';
}

/**
 * Is this user in the approver pool of any stage of the SOW's current
 * submission request? Pairs with `sowCapability`'s `isOnCurrentApprovalStep`.
 */
export async function isOnCurrentApprovalStep(
  service: SupabaseClient,
  userId: string,
  currentSubmissionId: string | null
): Promise<boolean> {
  if (!currentSubmissionId) return false;
  const { data: request, error } = await service
    .from('approval_requests')
    .select('id')
    .eq('subject_type', SOW_APPROVAL_SUBJECT_TYPE)
    .eq('subject_id', currentSubmissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!request) return false;
  const { data: stages, error: stagesError } = await service
    .from('approval_request_stages')
    .select('id')
    .eq('request_id', (request as { id: string }).id)
    .contains('approver_pool', [userId])
    .limit(1);
  if (stagesError) throw new Error(stagesError.message);
  return (stages ?? []).length > 0;
}

export type MySowRow = SowKey & {
  subjectName: string;
  levelLabel: string;
  classes: { sectionId: string; name: string }[];
  sow: { id: string; state: SowState } | null;
};

type SectionRow = {
  id: string;
  name: string;
  level_id: string;
  class_type: string | null;
  academic_year_id: string;
};

/**
 * One row per subject x level x track in which the teacher holds a substantive
 * subject or co-teacher assignment. Limited to subjects the AY has set up: a
 * `subject_configs` row for the AY (it has no level column) and a
 * `subject_level_offerings` row for the level.
 */
export async function listMySowRows(
  service: SupabaseClient,
  userId: string,
  termId: string
): Promise<MySowRow[]> {
  const assignments = (
    await loadEffectiveAssignmentsForUser(service, userId)
  ).filter(
    (a) => a.via === 'substantive' && isSubjectRole(a.role) && a.subject_id
  );
  if (assignments.length === 0) return [];

  const { data: term, error: termError } = await service
    .from('terms')
    .select('academic_year_id')
    .eq('id', termId)
    .maybeSingle();
  if (termError) throw new Error(termError.message);
  const ayId = (term as { academic_year_id: string } | null)?.academic_year_id;
  if (!ayId) return [];

  const sectionIds = [...new Set(assignments.map((a) => a.section_id))];
  const subjectIds = [...new Set(assignments.map((a) => a.subject_id!))];

  const [sections, configs, offerings, subjects, schemes] = await Promise.all([
    service
      .from('sections')
      .select('id, name, level_id, class_type, academic_year_id')
      .in('id', sectionIds),
    service
      .from('subject_configs')
      .select('subject_id')
      .eq('academic_year_id', ayId)
      .in('subject_id', subjectIds),
    service
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', ayId)
      .in('subject_id', subjectIds),
    service.from('subjects').select('id, name').in('id', subjectIds),
    service
      .from('schemes_of_work')
      .select('id, state, subject_id, level_id, track')
      .eq('term_id', termId),
  ]);
  for (const r of [sections, configs, offerings, subjects, schemes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const sectionById = new Map(
    ((sections.data ?? []) as SectionRow[])
      .filter((s) => s.academic_year_id === ayId)
      .map((s) => [s.id, s])
  );
  const configured = new Set(
    ((configs.data ?? []) as { subject_id: string }[]).map((c) => c.subject_id)
  );
  const offered = new Set(
    ((offerings.data ?? []) as { subject_id: string; level_id: string }[]).map(
      (o) => `${o.subject_id}|${o.level_id}`
    )
  );
  const subjectName = new Map(
    ((subjects.data ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ])
  );

  type Group = {
    subjectId: string;
    levelId: string;
    track: SowTrack;
    classes: Map<string, string>;
  };
  const groups = new Map<string, Group>();
  for (const a of assignments) {
    const section = sectionById.get(a.section_id);
    if (!section) continue;
    const subjectId = a.subject_id!;
    if (!configured.has(subjectId)) continue;
    if (!offered.has(`${subjectId}|${section.level_id}`)) continue;
    const track: SowTrack =
      section.class_type === 'Global' ? 'Global' : 'Standard';
    const key = `${subjectId}|${section.level_id}|${track}`;
    let g = groups.get(key);
    if (!g) {
      g = { subjectId, levelId: section.level_id, track, classes: new Map() };
      groups.set(key, g);
    }
    g.classes.set(section.id, section.name);
  }
  if (groups.size === 0) return [];

  const levelIds = [...new Set([...groups.values()].map((g) => g.levelId))];
  const { data: levels, error: levelsError } = await service
    .from('levels')
    .select('id, label')
    .in('id', levelIds);
  if (levelsError) throw new Error(levelsError.message);
  const levelLabel = new Map(
    ((levels ?? []) as { id: string; label: string }[]).map((l) => [
      l.id,
      l.label,
    ])
  );

  const schemeByKey = new Map(
    (
      (schemes.data ?? []) as {
        id: string;
        state: SowState;
        subject_id: string;
        level_id: string;
        track: SowTrack;
      }[]
    ).map((s) => [`${s.subject_id}|${s.level_id}|${s.track}`, s])
  );

  const rows: MySowRow[] = [...groups.entries()].map(([key, g]) => {
    const scheme = schemeByKey.get(key);
    return {
      termId,
      subjectId: g.subjectId,
      levelId: g.levelId,
      track: g.track,
      subjectName: subjectName.get(g.subjectId) ?? '',
      levelLabel: levelLabel.get(g.levelId) ?? '',
      classes: [...g.classes.entries()]
        .map(([sectionId, name]) => ({ sectionId, name }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      sow: scheme ? { id: scheme.id, state: scheme.state } : null,
    };
  });

  return rows.sort(
    (x, y) =>
      compareLevelLabels(x.levelLabel, y.levelLabel) ||
      x.subjectName.localeCompare(y.subjectName) ||
      x.track.localeCompare(y.track)
  );
}
