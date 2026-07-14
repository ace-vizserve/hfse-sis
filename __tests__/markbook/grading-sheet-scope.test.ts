import { describe, expect, it } from 'vitest';

import {
  anySectionMissingAssignedSubjects,
  buildGradingSheetScopes,
} from '@/lib/markbook/grading-sheet-scope';

const sections = [
  { id: 'sec-a', level_id: 'lvl-p1' },
  { id: 'sec-b', level_id: 'lvl-p1' },
];
const configs = [
  { id: 'cfg-eng', subject_id: 'subj-eng', level_id: 'lvl-p1' },
  { id: 'cfg-math', subject_id: 'subj-math', level_id: 'lvl-p1' },
  { id: 'cfg-other-level', subject_id: 'subj-x', level_id: 'lvl-p2' },
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

  it('excludes a subject not assigned to that section even if configured at its level', () => {
    // sec-b never assigned cfg-math, even though it's configured at lvl-p1.
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

  it('never crosses levels — a config at a different level never appears', () => {
    const assignments = [
      { section_id: 'sec-a', subject_config_id: 'cfg-other-level' }, // shouldn't happen, but defensively excluded by level_id mismatch
    ];
    const scopes = buildGradingSheetScopes(
      sections,
      configs,
      assignments,
      terms
    );
    expect(scopes).toHaveLength(0);
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
