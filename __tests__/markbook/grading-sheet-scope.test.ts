import { describe, expect, it } from 'vitest';

import {
  anySectionMissingAssignedSubjects,
  buildGradingSheetScopes,
} from '@/lib/markbook/grading-sheet-scope';

const sections = [
  { id: 'sec-a', level_id: 'lvl-p1' },
  { id: 'sec-b', level_id: 'lvl-p1' },
];
// Post migration 080, subject_configs has no level_id — a config's identity
// is subject_id alone. cfg-other represents a subject_config that exists
// AY-wide but that neither section has ever been assigned via
// section_subjects (e.g. it belongs to a different level's normal
// curriculum — level-applicability is now enforced upstream, at
// section_subjects-assignment time, not here).
const configs = [
  { id: 'cfg-eng', subject_id: 'subj-eng' },
  { id: 'cfg-math', subject_id: 'subj-math' },
  { id: 'cfg-other', subject_id: 'subj-x' },
];
const terms = [{ id: 't1' }, { id: 't2' }];

describe('buildGradingSheetScopes', () => {
  it('creates one scope per (section x assigned subject x term)', () => {
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      { section_id: 'sec-a', subject_config_id: 'cfg-math' },
      { section_id: 'sec-b', subject_config_id: 'cfg-eng' },
    ];
    const scopes = buildGradingSheetScopes(
      sections,
      configs,
      assignments,
      terms
    );
    // sec-a: 2 subjects x 2 terms = 4; sec-b: 1 subject x 2 terms = 2
    expect(scopes).toHaveLength(6);
    expect(scopes.filter((s) => s.section_id === 'sec-a')).toHaveLength(4);
    expect(scopes.filter((s) => s.section_id === 'sec-b')).toHaveLength(2);
  });

  it('excludes a subject not assigned to that section, even if another section has it', () => {
    // sec-b never assigned cfg-math, even though sec-a has it.
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      { section_id: 'sec-a', subject_config_id: 'cfg-math' },
      { section_id: 'sec-b', subject_config_id: 'cfg-eng' },
    ];
    const scopes = buildGradingSheetScopes(
      sections,
      configs,
      assignments,
      terms
    );
    expect(
      scopes.some(
        (s) => s.section_id === 'sec-b' && s.subject_id === 'subj-math'
      )
    ).toBe(false);
  });

  it('excludes a subject_config that is never referenced by any section_subjects row', () => {
    // cfg-other is present in the AY-wide configs list, but neither section
    // has a section_subjects row for it — the sole membership test post
    // migration 080 (no level_id left on subject_configs to fall back on).
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      { section_id: 'sec-b', subject_config_id: 'cfg-eng' },
    ];
    const scopes = buildGradingSheetScopes(
      sections,
      configs,
      assignments,
      terms
    );
    expect(scopes.some((s) => s.subject_id === 'subj-x')).toBe(false);
  });

  it('ignores an assignment row whose subject_config_id has no matching config (defensive, orphaned reference)', () => {
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      { section_id: 'sec-a', subject_config_id: 'cfg-deleted' }, // not in `configs`
    ];
    const scopes = buildGradingSheetScopes(
      sections,
      configs,
      assignments,
      terms
    );
    // 1 config x 2 terms = 2 scopes for sec-a; the orphaned assignment
    // contributes nothing (and, crucially, doesn't throw).
    expect(scopes).toHaveLength(2);
  });

  it('returns empty when no section_subjects rows exist at all', () => {
    const scopes = buildGradingSheetScopes(sections, configs, [], terms);
    expect(scopes).toHaveLength(0);
  });

  it('returns empty when there are no terms', () => {
    const assignments = [{ section_id: 'sec-a', subject_config_id: 'cfg-eng' }];
    const scopes = buildGradingSheetScopes(sections, configs, assignments, []);
    expect(scopes).toHaveLength(0);
  });
});

describe('anySectionMissingAssignedSubjects', () => {
  it('is false when every section has at least one assigned subject', () => {
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      { section_id: 'sec-b', subject_config_id: 'cfg-eng' },
    ];
    expect(
      anySectionMissingAssignedSubjects(sections, configs, assignments)
    ).toBe(false);
  });

  it('is true when one section has zero assigned subjects', () => {
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-eng' },
      // sec-b has none
    ];
    expect(
      anySectionMissingAssignedSubjects(sections, configs, assignments)
    ).toBe(true);
  });

  it('is true when there are no assignments at all', () => {
    expect(anySectionMissingAssignedSubjects(sections, configs, [])).toBe(true);
  });

  it('is false for an empty section list (vacuously true has nothing to flag)', () => {
    expect(anySectionMissingAssignedSubjects([], configs, [])).toBe(false);
  });
});
