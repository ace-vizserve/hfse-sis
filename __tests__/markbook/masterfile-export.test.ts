import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  buildMasterfileWorkbook,
  consolidatedTabNames,
  masterfileToCsv,
  type ConsolidatedFilters,
} from '@/lib/markbook/masterfile-export';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';

// Regression test for the Masterfile exports (KD #95). Both formats copy the
// school's "AY2026 Consolidated File Primary|Secondary Grades" layout: one tab
// per class; row 1 T1–T4 · Overall · Award per subject; row 2 No · Name ·
// subject names; students from row 3.

const TERMS = [1, 2, 3, 4].map((n) => ({
  id: `t${n}`,
  termNumber: n,
  label: `Term ${n}`,
}));

const ENG = { id: 'eng', code: 'ENG', name: 'English', isExaminable: true };
const MATH = {
  id: 'math',
  code: 'MATH',
  name: 'Mathematics',
  isExaminable: true,
};
const FIL = { id: 'fil', code: 'FIL', name: 'Filipino', isExaminable: true };
const MAN = {
  id: 'man',
  code: 'MANDARIN',
  name: 'Mandarin',
  isExaminable: true,
};
const STAR = { id: 'star', code: 'STAR', name: 'STAR', isExaminable: false };

function exam(
  subjectId: string,
  q: (number | null)[],
  overall: number | null = null,
  award: MasterfileSubjectRow['award'] = null
): MasterfileSubjectRow {
  return {
    subjectId,
    cells: q.map((quarterly) => ({ quarterly, letter: null, isNa: false })),
    overall,
    award,
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

function letter(subjectId: string, q: (number | null)[]): MasterfileSubjectRow {
  return { ...exam(subjectId, q), overall: null, award: null };
}

const EMPTY = [null, null, null, null];

function student(
  over: Partial<MasterfileStudentRow> & { subjectRows: MasterfileSubjectRow[] }
): MasterfileStudentRow {
  return {
    studentId: 'stu',
    studentNumber: 'S0001',
    fullName: 'Banta, Stephanie Louise, Santos',
    sectionId: 'sec-a',
    sectionName: 'Patience',
    formClassAdviser: 'Ms Lee',
    enrollmentStatus: 'active',
    indexNumber: 1,
    generalAverage: 91.25,
    overallAward: 'Bronze',
    attendanceByTerm: [
      { termId: 't1', schoolDays: 40, present: 39, late: 1, excused: 0 },
    ],
    attendanceTotal: { schoolDays: 0, present: 0, late: 0, excused: 0 },
    commentsByTerm: [
      { termNumber: 1, text: '<p>Doing well.</p>', submitted: true },
    ],
    lateEnrolleeTermNumber: null,
    enrolledTermNumbers: [1, 2, 3, 4],
    ...over,
  };
}

/** P1 with two classes: Patience takes Mandarin, Obedience Filipino. */
function primary(): MasterfilePayload {
  return {
    ayCode: 'AY2026',
    level: { id: 'lvl-p1', code: 'P1', label: 'Primary 1' },
    subjects: [ENG, FIL, MAN, MATH, STAR],
    terms: TERMS,
    sections: [
      { id: 'sec-a', name: 'Patience' },
      { id: 'sec-b', name: 'Obedience' },
    ],
    selectedSectionIds: ['sec-a', 'sec-b'],
    rows: [
      student({
        subjectRows: [
          exam('eng', [80, 79, 85, 90], 84.5, 'Not eligible for Subject Award'),
          exam('fil', EMPTY),
          exam('man', [89, 60, 70, 75], 72.2, 'Not eligible for Subject Award'),
          exam(
            'math',
            [93, 75, 88, 90],
            87.3,
            'Not eligible for Subject Award'
          ),
          letter('star', [95, 86, null, null]),
        ],
      }),
      student({
        studentId: 'stu-2',
        fullName: 'Bonifacio, Lance Matthew, Jimenez',
        sectionId: 'sec-b',
        sectionName: 'Obedience',
        enrollmentStatus: 'withdrawn',
        subjectRows: [
          exam('eng', [91, 60, null, null]),
          exam('fil', [93, 86, null, null]),
          exam('man', EMPTY),
          exam('math', [99, 60, null, null]),
          letter('star', [95, null, null, null]),
        ],
      }),
    ],
    sheets: [],
    thresholds: { bronzeMin: 88.5, silverMin: 91.5, goldMin: 95.5, max: 100 },
  };
}

function secondary(): MasterfilePayload {
  const p = primary();
  p.level = { id: 'lvl-s1', code: 'S1', label: 'Secondary 1' };
  p.sections = [{ id: 'sec-a', name: 'Discipline 1' }];
  p.selectedSectionIds = ['sec-a'];
  p.rows = [p.rows[0]];
  return p;
}

async function readTabs(
  payload: MasterfilePayload | MasterfilePayload[],
  filters?: ConsolidatedFilters
) {
  const wb = XLSX.read(await buildMasterfileWorkbook(payload, filters), {
    type: 'buffer',
  });
  // The table only (below the five title rows), cut to the subject columns.
  return Object.fromEntries(
    wb.SheetNames.map((n) => [
      n,
      XLSX.utils
        .sheet_to_json<(string | number)[]>(wb.Sheets[n], {
          header: 1,
          defval: '',
          blankrows: true,
        })
        .slice(TITLE)
        .map((r) => r.slice(0, SUBJECT_COLS)),
    ])
  );
}

const TITLE = 5;
// No · Name · English 6 · Math 6 · MT 6 · STAR 4 on the Primary fixture.
const SUBJECT_COLS = 2 + 6 * 3 + 4;

describe('the export copies the school Consolidated File', () => {
  it('carries the school title block above the table', async () => {
    const wb = XLSX.read(await buildMasterfileWorkbook(primary()), {
      type: 'buffer',
    });
    const aoa = XLSX.utils.sheet_to_json<string[]>(
      wb.Sheets['Primary 1 Patience'],
      { header: 1, defval: '', blankrows: true }
    );
    expect(aoa.slice(0, TITLE).map((r) => r[0])).toEqual([
      'HFSE INTERNATIONAL SCHOOL',
      'CONSOLIDATED FORM',
      'PRIMARY ONE PATIENCE',
      'AY 2026 - Term Four',
      'Teacher: Ms Lee',
    ]);
  });

  it('ends with attendance per term and the teacher comments', async () => {
    const wb = XLSX.read(await buildMasterfileWorkbook(primary()), {
      type: 'buffer',
    });
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets['Primary 1 Patience'],
      { header: 1, defval: '', blankrows: true }
    );
    const at = 2 + 6 * 3 + 4; // first column after STAR
    expect(aoa[TITLE + 1][at]).toBe('Attendance T1');
    expect(aoa[TITLE].slice(at, at + 3)).toEqual([
      'School Days',
      'Present',
      'Late',
    ]);
    expect(aoa[TITLE + 2].slice(at, at + 3)).toEqual([40, 39, 1]);
    expect(aoa[TITLE + 1][at + 12]).toBe("Teacher's Comments");
    expect(aoa[TITLE + 2][at + 12]).toBe('Doing well.');
  });

  it('has one tab per class, named as the school names them', async () => {
    expect(Object.keys(await readTabs(primary()))).toEqual([
      'Primary 1 Patience',
      'Primary 1 Obedience',
    ]);
    expect(consolidatedTabNames(secondary())).toEqual(['Sec 1 Discipline 1']);
  });

  it('writes the two header rows in the school order', async () => {
    const tab = (await readTabs(primary()))['Primary 1 Patience'];
    expect(tab[0]).toEqual([
      '',
      '',
      'T1',
      'T2',
      'T3',
      'T4',
      'Overall',
      'Award', // English
      'T1',
      'T2',
      'T3',
      'T4',
      'Overall',
      'Award', // Math
      'T1',
      'T2',
      'T3',
      'T4',
      'Overall',
      'Award', // MT
      'T1',
      'T2',
      'T3',
      'T4', // STAR
    ]);
    expect(tab[1].filter(Boolean)).toEqual([
      'No',
      'Name',
      'English',
      'English',
      'Math',
      'Math',
      'MT',
      'MT',
      'STAR',
    ]);
  });

  it('fills a student row: No, school-style name, grades, letters', async () => {
    const tab = (await readTabs(primary()))['Primary 1 Patience'];
    expect(tab[2]).toEqual([
      1,
      'BANTA, Stephanie Louise S.',
      80,
      79,
      85,
      90,
      84.5,
      'Not eligible for Subject Award',
      93,
      75,
      88,
      90,
      87.3,
      'Not eligible for Subject Award',
      89,
      60,
      70,
      75,
      72.2,
      'Not eligible for Subject Award', // Mandarin as MT
      'A',
      'B',
      '',
      '',
    ]);
  });

  it('MT is whichever of Filipino / Mandarin the class is graded in', async () => {
    const tab = (await readTabs(primary()))['Primary 1 Obedience'];
    expect(tab[2].slice(14, 18)).toEqual([93, 86, '', '']);
  });

  it('Secondary adds the Academic Overall · Award before the letters', async () => {
    const tab = (await readTabs(secondary()))['Sec 1 Discipline 1'];
    expect(tab[0].slice(20, 22)).toEqual(['Overall', 'Award']);
    expect(tab[1][20]).toBe('Academic');
    expect(tab[2].slice(20, 22)).toEqual([91.25, 'Bronze']);
    expect(tab[1][22]).toBe('STAR');
  });

  it('every block keeps the school colour for its position', async () => {
    const wb = XLSX.read(await buildMasterfileWorkbook(primary()), {
      type: 'buffer',
      cellStyles: true,
    });
    const ws = wb.Sheets['Primary 1 Patience'];
    const rgb = (a: string) => ws[a]?.s?.fgColor?.rgb;
    expect(rgb('C6')).toBe('00FF99');
    expect(rgb('I6')).toBe('FFC000');
    expect(rgb('O8')).toBe('FFFFCC');
    expect(rgb('U7')).toBe('CAEDFB');
  });
});

describe('the page filters narrow the file', () => {
  it('subject → only that subject', async () => {
    const tab = (await readTabs(primary(), { subjectId: 'math' }))[
      'Primary 1 Patience'
    ];
    // Attendance and comments are not subjects, so they stay.
    expect(tab[1].filter(Boolean).slice(0, 5)).toEqual([
      'No',
      'Name',
      'Math',
      'Math',
      'Attendance T1',
    ]);
  });

  it('term → terms after it stay blank, Overall waits for Term 4', async () => {
    const tab = (await readTabs(primary(), { termNumber: 2 }))[
      'Primary 1 Patience'
    ];
    expect(tab[2].slice(2, 8)).toEqual([80, 79, '', '', '', '']);
  });

  it('status → only those students; a class left empty drops its tab', async () => {
    expect(consolidatedTabNames(primary(), { status: 'withdrawn' })).toEqual([
      'Primary 1 Obedience',
    ]);
  });

  it('class → only the selected classes', () => {
    const p = primary();
    p.selectedSectionIds = ['sec-b'];
    expect(consolidatedTabNames(p)).toEqual(['Primary 1 Obedience']);
  });

  it('a division puts each level’s classes in level order', () => {
    const p2 = primary();
    p2.level = { id: 'lvl-p2', code: 'P2', label: 'Primary 2' };
    expect(consolidatedTabNames([primary(), p2])).toEqual([
      'Primary 1 Patience',
      'Primary 1 Obedience',
      'Primary 2 Patience',
      'Primary 2 Obedience',
    ]);
  });
});

describe('the CSV is the same grid', () => {
  it('writes each tab with its title block and the same rows', () => {
    const lines = masterfileToCsv(primary()).replace(/^﻿/, '').split('\r\n');
    expect(lines.slice(0, 5)).toEqual([
      'HFSE INTERNATIONAL SCHOOL',
      'CONSOLIDATED FORM',
      'PRIMARY ONE PATIENCE',
      'AY 2026 - Term Four',
      'Teacher: Ms Lee',
    ]);
    expect(
      lines[5].startsWith(
        ',,T1,T2,T3,T4,Overall,Award,' +
          'T1,T2,T3,T4,Overall,Award,'.repeat(2) +
          'T1,T2,T3,T4,School Days,Present,Late'
      )
    ).toBe(true);
    expect(lines[6].startsWith('No,Name,English,,,,English,')).toBe(true);
    expect(
      lines[7].startsWith('1,"BANTA, Stephanie Louise S.",80,79,85,90,84.5')
    ).toBe(true);
    expect(lines).toContain('PRIMARY ONE OBEDIENCE');
  });
});
