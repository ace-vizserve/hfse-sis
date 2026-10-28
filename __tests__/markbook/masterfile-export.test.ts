import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  buildMasterfileWorkbook,
  consolidatedTabNames,
  consolidatedTerms,
  masterfileToCsv,
  type ConsolidatedFilters,
} from '@/lib/markbook/masterfile-export';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';

// Regression test for the CONSOLIDATED FORM export (KD #95): a copy of the
// school's "Term 2 CONSOLIDATED FORM.xlsx" — one term, one tab per class,
// title A1–A5, headers rows 7–8, students from row 9, subjects in C–J,
// attendance K–M, Remarks / Notes / Evaluation N–P, the DepEd footer.

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
const SCI = { id: 'sci', code: 'SCI', name: 'Science', isExaminable: true };
const STAR = { id: 'star', code: 'STAR', name: 'STAR', isExaminable: false };

function sr(subjectId: string, q: (number | null)[]): MasterfileSubjectRow {
  return {
    subjectId,
    cells: q.map((quarterly) => ({ quarterly, letter: null, isNa: false })),
    overall: null,
    award: null,
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

const EMPTY = [null, null, null, null];

function student(
  over: Partial<MasterfileStudentRow> & { subjectRows: MasterfileSubjectRow[] }
): MasterfileStudentRow {
  return {
    studentId: 'stu',
    studentNumber: 'S0001',
    fullName: 'Alvarez, Jaime Iii, De La Cruz',
    sectionId: 'sec-a',
    sectionName: 'Patience',
    formClassAdviser: 'Ms Kristel',
    enrollmentStatus: 'active',
    indexNumber: 1,
    generalAverage: null,
    overallAward: null,
    attendanceByTerm: [
      { termId: 't1', schoolDays: 44, present: 44, late: 0, excused: 0 },
      { termId: 't2', schoolDays: 40, present: 40, late: 1, excused: 0 },
    ],
    attendanceTotal: { schoolDays: 84, present: 84, late: 1, excused: 0 },
    commentsByTerm: [
      { termNumber: 1, text: '<p>Settling in.</p>', submitted: true },
      {
        termNumber: 2,
        text: '<p><strong>Jaime</strong> takes accountability.</p>',
        submitted: true,
      },
    ],
    lateEnrolleeTermNumber: null,
    enrolledTermNumbers: [1, 2, 3, 4],
    ...over,
  };
}

/** P1: Patience takes Mandarin, Obedience Filipino. Graded to Term 2. */
function primary(): MasterfilePayload {
  return {
    ayCode: 'AY2026',
    level: { id: 'lvl-p1', code: 'P1', label: 'Primary 1' },
    subjects: [ENG, FIL, MAN, MATH, SCI, STAR],
    terms: TERMS,
    sections: [
      { id: 'sec-a', name: 'Patience' },
      { id: 'sec-b', name: 'Obedience' },
    ],
    selectedSectionIds: ['sec-a', 'sec-b'],
    rows: [
      student({
        subjectRows: [
          sr('eng', [80, 86, null, null]),
          sr('fil', EMPTY),
          sr('man', [89, 80, null, null]),
          sr('math', [93, 92, null, null]),
          sr('sci', [89, 91, null, null]),
          sr('star', [95, 86, null, null]),
        ],
      }),
      student({
        studentId: 'stu-2',
        fullName: 'Bonifacio, Lance Matthew, Jimenez',
        sectionId: 'sec-b',
        sectionName: 'Obedience',
        formClassAdviser: 'Ms Grace',
        enrollmentStatus: 'withdrawn',
        indexNumber: 4,
        subjectRows: [
          sr('eng', [91, 70, null, null]),
          sr('fil', [93, 86, null, null]),
          sr('man', EMPTY),
          sr('math', [99, 60, null, null]),
          sr('sci', [90, 88, null, null]),
          sr('star', [95, null, null, null]),
        ],
      }),
    ],
    sheets: [],
    thresholds: { bronzeMin: 88.5, silverMin: 91.5, goldMin: 95.5, max: 100 },
  };
}

async function readTab(
  name: string,
  input: MasterfilePayload | MasterfilePayload[] = primary(),
  // Term 2 unless a test says otherwise — one term's form, as the school's.
  filters: ConsolidatedFilters = { termNumber: 2 }
) {
  const wb = XLSX.read(await buildMasterfileWorkbook(input, filters), {
    type: 'buffer',
    cellStyles: true,
  });
  const ws = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1,
    defval: '',
    blankrows: true,
  });
  return { ws, aoa };
}

