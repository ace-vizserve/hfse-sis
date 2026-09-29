import { describe, expect, it } from 'vitest';

import type {
  ChangeRequestRow,
  GradeEntryRow,
  SheetRow,
} from '@/lib/markbook/drill';
import { insightsDrillSummary } from '@/lib/markbook/insights-drill';

function entry(over: Partial<GradeEntryRow>): GradeEntryRow {
  return {
    entryId: 'e',
    studentId: 's',
    studentName: 'Doe, Jane',
    studentNumber: 'H1',
    enroleeNumber: 'H1',
    level: 'P1',
    sectionId: 'sec',
    sectionName: 'Patience',
    subjectCode: 'MATH',
    subjectName: 'Mathematics',
    subjectCatalogName: 'Mathematics',
    termNumber: 2,
    termId: 't2',
    wwScores: [],
    ptScores: [],
    qaScore: null,
    qaMax: 30,
    letterGrade: null,
    rawScore: null,
    maxScore: 30,
    computedGrade: 80,
    gradeBucket: 's',
    isExaminable: true,
    isNa: false,
    isLocked: false,
    enteredAt: '2026-02-01T00:00:00Z',
    enteredBy: null,
    enteredById: null,
    ...over,
  };
}

describe('insightsDrillSummary', () => {
  it('subject × term: count and average', () => {
    expect(
      insightsDrillSummary('subject-term-entries', 'Mathematics|T2', [
        entry({ computedGrade: 80 }),
        entry({ computedGrade: 85 }),
      ])
    ).toBe('2 grades · average 82.5');
  });

  it('level × term: says the level figure averages the subject averages', () => {
    const rows = [
      entry({ computedGrade: 80 }),
      entry({ computedGrade: 90, subjectCatalogName: 'English' }),
      entry({ computedGrade: 70, subjectCatalogName: 'English' }),
    ];
    expect(insightsDrillSummary('level-term-entries', 'P1|T2', rows)).toBe(
      "3 grades across 2 subjects · level average 80.0 (each subject's average, averaged)"
    );
  });

  it('subject × level: first and latest term side by side', () => {
    const rows = [
      entry({ termNumber: 1, computedGrade: 90 }),
      entry({ termNumber: 3, computedGrade: 80 }),
      entry({ termNumber: 3, computedGrade: 70 }),
    ];
    expect(
      insightsDrillSummary('subject-level-entries', 'Mathematics|P1', rows)
    ).toBe('Term 1: average 90.0 (1 grade) → Term 3: average 75.0 (2 grades)');
  });

  it('windowed decided change requests: the average decision time', () => {
    const cr = (over: Partial<ChangeRequestRow>): ChangeRequestRow => ({
      requestId: 'r',
      status: 'approved',
      sheetId: 'sh',
      sectionId: 'sec',
      sectionName: 'Patience',
      subjectCode: 'MATH',
      subjectName: 'Mathematics',
      termNumber: 1,
      termId: 't1',
      fieldChanged: 'ww_scores',
      reasonCategory: 'data_entry_error',
      requestedBy: 't@hfse.test',
      requestedAt: '2026-09-10T00:00:00Z',
      resolvedAt: null,
      reviewedAt: '2026-09-11T06:00:00Z',
      ...over,
    });
    expect(
      insightsDrillSummary('change-requests', '30d:decided', [cr({})])
    ).toBe('1 decision · average 30 hours from request to decision');
    expect(
      insightsDrillSummary('change-requests', '30d', [cr({}), cr({})])
    ).toBe('2 requests in the last 30 days');
    expect(
      insightsDrillSummary('change-requests', 'pending', [cr({})])
    ).toBeNull();
  });

  it('term sheet status: the locked share', () => {
    const sheet = (isLocked: boolean) => ({ isLocked }) as SheetRow;
    expect(
      insightsDrillSummary('term-sheet-status', 'T2', [
        sheet(true),
        sheet(false),
        sheet(false),
      ])
    ).toBe('1 of 3 sheets locked (33%)');
  });

  it('an empty list says so', () => {
    expect(
      insightsDrillSummary('subject-term-entries', 'Mathematics|T2', [])
    ).toBe('No grades in this list.');
  });

  it('other targets get no summary', () => {
    expect(insightsDrillSummary('grade-entries', null, [entry({})])).toBeNull();
  });
});
