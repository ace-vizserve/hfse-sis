import type { SupabaseClient } from '@supabase/supabase-js';

import { joinList, type SubjectSetupSummary } from './setup-summary';

export type { SubjectSetupSummary } from './setup-summary';

// When can a catalog subject be renamed or deleted from Subject Setup?
//
// CHANGE CODE — never, since 2026-09-29: a code is generated at creation
// (lib/sis/subjects/subject-code.ts) and PATCH /catalog/[id] refuses one.
// `findSubjectUsage` / `listUnusedSubjectIds` (every reference below) no
// longer gate anything in the app. The NAME is not gated at all: any
// subject's name can change, audited (PATCH /catalog/[id]).
//
// DELETE — any subject no CLASS uses (Mr Ace, 2026-09-29: "in use means a
// section is using it"). A class uses it when it has a grading sheet, a
// teacher assignment, an evaluation comment, a checklist topic (checklist
// items are per section since migration 047 and carry students' ratings), or
// a `section_subjects` row (per-section subject list, migration 079 — keyed
// by subject_configs.id, so deleting the weights would cascade it). Those are
// per-class / per-student records and are never deleted (Hard Rule #6).
// Everything else is the subject's SETUP and goes with it, snapshotted into
// the audit log first: its weights (subject_configs, every year), the levels
// it is offered at (subject_level_offerings) and its subject_report_map rows —
// its own, plus any other subject reporting under it, which is re-pointed to
// report as itself rather than deleted.
//
// The list is every live table with a foreign key to `subjects.id` (grep
// `references public.subjects` in supabase/migrations; the two template tables
// were dropped by 089 and the SOW tables by 062/065/066). subject_configs is
// ON DELETE RESTRICT; the rest CASCADE — which is why the route checks and
// deletes explicitly rather than trusting the database.
//
// `subject_report_map` is special: every subject is seeded mapped to ITSELF,
// and that row goes with the subject. It only counts as use (for rename) when
// ANOTHER subject reports under this one (Filipino → Mother Tongue).
export type SubjectReference = {
  table: string;
  column: string;
  /** Plain words for the refusal message, e.g. "grading sheets". */
  label: string;
  /** Ignore the row where this subject maps to itself. */
  ignoreSelfMap?: boolean;
};

const GRADING_SHEETS: SubjectReference = {
  table: 'grading_sheets',
  column: 'subject_id',
  label: 'grading sheets',
};
const TEACHER_ASSIGNMENTS: SubjectReference = {
  table: 'teacher_assignments',
  column: 'subject_id',
  label: 'teachers assigned to it',
};
const EVALUATION_COMMENTS: SubjectReference = {
  table: 'evaluation_subject_comments',
  column: 'subject_id',
  label: 'evaluation comments',
};
const CHECKLIST_ITEMS: SubjectReference = {
  table: 'evaluation_checklist_items',
  column: 'subject_id',
  label: 'evaluation checklist items',
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
  GRADING_SHEETS,
  TEACHER_ASSIGNMENTS,
  EVALUATION_COMMENTS,
  CHECKLIST_ITEMS,
  {
    table: 'subject_report_map',
    column: 'report_subject_id',
    label: 'other subjects reported under it',
    ignoreSelfMap: true,
  },
];

/** The references that mean a CLASS uses the subject — these block Delete. */
export const SECTION_USE_REFERENCES: readonly SubjectReference[] = [
  GRADING_SHEETS,
  TEACHER_ASSIGNMENTS,
  EVALUATION_COMMENTS,
  CHECKLIST_ITEMS,
];

/** `section_subjects` is reached through subject_configs, not subject_id. */
export const SECTION_SUBJECTS_LABEL = 'classes that list it';

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

/**
 * The split, pure: given row counts keyed by table name, the labels of the
 * class-use references that hold rows. Empty = Delete is allowed. Setup tables
 * (subject_configs, subject_level_offerings, subject_report_map) never block.
 */
export function sectionUseLabels(counts: Record<string, number>): string[] {
  const labels = SECTION_USE_REFERENCES.filter(
    (ref) => (counts[ref.table] ?? 0) > 0
  ).map((ref) => ref.label);
  if ((counts.section_subjects ?? 0) > 0) labels.push(SECTION_SUBJECTS_LABEL);
  return labels;
}

