// Pure, no I/O. Computes what "Propagate to AYs" WOULD change, before the
// apply_template_to_ay RPC runs — the RPC itself only returns row COUNTS
// (supabase/migrations/031_template_tables.sql:153-234), never field-level
// old->new values, so this preview is computed client/server-side from the
// same two tables the RPC reads, never from the RPC's response.

export type TemplateSubjectConfigRow = {
  subject_id: string;
  level_id: string;
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
    levelId: string;
    field: TemplateConfigField;
    from: number;
    to: number;
  }>;
  newConfigs: Array<{ subjectId: string; levelId: string }>;
};

const FIELD_MAP: Array<[TemplateConfigField, keyof TemplateSubjectConfigRow]> =
  [
    ['wwWeight', 'ww_weight'],
    ['ptWeight', 'pt_weight'],
    ['qaWeight', 'qa_weight'],
    ['wwMaxSlots', 'ww_max_slots'],
    ['ptMaxSlots', 'pt_max_slots'],
    ['qaMax', 'qa_max'],
  ];

function configKey(r: { subject_id: string; level_id: string }): string {
  return `${r.subject_id}|${r.level_id}`;
}
function sectionKey(r: { level_id: string; name: string }): string {
  return `${r.level_id}|${r.name}`;
}

export function computeTemplateDiff(
  templateConfigs: TemplateSubjectConfigRow[],
  actualConfigs: SubjectConfigRow[],
  templateSections: TemplateSectionRow[],
  actualSections: SectionRow[]
): TemplateDiff {
  const actualConfigByKey = new Map(
    actualConfigs.map((c) => [configKey(c), c])
  );
  const actualSectionKeys = new Set(actualSections.map(sectionKey));

  const newSections = templateSections
    .filter((s) => !actualSectionKeys.has(sectionKey(s)))
    .map((s) => ({ levelId: s.level_id, name: s.name }));

  const configChanges: TemplateDiff['configChanges'] = [];
  const newConfigs: TemplateDiff['newConfigs'] = [];

  for (const t of templateConfigs) {
    const actual = actualConfigByKey.get(configKey(t));
    if (!actual) {
      newConfigs.push({ subjectId: t.subject_id, levelId: t.level_id });
      continue;
    }
    for (const [field, key] of FIELD_MAP) {
      if (t[key] !== actual[key]) {
        configChanges.push({
          subjectId: t.subject_id,
          levelId: t.level_id,
          field,
          from: actual[key],
          to: t[key],
        });
      }
    }
  }

  return { newSections, configChanges, newConfigs };
}
