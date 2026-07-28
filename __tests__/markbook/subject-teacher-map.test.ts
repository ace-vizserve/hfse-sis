/**
 * buildSubjectTeacherNameMap() — pure batch resolver for the grading sheet's
 * "who teaches this subject" line. Subject teachers must resolve from LIVE
 * teacher_assignments rows, never the denormalized `grading_sheets.teacher_name`
 * column (written once at sheet creation, never updated — so it drifts, and on
 * AY2026 it is simply empty).
 *
 * Extracted as a pure function (no Supabase mocking needed) — same spirit as
 * buildFormAdviserNameMap in lib/markbook/masterfile.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSubjectTeacherNameMap,
  subjectTeacherKey,
} from '@/lib/markbook/subject-teacher';

describe('subjectTeacherKey', () => {
  it('composes a section and subject into one lookup key', () => {
    expect(subjectTeacherKey('sec-1', 'sub-1')).toBe('sec-1|sub-1');
  });
});

describe('buildSubjectTeacherNameMap', () => {
  it('resolves a single assignment to its teacher display name', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
      ],
      [['user-1', 'Maria T.']]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Maria T.']);
  });

  it('returns every teacher when a section+subject is co-taught, in input order', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual([
      'Maria T.',
      'Daniel L.',
    ]);
  });

  it('keeps separate subjects in the same section apart', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
        {
          section_id: 'sec-1',
          subject_id: 'sub-2',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Maria T.']);
    expect(map.get(subjectTeacherKey('sec-1', 'sub-2'))).toEqual(['Daniel L.']);
  });

  it('a section+subject with no assignment is absent from the map (caller renders the empty state)', () => {
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-1',
        },
      ],
      [['user-1', 'Maria T.']]
    );
    expect(map.has(subjectTeacherKey('sec-9', 'sub-9'))).toBe(false);
    expect(map.get(subjectTeacherKey('sec-9', 'sub-9')) ?? null).toBeNull();
  });

  it('falls back to the raw teacher_user_id when no staff name matches, never a blank', () => {
    // A superadmin seeing an id knows exactly which account to fix; a blank
    // is indistinguishable from "nobody assigned".
    const map = buildSubjectTeacherNameMap(
      [
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'ghost-user',
        },
      ],
      []
    );
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual([
      'ghost-user',
    ]);
  });

  it('skips a row with a null subject_id instead of keying on "null"', () => {
    // The CHECK constraint on teacher_assignments already prevents this for
    // subject_teacher rows; the helper takes plain data and does not trust it.
    const map = buildSubjectTeacherNameMap(
      [
        { section_id: 'sec-1', subject_id: null, teacher_user_id: 'user-1' },
        {
          section_id: 'sec-1',
          subject_id: 'sub-1',
          teacher_user_id: 'user-2',
        },
      ],
      [
        ['user-1', 'Maria T.'],
        ['user-2', 'Daniel L.'],
      ]
    );
    expect(map.size).toBe(1);
    expect(map.get(subjectTeacherKey('sec-1', 'sub-1'))).toEqual(['Daniel L.']);
    expect(map.has('sec-1|null')).toBe(false);
  });

  it('returns an empty map for no assignments', () => {
    expect(buildSubjectTeacherNameMap([], [['user-1', 'Maria T.']]).size).toBe(
      0
    );
  });
});