/** What a class holds on this subject, as labels. Empty = it may be deleted. */
export async function findSectionUse(
  service: SupabaseClient,
  subjectId: string
): Promise<string[]> {
  const counts: Record<string, number> = {};
  await Promise.all(
    SECTION_USE_REFERENCES.map(async (ref) => {
      const { count, error } = await service
        .from(ref.table)
        .select(ref.column, { count: 'exact', head: true })
        .eq(ref.column, subjectId);
      if (error) throw new Error(`${ref.table}: ${error.message}`);
      counts[ref.table] = count ?? 0;
    })
  );
  const { data: configs, error: cfgErr } = await service
    .from('subject_configs')
    .select('id')
    .eq('subject_id', subjectId);
  if (cfgErr) throw new Error(`subject_configs: ${cfgErr.message}`);
  const configIds = ((configs ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (configIds.length > 0) {
    const { count, error } = await service
      .from('section_subjects')
      .select('id', { count: 'exact', head: true })
      .in('subject_config_id', configIds);
    if (error) throw new Error(`section_subjects: ${error.message}`);
    counts.section_subjects = count ?? 0;
  }
  return sectionUseLabels(counts);
}

/** "This subject is already in use — it has grading sheets and …" */
export function subjectInUseMessage(labels: string[], verb: string): string {
  return `This subject is already in use — it has ${joinList(labels)}. Only a subject nothing uses yet can be ${verb}.`;
}

/** The Delete refusal: a class uses it. */
export function sectionUseMessage(labels: string[]): string {
  return `A class uses this subject — it has ${joinList(labels)}. A subject a class uses stays in the catalog.`;
}

// ─── The setup that goes with a deleted subject ─────────────────────────────

export type SubjectConfigRow = Record<string, unknown> & {
  id: string;
  academic_year_id: string;
};
export type SubjectOfferingRow = Record<string, unknown> & {
  id: string;
  level_id: string;
};
export type SubjectReportMapRow = {
  id?: string;
  subject_id: string;
  report_subject_id: string;
};

export type SubjectSetup = {
  configs: SubjectConfigRow[];
  offerings: SubjectOfferingRow[];
  /** This subject's own rows (subject_id = it), self-map included. */
  ownMaps: SubjectReportMapRow[];
  /** Other subjects reporting under this one — re-pointed to themselves. */
  reportedUnder: Array<{ subject_id: string; code: string; name: string }>;
  /** ay_code per academic_year_id, for the confirm and the audit row. */
  ayCodes: Record<string, string>;
};

export function summarizeSubjectSetup(
  setup: SubjectSetup
): SubjectSetupSummary {
  const years = new Set(
    setup.configs.map(
      (c) => setup.ayCodes[c.academic_year_id] ?? c.academic_year_id
    )
  );
  return {
    weightYears: [...years].sort(),
    levelCount: new Set(setup.offerings.map((o) => o.level_id)).size,
    reportedUnder: setup.reportedUnder.map((r) => r.name).sort(),
  };
}

/** Load the setup rows a Delete would remove or re-point. */
export async function loadSubjectSetup(
  service: SupabaseClient,
  subjectId: string
): Promise<SubjectSetup> {
  const [configsRes, offeringsRes, ownRes, underRes] = await Promise.all([
    service.from('subject_configs').select('*').eq('subject_id', subjectId),
    service
      .from('subject_level_offerings')
      .select('*')
      .eq('subject_id', subjectId),
    service
      .from('subject_report_map')
      .select('id, subject_id, report_subject_id')
      .eq('subject_id', subjectId),
    service
      .from('subject_report_map')
      .select('id, subject_id, report_subject_id')
      .eq('report_subject_id', subjectId)
      .neq('subject_id', subjectId),
  ]);
  for (const [table, res] of [
    ['subject_configs', configsRes],
    ['subject_level_offerings', offeringsRes],
    ['subject_report_map', ownRes],
    ['subject_report_map', underRes],
  ] as const) {
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
  }
  const configs = (configsRes.data ?? []) as SubjectConfigRow[];
  const offerings = (offeringsRes.data ?? []) as SubjectOfferingRow[];
  const ownMaps = (ownRes.data ?? []) as SubjectReportMapRow[];
  const underRows = (underRes.data ?? []) as SubjectReportMapRow[];

  const ayIds = [...new Set(configs.map((c) => c.academic_year_id))];
  const underIds = [...new Set(underRows.map((r) => r.subject_id))];
  const [aysRes, namesRes] = await Promise.all([
    ayIds.length > 0
      ? service.from('academic_years').select('id, ay_code').in('id', ayIds)
      : Promise.resolve({ data: [], error: null }),
    underIds.length > 0
      ? service.from('subjects').select('id, code, name').in('id', underIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (aysRes.error) throw new Error(`academic_years: ${aysRes.error.message}`);
  if (namesRes.error) throw new Error(`subjects: ${namesRes.error.message}`);
  const ayCodes = Object.fromEntries(
    ((aysRes.data ?? []) as Array<{ id: string; ay_code: string }>).map((a) => [
      a.id,
      a.ay_code,
    ])
  );
  const names = new Map(
    (
      (namesRes.data ?? []) as Array<{ id: string; code: string; name: string }>
    ).map((s) => [s.id, s])
  );
  return {
    configs,
    offerings,
    ownMaps,
    reportedUnder: underIds.map((id) => ({
      subject_id: id,
      code: names.get(id)?.code ?? '',
      name: names.get(id)?.name ?? id,
    })),
    ayCodes,
  };
}

/**
 * Which of `subjectIds` are unused, for the catalog to know where to offer
 * Rename. `subject_configs` is small (one row per subject per year), so it
 * rules out almost every subject in one read; only the few left get the
 * full check.
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

/**
 * The subjects no class uses, each with what a Delete would take with it —
 * for the catalog's Delete item and its confirm. Grading sheets rule out
 * almost every live subject, so they are checked first, one head count per
 * subject; only the rest get the full check and the setup read. A failed
 * check leaves the subject out (no Delete offered), never in.
 */
export async function listDeletableSubjects(
  service: SupabaseClient,
  subjectIds: string[]
): Promise<Record<string, SubjectSetupSummary>> {
  const noSheets = await Promise.all(
    subjectIds.map(async (id) => {
      const { count, error } = await service
        .from('grading_sheets')
        .select('subject_id', { count: 'exact', head: true })
        .eq('subject_id', id);
      if (error) {
        console.error('[subjects] sheet check failed:', error.message);
        return null;
      }
      return (count ?? 0) === 0 ? id : null;
    })
  );
  const entries = await Promise.all(
    noSheets
      .filter((id): id is string => id !== null)
      .map(async (id) => {
        try {
          if ((await findSectionUse(service, id)).length > 0) return null;
          const setup = await loadSubjectSetup(service, id);
          return [id, summarizeSubjectSetup(setup)] as const;
        } catch (e) {
          console.error(
            '[subjects] delete check failed:',
            (e as Error).message
          );
          return null;
        }
      })
  );
  return Object.fromEntries(
    entries.filter(
      (e): e is readonly [string, SubjectSetupSummary] => e !== null
    )
  );
}
