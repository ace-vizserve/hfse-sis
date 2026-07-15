// Pure, no I/O. Computes what "Propagate to AYs" WOULD change, before the
// apply_template_to_ay RPC runs — the RPC itself only returns row COUNTS
// (supabase/migrations/080_subject_weights_collapse.sql, §6), never
// field-level old->new values, so this preview is computed client/
// server-side from the same tables the RPC reads, never from the RPC's
// response.
//
// Migration 080 collapsed `template_subject_configs`/`subject_configs` from
// (subject × level) to subject alone, and moved level-applicability to a
// new pair of tables (`template_subject_level_offerings` /
// `subject_level_offerings`). So the diff now has three independent axes,
// matching apply_template_to_ay's three UPSERT/INSERT statements:
//   1. sections — level-keyed, unchanged.
//   2. subject_configs — subject-keyed only, no level.
//   3. subject_level_offerings — additive-only (the RPC never removes an
//      offering an AY already has), so this axis only ever reports
//      "will be added," never a change or removal.

export type TemplateSubjectConfigRow = {
  subject_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};
export type SubjectConfigRow = TemplateSubjectConfigRow;
export type TemplateSectionRow = { level_id: string; name: string };
export type SectionRow = { level_id: string; name: string };
export type SubjectLevelOfferingRow = { subject_id: string; level_id: string };

export type TemplateConfigField =
  | 'wwWeight'
  | 'ptWeight'
  | 'qaWeight'
  | 'wwMaxSlots'
  | 'ptMaxSlots'
  | 'qaMax';

export type TemplateDiff = {
  newSections: Array<{ levelId: string; name: string }>;
  configChanges: Array<{
    subjectId: string;
    field: TemplateConfigField;
    from: number;
    to: number;
  }>;
  newConfigs: Array<{ subjectId: string }>;
  // Level attachments apply_template_to_ay would additively insert — a
  // subject the template teaches at a level the target AY doesn't have an
  // offering row for yet. Never a "change" or "removal": the RPC's
  // offerings INSERT is ON CONFLICT DO NOTHING, so an existing offering is
  // never touched.
  newOfferings: Array<{ subjectId: string; levelId: string }>;
};

type NumericField = Exclude<keyof TemplateSubjectConfigRow, 'subject_id'>;

const FIELD_MAP: Array<[TemplateConfigField, NumericField]> = [
  ['wwWeight', 'ww_weight'],
  ['ptWeight', 'pt_weight'],
  ['qaWeight', 'qa_weight'],
  ['wwMaxSlots', 'ww_max_slots'],
  ['ptMaxSlots', 'pt_max_slots'],
  ['qaMax', 'qa_max'],
];

function sectionKey(r: { level_id: string; name: string }): string {
  return `${r.level_id}|${r.name}`;
}
function offeringKey(r: { subject_id: string; level_id: string }): string {
  return `${r.subject_id}|${r.level_id}`;
}

export function computeTemplateDiff(
  templateConfigs: TemplateSubjectConfigRow[],
  actualConfigs: SubjectConfigRow[],
  templateSections: TemplateSectionRow[],
  actualSections: SectionRow[],
  templateOfferings: SubjectLevelOfferingRow[] = [],
  actualOfferings: SubjectLevelOfferingRow[] = []
): TemplateDiff {
  const actualConfigBySubject = new Map(
    actualConfigs.map((c) => [c.subject_id, c])
  );
  const actualSectionKeys = new Set(actualSections.map(sectionKey));
  const actualOfferingKeys = new Set(actualOfferings.map(offeringKey));

  const newSections = templateSections
    .filter((s) => !actualSectionKeys.has(sectionKey(s)))
    .map((s) => ({ levelId: s.level_id, name: s.name }));

  const configChanges: TemplateDiff['configChanges'] = [];
  const newConfigs: TemplateDiff['newConfigs'] = [];

  for (const t of templateConfigs) {
    const actual = actualConfigBySubject.get(t.subject_id);
    if (!actual) {
      newConfigs.push({ subjectId: t.subject_id });
      continue;
    }
    for (const [field, key] of FIELD_MAP) {
      if (t[key] !== actual[key]) {
        configChanges.push({
          subjectId: t.subject_id,
          field,
          from: actual[key],
          to: t[key],
        });
      }
    }
  }

  const newOfferings = templateOfferings
    .filter((o) => !actualOfferingKeys.has(offeringKey(o)))
    .map((o) => ({ subjectId: o.subject_id, levelId: o.level_id }));

  return { newSections, configChanges, newConfigs, newOfferings };
}