describe('the export copies the school CONSOLIDATED FORM', () => {
  it('one tab per class, named as the school names them', () => {
    expect(consolidatedTabNames(primary(), { termNumber: 2 })).toEqual([
      'P1-Patience',
      'P1-Obedience',
    ]);
  });

  it('the five-line title block', async () => {
    const { aoa } = await readTab('P1-Patience');
    expect(aoa.slice(0, 5).map((r) => r[0])).toEqual([
      ' HFSE INTERNATIONAL SCHOOL',
      'CONSOLIDATED FORM',
      'PRIMARY ONE PATIENCE',
      'AY 2026 - Term Two',
      'Teacher: Ms Kristel',
    ]);
  });

  it('the header rows: subjects C–J, attendance K–M, then N–P', async () => {
    const { aoa } = await readTab('P1-Patience');
    expect(aoa[6].slice(0, 16)).toEqual([
      'Index Number',
      'NAME',
      'English',
      'Math',
      'Mother Tongue (Mandarin)',
      'Science',
      'STAR',
      '',
      '',
      '',
      'Attendance',
      '',
      '',
      'Remarks',
      'Notes/Comment',
      'Students Evaluation',
    ]);
    expect(aoa[7].slice(10, 13)).toEqual([
      'Number of School Days ',
      'Number of Days Late',
      'Number of Days Present',
    ]);
  });

  it('a student row holds the one term: grades, letter, attendance, write-up', async () => {
    const { aoa } = await readTab('P1-Patience');
    expect(aoa[8].slice(0, 16)).toEqual([
      1,
      'ALVAREZ, Jaime Iii D.',
      86,
      92,
      80,
      91,
      'B',
      '',
      '',
      '',
      40,
      1,
      40,
      '',
      '',
      'Jaime takes accountability.',
    ]);
  });

  it('Mother Tongue is the language the class takes', async () => {
    const { aoa } = await readTab('P1-Obedience');
    expect(aoa[6][4]).toBe('Mother Tongue (Filipino)');
    expect(aoa[8][0]).toBe(4); // the student's own index number
    expect(aoa[8][4]).toBe(86);
  });

  it('keeps the school colours, hides Primary’s spare columns, ends with the DepEd line', async () => {
    const { ws, aoa } = await readTab('P1-Patience');
    const rgb = (a: string) => ws[a]?.s?.fgColor?.rgb;
    expect(rgb('C7')).toBe('6AA84F');
    expect(rgb('D7')).toBe('FBBC04');
    expect(rgb('N7')).toBe('FFE599');
    expect(ws['!cols']?.[7]?.hidden).toBe(true);
    expect(aoa[10][0]).toBe('Aligned with DepEd Order No. 8, s. 2015');
  });
});

describe('the page filters narrow the file', () => {
  it('term → that term’s grades, attendance and write-up', async () => {
    const { aoa } = await readTab('P1-Patience', primary(), { termNumber: 1 });
    expect(aoa[3][0]).toBe('AY 2026 - Term One');
    expect(aoa[8].slice(2, 4)).toEqual([80, 93]);
    expect(aoa[8].slice(10, 13)).toEqual([44, 0, 44]);
    expect(aoa[8][15]).toBe('Settling in.');
  });

  it('all terms → every recorded term’s form, term by term', () => {
    expect(consolidatedTerms(primary())).toEqual([1, 2]);
    expect(consolidatedTabNames(primary())).toEqual([
      'T1 P1-Patience',
      'T1 P1-Obedience',
      'T2 P1-Patience',
      'T2 P1-Obedience',
    ]);
  });

  it('subject → only that subject’s column', async () => {
    const { aoa } = await readTab('P1-Patience', primary(), {
      termNumber: 2,
      subjectId: 'math',
    });
    expect(aoa[6].slice(2, 4)).toEqual(['Math', '']);
  });

  it('status and class pick the tabs', () => {
    expect(
      consolidatedTabNames(primary(), { termNumber: 2, status: 'withdrawn' })
    ).toEqual(['P1-Obedience']);
    const p = primary();
    p.selectedSectionIds = ['sec-a'];
    expect(consolidatedTabNames(p, { termNumber: 2 })).toEqual(['P1-Patience']);
  });

  it('Primary and Secondary classes share one file', () => {
    const s1 = primary();
    s1.level = { id: 'lvl-s1', code: 'S1', label: 'Secondary 1' };
    expect(consolidatedTabNames([primary(), s1], { termNumber: 2 })).toEqual([
      'P1-Patience',
      'P1-Obedience',
      'S1-Patience',
      'S1-Obedience',
    ]);
  });
});

describe('the CSV is the same rows', () => {
  it('title, the two header rows, students, the DepEd line', () => {
    const lines = masterfileToCsv(primary(), { termNumber: 2 })
      .replace(/^﻿/, '')
      .split('\r\n');
    expect(lines.slice(0, 5)).toEqual([
      ' HFSE INTERNATIONAL SCHOOL',
      'CONSOLIDATED FORM',
      'PRIMARY ONE PATIENCE',
      'AY 2026 - Term Two',
      'Teacher: Ms Kristel',
    ]);
    expect(lines[5]).toBe(
      'Index Number,NAME,English,Math,Mother Tongue (Mandarin),Science,STAR,Attendance,,,Remarks,Notes/Comment,Students Evaluation'
    );
    expect(lines[7]).toBe(
      '1,"ALVAREZ, Jaime Iii D.",86,92,80,91,B,40,1,40,,,Jaime takes accountability.'
    );
    // Quoted: the line has a comma in it.
    expect(lines[9]).toBe('"Aligned with DepEd Order No. 8, s. 2015"');
  });
});
