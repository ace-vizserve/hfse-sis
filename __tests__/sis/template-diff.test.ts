import { describe, expect, it } from 'vitest';
import { computeTemplateDiff } from '@/lib/sis/template-diff';

const TEMPLATE_CONFIGS = [
  {
    subject_id: 'sci',
    level_id: 'p3',
    ww_weight: 0.35,
    pt_weight: 0.45,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    level_id: 'p3',
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
    level_id: 'p3',
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  },
  {
    subject_id: 'math',
    level_id: 'p3',
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
        levelId: 'p3',
        field: 'wwWeight',
        from: 0.4,
        to: 0.35,
      },
      {
        subjectId: 'sci',
        levelId: 'p3',
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

  it('reports a new config for a (subject, level) with no existing row', () => {
    const diff = computeTemplateDiff(
      [
        { ...TEMPLATE_CONFIGS[0], ww_weight: 0.4, pt_weight: 0.4 }, // sci, matching actual
        TEMPLATE_CONFIGS[1], // math
      ],
      [ACTUAL_CONFIGS[0]], // math is missing from the target AY
      [],
      []
    );
    expect(diff.newConfigs).toEqual([{ subjectId: 'math', levelId: 'p3' }]);
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
    });
  });
});
