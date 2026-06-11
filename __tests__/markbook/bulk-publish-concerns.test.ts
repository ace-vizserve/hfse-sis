import { describe, it, expect } from 'vitest';

import {
  concernsFor,
  concernHref,
} from '@/components/admin/bulk-publish-concerns';

const base = {
  comment_gate: { ok: true, gaps: [] },
  hardBlockers: [],
  softGaps: [],
};

describe('concernsFor', () => {
  it('maps soft + hard codes to severities', () => {
    const out = concernsFor({
      ...base,
      hardBlockers: [{ code: 'no_grading_sheets', label: 'No grading sheets' }],
      softGaps: [{ code: 'attendance_incomplete', label: '2 attendance gaps' }],
    });
    expect(out.find((c) => c.code === 'no_grading_sheets')?.severity).toBe(
      'hard'
    );
    expect(out.find((c) => c.code === 'attendance_incomplete')?.severity).toBe(
      'soft'
    );
  });

  it('splits comments_incomplete into comments + virtue per comment_gate', () => {
    const out = concernsFor({
      ...base,
      hardBlockers: [
        { code: 'comments_incomplete', label: 'Adviser comments incomplete' },
      ],
      comment_gate: {
        ok: false,
        gaps: [
          { term_number: 1, missing: [{}], virtue_missing: false },
          { term_number: 2, missing: [], virtue_missing: true },
        ],
      },
    });
    const codes = out.map((c) => c.code);
    expect(codes).toContain('comments'); // has missing students
    expect(codes).toContain('virtue'); // has virtue_missing
    expect(codes).not.toContain('comments_incomplete'); // expanded, not raw
    expect(out.every((c) => c.severity === 'hard')).toBe(true);
  });

  it('comments_incomplete with only virtue gaps yields just a virtue concern', () => {
    const out = concernsFor({
      ...base,
      hardBlockers: [
        { code: 'comments_incomplete', label: 'Adviser comments incomplete' },
      ],
      comment_gate: {
        ok: false,
        gaps: [{ term_number: 1, missing: [], virtue_missing: true }],
      },
    });
    expect(out.map((c) => c.code)).toEqual(['virtue']);
  });

  it('ready section → no concerns', () => {
    expect(concernsFor(base)).toEqual([]);
  });
});

describe('concernHref', () => {
  const ctx = { sectionId: 'sec-1', sectionName: 'Obedience', termId: 't1' };
  it('routes each code to its fix surface; term carried where supported', () => {
    expect(concernHref('attendance_incomplete', ctx)).toBe(
      '/attendance/sec-1?term_id=t1'
    );
    expect(concernHref('comments', ctx)).toBe(
      '/evaluation/sections/sec-1?term_id=t1'
    );
    expect(concernHref('virtue', ctx)).toBe('/evaluation/virtue-themes');
    expect(concernHref('sheets_unlocked', ctx)).toBe(
      '/markbook/grading?grading.section=Obedience'
    );
    expect(concernHref('no_grading_sheets', ctx)).toBe(
      '/markbook/grading?grading.section=Obedience'
    );
    expect(concernHref('grades_missing', ctx)).toBe(
      '/markbook/grading?grading.section=Obedience'
    );
    expect(concernHref('nonexam_finals_missing', ctx)).toBe(
      '/markbook/report-cards'
    );
    expect(concernHref('letterhead_incomplete', ctx)).toBe(
      '/sis/admin/school-config'
    );
    expect(concernHref('no_students', ctx)).toBeNull();
  });

  it('encodes section names with spaces for the grading facet', () => {
    expect(
      concernHref('sheets_unlocked', {
        sectionId: 's',
        sectionName: 'Whole Day',
        termId: 't',
      })
    ).toBe('/markbook/grading?grading.section=Whole%20Day');
  });
});
