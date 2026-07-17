// __tests__/sis/backfill/enrollment/build-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildEnrollmentImport } from '@/lib/sis/backfill/enrollment/build-import';
import type { CandidateName } from '@/lib/sis/backfill/enrollment/name-match';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';

const CANDIDATES: CandidateName[] = [
  {
    enroleeNumber: 'E260092',
    studentNumber: 'H220038',
    lastName: 'Bedico',
    firstName: 'Miguel Zion',
    middleName: 'Cabrera',
  },
  {
    enroleeNumber: 'E260093',
    studentNumber: 'H190240',
    lastName: 'Alvarez',
    firstName: 'Jaime',
    middleName: 'Dela Cruz',
  },
  {
    enroleeNumber: 'E260099',
    studentNumber: null, // missing studentNumber on purpose
    lastName: 'Noname',
    firstName: 'Sample',
    middleName: null,
  },
];

const BASE_INPUT = {
  ayCode: 'AY2026',
  termNumber: 1,
  termStart: '2026-01-08',
  termEnd: '2026-03-13',
};

describe('buildEnrollmentImport', () => {
  it('creates a section and enrolls a confidently matched student', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Patience(G)',
        classSectionLabel: 'P1 Patience (AM Global)',
        formTeacher: 'Ms. Kristel',
        students: [{ indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.strong).toBe(1);
    expect(result.stats.sectionsCreated).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.apply).toContain("'P1', 'Patience'");
    expect(result.apply).toContain("'H220038'");
    expect(result.apply).toContain("date '2026-01-08'");
    expect(result.apply).toContain('enrollment_status');
    expect(result.apply).toContain(', null,'); // enrollment_date literal
  });

  it('skips a section tab with zero students', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'Reserved 1',
        classSectionLabel: 'P1 Respect',
        formTeacher: null,
        students: [],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.sectionsCreated).toBe(0);
    expect(result.stats.skippedEmpty).toEqual(['Reserved 1']);
  });

  it('excludes the YS sheet and flags it in the report, not the apply file', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'YS',
        classSectionLabel: 'YS Faith',
        formTeacher: null,
        students: [{ indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.excludedYs).toEqual(['YS']);
    expect(result.stats.sectionsCreated).toBe(0);
    expect(result.apply).not.toContain('YS');
    expect(result.preview).toContain('YS');
  });

  it('flags an unmatched name in needs-review and never writes it', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [{ indexNo: '1', fullName: 'NOBODY, Matches Here' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    // The section itself is still created — the design skips only
    // fully-empty tabs, not tabs with unmatched names.
    expect(result.stats.sectionsCreated).toBe(1);
    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('NOBODY');
  });

  it('flags a matched candidate with no studentNumber in needs-review', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [{ indexNo: '1', fullName: 'NONAME, Sample' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('E260099');
  });

  it('flags both rows when two roster rows claim the same enrolee', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [
          { indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' },
          { indexNo: '2', fullName: 'BEDICO, Miguel Zion Cabrera' },
        ],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.needsReview).toBe(2);
    expect(result.apply).not.toContain('H220038');
  });
});
