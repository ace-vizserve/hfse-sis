/**
 * computeSubjectConfigGaps() — the warning banner's data source on
 * /sis/admin/subjects. Closes the "zero visibility" gap: a missing
 * subject-at-level offering used to silently drop that subject from the
 * report card with no signal anywhere.
 *
 * Post migration-080: the function is a pure {level_id, subject_id}
 * presence check, unchanged in logic — only its real callers' data source
 * moved from template_subject_configs/subject_configs (level_id dropped)
 * to template_subject_level_offerings/subject_level_offerings. These
 * fixture pairs are intentionally source-agnostic (any {level_id,
 * subject_id} shape exercises the same logic), so no test bodies changed.
 */

import { describe, expect, it } from 'vitest';
import { computeSubjectConfigGaps } from '@/lib/sis/subject-config-gaps';

const LEVELS = [
  { id: 'lvl-p3', label: 'Primary 3' },
  { id: 'lvl-s1', label: 'Secondary 1' },
];
const SUBJECTS = [
  { id: 'sub-math', code: 'MATH' },
  { id: 'sub-sci', code: 'SCI' },
  { id: 'sub-pe', code: 'PE' },
  { id: 'sub-arts', code: 'ARTS' },
];

describe('computeSubjectConfigGaps', () => {
  it('returns no gaps when every template subject has a matching config', () => {
    const gaps = computeSubjectConfigGaps(
      LEVELS,
      SUBJECTS,
      [
        { level_id: 'lvl-p3', subject_id: 'sub-math' },
        { level_id: 'lvl-p3', subject_id: 'sub-sci' },
      ],
      [
        { level_id: 'lvl-p3', subject_id: 'sub-math' },
        { level_id: 'lvl-p3', subject_id: 'sub-sci' },
      ]
    );
    expect(gaps).toEqual([]);
  });

  it('reports the missing subject codes for a level with an incomplete config set', () => {
    const gaps = computeSubjectConfigGaps(
      LEVELS,
      SUBJECTS,
      [
        { level_id: 'lvl-p3', subject_id: 'sub-math' },
        { level_id: 'lvl-p3', subject_id: 'sub-sci' },
        { level_id: 'lvl-p3', subject_id: 'sub-pe' },
      ],
      [{ level_id: 'lvl-p3', subject_id: 'sub-math' }]
    );
    expect(gaps).toEqual([
      {
        levelId: 'lvl-p3',
        levelLabel: 'Primary 3',
        missingSubjectCodes: ['PE', 'SCI'],
      },
    ]);
  });

  it('treats a level with no template rows as complete — never a false positive', () => {
    const gaps = computeSubjectConfigGaps(
      LEVELS,
      SUBJECTS,
      [{ level_id: 'lvl-p3', subject_id: 'sub-math' }], // no template rows for lvl-s1
      []
    );
    expect(gaps.find((g) => g.levelId === 'lvl-s1')).toBeUndefined();
  });

  it('covers multiple levels independently, sorted by level label', () => {
    const gaps = computeSubjectConfigGaps(
      LEVELS,
      SUBJECTS,
      [
        { level_id: 'lvl-p3', subject_id: 'sub-math' },
        { level_id: 'lvl-s1', subject_id: 'sub-arts' },
      ],
      []
    );
    expect(gaps.map((g) => g.levelLabel)).toEqual(['Primary 3', 'Secondary 1']);
    expect(
      gaps.find((g) => g.levelId === 'lvl-s1')?.missingSubjectCodes
    ).toEqual(['ARTS']);
  });

  it('a subject id with no matching subject row is silently dropped, never crashes', () => {
    const gaps = computeSubjectConfigGaps(
      LEVELS,
      SUBJECTS,
      [{ level_id: 'lvl-p3', subject_id: 'sub-unknown' }],
      []
    );
    expect(gaps).toEqual([]);
  });
});
