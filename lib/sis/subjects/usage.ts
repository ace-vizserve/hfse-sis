import type { SupabaseClient } from '@supabase/supabase-js';

// Is a catalog subject in use? Only an UNUSED one may be renamed (code + name)
// or deleted from Subject Setup — a subject nothing points at yet is a typo
// being corrected, anything else is history.
//
// The list is every live table with a foreign key to `subjects.id` (grep
// `references public.subjects` in supabase/migrations; the two template tables
// were dropped by 089 and the SOW tables by 062/065/066). Several of these are
// ON DELETE CASCADE, so without this check a delete would quietly take a
// teacher's assignments or evaluation comments with it — the check is what
// stops that, not the database.
//
// `subject_report_map` is special: every subject is seeded mapped to ITSELF,
// and that row goes with the subject. It only counts as use when ANOTHER
// subject reports under this one (Filipino → Mother Tongue).
export type SubjectReference = {
  table: string;
  column: string;
  /** Plain words for the refusal message, e.g. "grading sheets". */
  label: string;
  /** Ignore the row where this subject maps to itself. */
  ignoreSelfMap?: boolean;
};

export const SUBJECT_REFERENCES: readonly SubjectReference[] = [
  {
    table: 'subject_configs',
    column: 'subject_id',
    label: 'weights set for a school year',
  },
  {
    table: 'subject_level_offerings',
    column: 'subject_id',
    label: 'levels it is taught at',
  },
  { table: 'grading_sheets', column: 'subject_id', label: 'grading sheets' },
  {
    table: 'teacher_assignments',
    column: 'subject_id',
    label: 'teachers assigned to it',
  },
  {
    table: 'evaluation_subject_comments',
    column: 'subject_id',
    label: 'evaluation comments',
  },
  {
    table: 'evaluation_checklist_items',
    column: 'subject_id',
    label: 'evaluation checklist items',
  },
  {
    table: 'subject_report_map',
    column: 'report_subject_id',
    label: 'other subjects reported under it',
    ignoreSelfMap: true,
  },
];

/** The labels of every reference that holds at least one row. Empty = unused. */
export async function findSubjectUsage(
  service: SupabaseClient,
  subjectId: string
): Promise<string[]> {
  const results = await Promise.all(
    SUBJECT_REFERENCES.map(async (ref) => {
      let query = service
        .from(ref.table)
        .select(ref.column, { count: 'exact', head: true })
        .eq(ref.column, subjectId);
      if (ref.ignoreSelfMap) query = query.neq('subject_id', subjectId);
      const { count, error } = await query;
      if (error) throw new Error(`${ref.table}: ${error.message}`);
      return (count ?? 0) > 0 ? ref.label : null;
    })
  );
  return results.filter((l): l is string => l !== null);
}

/** "This subject is already in use — it has grading sheets and …" */
export function subjectInUseMessage(labels: string[], verb: string): string {
  const list =
    labels.length <= 1
      ? (labels[0] ?? '')
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `This subject is already in use — it has ${list}. Only a subject nothing uses yet can be ${verb}.`;
}

/**
 * Which of `subjectIds` are unused, for the catalog to know where to offer
 * Rename and Delete. `subject_configs` is small (one row per subject per
 * year), so it rules out almost every subject in one read; only the few
 * left get the full check.
 */
export async function listUnusedSubjectIds(
  service: SupabaseClient,
  subjectIds: string[]
): Promise<string[]> {
  if (subjectIds.length === 0) return [];
  const { data, error } = await service
    .from('subject_configs')
    .select('subject_id')
    .in('subject_id', subjectIds);
  if (error) {
    console.error('[subjects] listUnusedSubjectIds failed:', error.message);
    return [];
  }
  const configured = new Set(
    ((data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)
  );
  const candidates = subjectIds.filter((id) => !configured.has(id));
  const checked = await Promise.all(
    candidates.map(async (id) => {
      try {
        return (await findSubjectUsage(service, id)).length === 0 ? id : null;
      } catch (e) {
        console.error('[subjects] usage check failed:', (e as Error).message);
        return null;
      }
    })
  );
  return checked.filter((id): id is string => id !== null);
}
