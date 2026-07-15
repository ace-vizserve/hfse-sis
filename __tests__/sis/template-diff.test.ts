import { describe, expect, it } from 'vitest';
import { computeTemplateDiff } from '@/lib/sis/template-diff';

// Migration 080 collapsed subject_configs to one row per subject — no more
// level_id on config rows. Level-applicability is a separate axis now,
// covered by the templateOfferings/actualOfferings params.
const TEMPLATE_CONFIGS = [
  {
    subject_id: 'sci',
    ww_weight: 0.35,
    pt_weight: 0.45,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
];
const ACTUAL_CONFIGS = [
  {
    subject_id: 'sci',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
];
const TEMPLATE_SECTIONS = [
  { level_id: 'p3', name: 'Obedience' },
  { level_id: 's3', name: 'Consistency' },
];
const ACTUAL_SECTIONS = [{ level_id: 'p3', name: 'Obedience' }];

describe('computeTemplateDiff', () => {
  it('reports a weight change only for the subject that actually differs', () => {
    const diff = computeTemplateDiff(
      TEMPLATE_CONFIGS,
      ACTUAL_CONFIGS,
      TEMPLATE_SECTIONS,
      ACTUAL_SECTIONS
    );
    expect(diff.configChanges).toEqual([
      {
        subjectId: 'sci',
        field: 'wwWeight',
        from: 0.4,
        to: 0.35,
      },
      {
        subjectId: 'sci',
        field: 'ptWeight',
        from: 0.4,
        to: 0.45,
      },
    ]);
  });

  it('reports a new section not present in the target AY', () => {
    const diff = computeTemplateDiff(
      TEMPLATE_CONFIGS,
      ACTUAL_CONFIGS,
      TEMPLATE_SECTIONS,
      ACTUAL_SECTIONS
    );
    expect(diff.newSections).toEqual([{ levelId: 's3', name: 'Consistency' }]);
  });

  it('reports a new config for a subject with no existing row in the target AY', () => {
    const diff = computeTemplateDiff(
      [
        { ...TEMPLATE_CONFIGS[0], ww_weight: 0.4, pt_weight: 0.4 }, // sci, matching actual
        TEMPLATE_CONFIGS[1], // math
      ],
      [ACTUAL_CONFIGS[0]], // math is missing from the target AY
      [],
      []
    );
    expect(diff.newConfigs).toEqual([{ subjectId: 'math' }]);
    expect(diff.configChanges).toEqual([]);
  });

  it('produces an empty diff when template and target already match', () => {
    const diff = computeTemplateDiff(
      [TEMPLATE_CONFIGS[1]], // math only, matches actual exactly
      [ACTUAL_CONFIGS[1]],
      [],
      []
    );
    expect(diff).toEqual({
      newSections: [],
      configChanges: [],
      newConfigs: [],
      newOfferings: [],
    });
  });

  it('reports a level offering the template has that the target AY is missing', () => {
    const diff = computeTemplateDiff(
      [],
      [],
      [],
      [],
      [
        { subject_id: 'sci', level_id: 'p3' },
        { subject_id: 'math', level_id: 'p3' },
      ],
      [{ subject_id: 'sci', level_id: 'p3' }] // math|p3 is missing
    );
    expect(diff.newOfferings).toEqual([{ subjectId: 'math', levelId: 'p3' }]);
  });

  it('never reports an offering removal — the RPC is additive-only', () => {
    // The target AY has an offering the template no longer lists (e.g. the
    // subject was detached from the template's level). apply_template_to_ay
    // never deletes, so the diff must not surface this as a "change."
    const diff = computeTemplateDiff(
      [],
      [],
      [],
      [],
      [], // template no longer offers anything
      [{ subject_id: 'sci', level_id: 'p3' }] // but the AY still has it
    );
    expect(diff.newOfferings).toEqual([]);
  });
});
