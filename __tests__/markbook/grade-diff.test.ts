import { describe, expect, it } from 'vitest';

import { buildPriorGradeMap } from '@/lib/markbook/grade-diff';

// M2.c — the Alerts (±5 significant-change) column's prior-term lookup must
// survive a KD #67 mid-year transfer: the transfer withdraws the old
// section_students row and inserts a fresh one in the destination section, so
// prior-term grades keyed by the OLD row must be unioned back (via student_id)
// onto the CURRENT section's row id — the key the score-entry grid uses.

const T1 = { term_number: 1, label: 'Term 1' };
const T2 = { term_number: 2, label: 'Term 2' };

const termBySheetId = new Map([
  ['sheet-t1-old-section', T1],
  ['sheet-t2-old-section', T2],
  ['sheet-t1-this-section', T1],
  ['sheet-t2-this-section', T2],
]);

describe('buildPriorGradeMap', () => {
  it('unions a transferred student’s prior grades from the old (withdrawn) enrolment row onto the current row id', () => {
    const result = buildPriorGradeMap({
      currentRoster: [{ id: 'ss-new', student_id: 'X' }],
      enrolmentToStudent: { 'ss-old': 'X', 'ss-new': 'X' },
      entries: [
        // Grades entered in the ORIGIN section, under the now-withdrawn row.
        {
          section_student_id: 'ss-old',
          quarterly_grade: 88,
          grading_sheet_id: 'sheet-t1-old-section',
        },
        {
          section_student_id: 'ss-old',
          quarterly_grade: 90,
          grading_sheet_id: 'sheet-t2-old-section',
        },
      ],
      termBySheetId,
    });

    expect(result['ss-new']).toEqual([
      { term_number: 1, term_label: 'Term 1', quarterly_grade: 88 },
      { term_number: 2, term_label: 'Term 2', quarterly_grade: 90 },
    ]);
  });

  it('prefers a non-null quarterly when the same (student, term) has entries under two enrolment rows', () => {
    // A mid-term transfer seeds a blank entry in the destination sheet —
    // the graded origin entry must win regardless of iteration order.
    const entries = [
      {
        section_student_id: 'ss-new',
        quarterly_grade: null,
        grading_sheet_id: 'sheet-t1-this-section',
      },
      {
        section_student_id: 'ss-old',
        quarterly_grade: 85,
        grading_sheet_id: 'sheet-t1-old-section',
      },
    ];
    for (const ordered of [entries, [...entries].reverse()]) {
      const result = buildPriorGradeMap({
        currentRoster: [{ id: 'ss-new', student_id: 'X' }],
        enrolmentToStudent: { 'ss-old': 'X', 'ss-new': 'X' },
        entries: ordered,
        termBySheetId,
      });
      expect(result['ss-new']).toEqual([
        { term_number: 1, term_label: 'Term 1', quarterly_grade: 85 },
      ]);
    }
  });

  it('keys non-transferred students by their own row id (baseline behavior)', () => {
    const result = buildPriorGradeMap({
      currentRoster: [{ id: 'ss-plain', student_id: 'P' }],
      enrolmentToStudent: { 'ss-plain': 'P' },
      entries: [
        {
          section_student_id: 'ss-plain',
          quarterly_grade: 77,
          grading_sheet_id: 'sheet-t1-this-section',
        },
      ],
      termBySheetId,
    });
    expect(result['ss-plain']).toEqual([
      { term_number: 1, term_label: 'Term 1', quarterly_grade: 77 },
    ]);
  });

  it('omits students with no prior entries and ignores entries from unknown sheets/rows', () => {
    const result = buildPriorGradeMap({
      currentRoster: [
        { id: 'ss-a', student_id: 'A' },
        { id: 'ss-b', student_id: 'B' },
      ],
      enrolmentToStudent: { 'ss-a': 'A', 'ss-b': 'B' },
      entries: [
        // Sheet not in the prior-term map (e.g. current term) — ignored.
        {
          section_student_id: 'ss-a',
          quarterly_grade: 99,
          grading_sheet_id: 'sheet-current-term',
        },
        // Enrolment row not in the map — ignored.
        {
          section_student_id: 'ss-unknown',
          quarterly_grade: 60,
          grading_sheet_id: 'sheet-t1-this-section',
        },
      ],
      termBySheetId,
    });
    expect(result).toEqual({});
  });

  it('sorts a student’s prior grades by term_number ascending', () => {
    const result = buildPriorGradeMap({
      currentRoster: [{ id: 'ss-a', student_id: 'A' }],
      enrolmentToStudent: { 'ss-a': 'A' },
      entries: [
        {
          section_student_id: 'ss-a',
          quarterly_grade: 70,
          grading_sheet_id: 'sheet-t2-this-section',
        },
        {
          section_student_id: 'ss-a',
          quarterly_grade: 72,
          grading_sheet_id: 'sheet-t1-this-section',
        },
      ],
      termBySheetId,
    });
    expect(result['ss-a'].map((g) => g.term_number)).toEqual([1, 2]);
  });
});
