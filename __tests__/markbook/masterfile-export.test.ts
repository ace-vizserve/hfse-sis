import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  buildMasterfileWorkbook,
  flattenMasterfileRows,
  masterfileToCsv,
} from '@/lib/markbook/masterfile-export';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';

// Regression test for the Masterfile exports (KD #95). The xlsx sheet is a
// copy of the school's "AY2025 Final Report Book" Masterfile sheet — the
// layout constants above `describe` spell that out. The CSV is the flat data
// table and is checked through the comment tests at the bottom.

const TERMS = [
  { id: 't1', termNumber: 1, label: 'Term 1' },
  { id: 't2', termNumber: 2, label: 'Term 2' },
  { id: 't3', termNumber: 3, label: 'Term 3' },
  { id: 't4', termNumber: 4, label: 'Term 4' },
];

const EXAM_SUBJECT = {
  id: 'math',
  code: 'MATH',
  name: 'Mathematics',
  isExaminable: true,
};
const MUSIC = {
  id: 'music',
  code: 'MUSIC',
  name: 'Music',
  isExaminable: false,
};
const ART = { id: 'art', code: 'ART', name: 'Art', isExaminable: false };

function examRow(quarterlies: number[]): MasterfileSubjectRow {
  return {
    subjectId: EXAM_SUBJECT.id,
    cells: quarterlies.map((q) => ({
      quarterly: q,
      letter: null,
      isNa: false,
    })),
    overall: 93.4,
    award: 'Silver',
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

function musicRow(annualLetter: string | null): MasterfileSubjectRow {
  return {
    subjectId: MUSIC.id,
    cells: [
      { quarterly: 95, letter: null, isNa: false }, // → A
      { quarterly: 86, letter: null, isNa: false }, // → B
      { quarterly: 82, letter: null, isNa: false }, // → C
      { quarterly: 70, letter: null, isNa: false }, // → IP
    ],
    overall: null,
    award: null,
    annualLetter,
    derivedAnnualLetter: 'B',
    annualLetterEntryId: 'e-music',
    annualLetterSheetId: 's-music',
  };
}

function artRow(): MasterfileSubjectRow {
  return {
    subjectId: ART.id,
    cells: [
      { quarterly: null, letter: 'UG', isNa: false }, // override → UG
      { quarterly: null, letter: null, isNa: true }, // → N.A.
      { quarterly: null, letter: null, isNa: false }, // → blank
      { quarterly: 91, letter: null, isNa: false }, // → A
    ],
    overall: null,
    award: null,
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: 'e-art',
    annualLetterSheetId: 's-art',
  };
}

function makePayload(): MasterfilePayload {
  const active: MasterfileStudentRow = {
    studentId: 'stu-1',
    studentNumber: 'S0001',
    fullName: 'Tan, Alice',
    sectionId: 'sec-1',
    sectionName: 'P5 Diamond',
    formClassAdviser: 'Ms Lee',
    enrollmentStatus: 'active',
    // indexNumber 7 deliberately differs from array position (idx+1=1) so the
    // S/N assertion below proves the export uses the real field, not idx+1.
    indexNumber: 7,
    subjectRows: [examRow([90, 91, 92, 93]), musicRow('Passed'), artRow()],
    generalAverage: 93.4,
    overallAward: 'Silver',
    attendanceByTerm: [
      { termId: 't1', schoolDays: 45, present: 44, late: 1, excused: 0 },
      { termId: 't2', schoolDays: 45, present: 45, late: 0, excused: 0 },
      { termId: 't3', schoolDays: 45, present: 43, late: 2, excused: 0 },
      { termId: 't4', schoolDays: 30, present: 30, late: 0, excused: 0 },
    ],
    attendanceTotal: { schoolDays: 165, present: 162, late: 3, excused: 0 },
    commentsByTerm: [{ termNumber: 1, text: 'Doing well.', submitted: true }],
    lateEnrolleeTermNumber: null,
    enrolledTermNumbers: [1, 2, 3, 4],
  };

  // Withdrawn student with 0 attendance everywhere — exercises the 0-vs-blank
  // fix (a real 0 must print 0, not '').
  const withdrawn: MasterfileStudentRow = {
    studentId: 'stu-2',
    studentNumber: 'S0002',
    fullName: 'Lim, Bob',
    sectionId: 'sec-1',
    sectionName: 'P5 Diamond',
    formClassAdviser: 'Ms Lee',
    enrollmentStatus: 'withdrawn',
    indexNumber: 2,
    subjectRows: [examRow([0, 0, 0, 0]), musicRow(null), artRow()],
    generalAverage: null,
    overallAward: 'Not eligible for Overall Award',
    attendanceByTerm: [
      { termId: 't1', schoolDays: 0, present: 0, late: 0, excused: 0 },
      { termId: 't2', schoolDays: 0, present: 0, late: 0, excused: 0 },
      { termId: 't3', schoolDays: 0, present: 0, late: 0, excused: 0 },
      { termId: 't4', schoolDays: 0, present: 0, late: 0, excused: 0 },
    ],
    attendanceTotal: { schoolDays: 0, present: 0, late: 0, excused: 0 },
    commentsByTerm: [],
    lateEnrolleeTermNumber: null,
    enrolledTermNumbers: [1, 2, 3, 4],
  };

  return {
    ayCode: 'AY9999',
    level: { id: 'lvl-p5', code: 'P5', label: 'Primary 5' },
    subjects: [EXAM_SUBJECT, MUSIC, ART],
    terms: TERMS,
    sections: [{ id: 'sec-1', name: 'P5 Diamond' }],
    selectedSectionIds: ['sec-1'],
    rows: [active, withdrawn],
    sheets: [],
    thresholds: {
      bronzeMin: 88.5,
      silverMin: 91.5,
      goldMin: 95.5,
      max: 100,
    },
  };
}

// Parse the workbook back into a full grid (blank rows kept, so row indexes
// are the sheet's own: 0 school name … 4–6 headers, 7+ students).
function readBack(payload: MasterfilePayload) {
  const buffer = buildMasterfileWorkbook(payload);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1,
    defval: '',
    blankrows: true,
  });
  return { ws, aoa };
}

// The school file's Primary layout for the fixture (1 exam, 2 letter, 4 terms):
//   Identity 6 · exam 6 (T1–T4 · Overall · Remarks) · letter 4 each (T1–T4) ·
//   Overall Academic Award 2 · attendance 3×4 + Present/Late 2 · comments 4.
const IDENTITY_COLS = 6;
const EXAM_WIDTH = 6;
const NONEXAM_WIDTH = 4;
const OVERALL_AWARD_WIDTH = 2;
const ATTENDANCE_WIDTH = 3 * 4 + 2;
const COMMENTS_WIDTH = 4;
const EXPECTED_TOTAL_COLS =
  IDENTITY_COLS +
  EXAM_WIDTH +
  2 * NONEXAM_WIDTH +
  OVERALL_AWARD_WIDTH +
  ATTENDANCE_WIDTH +
  COMMENTS_WIDTH;
const FIRST_DATA_ROW = 7;
const ATT_START =
  IDENTITY_COLS + EXAM_WIDTH + 2 * NONEXAM_WIDTH + OVERALL_AWARD_WIDTH;
const COMMENTS_START = ATT_START + ATTENDANCE_WIDTH;

function secondaryPayload(): MasterfilePayload {
  const p = makePayload();
  p.level = { id: 'lvl-s4', code: 'S4', label: 'Secondary 4' };
  return p;
}

describe('buildMasterfileWorkbook — a copy of the school Masterfile sheet', () => {
  it('has the school title rows and the column-number row', () => {
    const { aoa } = readBack(makePayload());
    expect(aoa[0][0]).toBe('HFSE INTERNATIONAL SCHOOL');
    expect(aoa[1][0]).toBe('AY 9999 REPORT CARD - PRIMARY');
    expect(aoa[3][0]).toBe('');
    expect(aoa[3][1]).toBe(1);
    expect(aoa[3][EXPECTED_TOTAL_COLS - 1]).toBe(EXPECTED_TOTAL_COLS - 1);
    expect(readBack(secondaryPayload()).aoa[1][0]).toBe(
      'AY 9999 REPORT CARD - SECONDARY'
    );
  });

  it('uses the school headers, in the school order', () => {
    const { aoa } = readBack(makePayload());
    expect(aoa[4].slice(0, 7)).toEqual([
      'S/N',
      'STUDENT NAME',
      'LEVEL',
      'CLASS',
      'FORM CLASS ADVISER',
      'STUDENT\nSTATUS',
      'MATHEMATICS',
    ]);
    expect(aoa[5].slice(6, 12)).toEqual([
      'Term 1',
      'Term 2',
      'Term 3',
      'Term 4',
      'Overall',
      'Remarks',
    ]);
    expect(aoa[4][12]).toBe('MUSIC');
    expect(aoa[4][16]).toBe('ART');
    expect(aoa[4][20]).toBe('OVERALL ACADEMIC AWARD');
    expect(aoa[4][ATT_START]).toBe('ATTENDANCE');
    expect(aoa[5][ATT_START + 12]).toBe('Overall');
    expect(aoa[6].slice(ATT_START, ATT_START + 3)).toEqual([
      'School Days',
      'Present',
      'Late',
    ]);
    expect(aoa[6].slice(ATT_START + 12, ATT_START + 14)).toEqual([
      'Present',
      'Late',
    ]);
    expect(aoa[4][COMMENTS_START]).toBe("TEACHER'S COMMENTS");
    expect(aoa[5].slice(COMMENTS_START, COMMENTS_START + 4)).toEqual([
      'Term 1',
      'Term 2',
      'Term 3',
      'Term 4',
    ]);
  });

  it('fills each student row in the same columns as the headers', () => {
    const { aoa } = readBack(makePayload());
    const active = aoa[FIRST_DATA_ROW];
    const withdrawn = aoa[FIRST_DATA_ROW + 1];

    // S/N counts 1, 2, 3 — as the school file does.
    expect(active[0]).toBe(1);
    expect(withdrawn[0]).toBe(2);
    expect(active.slice(1, 6)).toEqual([
      'Tan, Alice',
      'Primary Five',
      'P5 Diamond',
      'Ms Lee',
      'Active',
    ]);
    expect(withdrawn[5]).toBe('Withdrawn');

    expect(active.slice(6, 12)).toEqual([90, 91, 92, 93, 93.4, 'Silver']);
    expect(active.slice(12, 16)).toEqual(['A', 'B', 'C', 'IP']);
    expect(active.slice(16, 20)).toEqual(['UG', 'N.A.', '', 'A']);
    expect(active.slice(20, 22)).toEqual([93.4, 'Silver']);
    expect(active.slice(ATT_START, ATT_START + 3)).toEqual([45, 44, 1]);
    expect(active.slice(ATT_START + 12, ATT_START + 14)).toEqual([162, 3]);
    expect(active.slice(COMMENTS_START, COMMENTS_START + 4)).toEqual([
      'Doing well.',
      '',
      '',
      '',
    ]);
  });

  it('writes NA in the terms of a subject the student does not take', () => {
    const p = makePayload();
    p.rows[0].subjectRows = p.rows[0].subjectRows.filter(
      (sr) => sr.subjectId !== EXAM_SUBJECT.id && sr.subjectId !== MUSIC.id
    );
    const row = readBack(p).aoa[FIRST_DATA_ROW];
    expect(row.slice(6, 12)).toEqual(['NA', 'NA', 'NA', 'NA', '', '']);
    expect(row.slice(12, 16)).toEqual(['NA', 'NA', 'NA', 'NA']);
  });

  it('labels a late enrollee with the term they joined', () => {
    const p = makePayload();
    p.rows[0].enrollmentStatus = 'late_enrollee';
    p.rows[0].lateEnrolleeTermNumber = 2;
    expect(readBack(p).aoa[FIRST_DATA_ROW][5]).toBe('Late Enrolment | Term 2');
  });

  it('a 0-attendance cell exports as 0, not blank', () => {
    const withdrawn = readBack(makePayload()).aoa[FIRST_DATA_ROW + 1];
    expect(withdrawn[ATT_START]).toBe(0);
    expect(withdrawn[ATT_START + 12]).toBe(0);
    expect(withdrawn[ATT_START + 13]).toBe(0);
  });

  it('Secondary: attendance Remarks, CCA in the comments, Remarks for Economics', () => {
    const p = secondaryPayload();
    const CCA = {
      id: 'cca',
      code: 'CCA',
      name: 'Co-curricular Activities',
      isExaminable: false,
    };
    p.subjects = [...p.subjects, CCA];
    p.rows[0].subjectRows.push({ ...musicRow('B'), subjectId: 'cca' });
    const { aoa } = readBack(p);
    // CCA is not a subject group.
    expect(aoa[4]).not.toContain('CO-CURRICULAR ACTIVITIES');
    expect(aoa[5][ATT_START + 14]).toBe('Remarks');
    const commentsStart = ATT_START + 15;
    expect(aoa[5].slice(commentsStart, commentsStart + 4)).toEqual([
      'Term 1',
      'Term 2',
      'Term 3',
      'CCA',
    ]);
    expect(aoa[4][commentsStart + 4]).toBe('Remarks for Economics');
    expect(aoa[FIRST_DATA_ROW][1 + 1]).toBe('Secondary Four');
    expect(aoa[FIRST_DATA_ROW][commentsStart + 3]).toBe('B');
    // Numbered up to CCA, not over the Economics remarks.
    expect(aoa[3][commentsStart + 3]).toBe(commentsStart + 3);
    expect(aoa[3][commentsStart + 4] ?? '').toBe('');
  });

  it('merges never overlap', () => {
    for (const p of [makePayload(), secondaryPayload()]) {
      const merges = readBack(p).ws['!merges'] ?? [];
      const occupied = new Set<string>();
      for (const m of merges) {
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            const key = `${r}:${c}`;
            expect(occupied.has(key)).toBe(false);
            occupied.add(key);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The FCA write-up is formatted text now — it arrives as HTML. A spreadsheet
// cell cannot render it, so the registrar would read the tags. Both export
// formats strip it, and both are asserted here so a fix to one path can't
// silently skip the other. The xlsx sheet has one column per term; the CSV
// joins the terms into one cell.
// ---------------------------------------------------------------------------

function payloadWithComments(
  comments: MasterfileStudentRow['commentsByTerm']
): MasterfilePayload {
  const payload = makePayload();
  payload.rows[0].commentsByTerm = comments;
  return payload;
}

/** The active student's Teacher's Comments cells, as the xlsx sheet holds them. */
function xlsxComment(payload: MasterfilePayload): string {
  const { aoa } = readBack(payload);
  return aoa[FIRST_DATA_ROW].slice(COMMENTS_START, COMMENTS_START + 3)
    .map((v, i) => (v ? `T${i + 1}: ${v}` : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** The same cell out of the CSV branch. */
function csvComment(payload: MasterfilePayload): string {
  const table = flattenMasterfileRows(payload);
  return String(table.rows[0][table.headers.length - 1] ?? '');
}

describe("the Teacher's Comments cell reads as prose, not markup", () => {
  it('strips formatting out of the xlsx cell', () => {
    const payload = payloadWithComments([
      {
        termNumber: 1,
        text: '<p><strong>Alice</strong> is <em>improving</em>.</p>',
        submitted: true,
      },
    ]);
    expect(xlsxComment(payload)).toBe('T1: Alice is improving.');
  });

  it('strips formatting out of the CSV cell', () => {
    const payload = payloadWithComments([
      {
        termNumber: 1,
        text: '<p><strong>Alice</strong> is <em>improving</em>.</p>',
        submitted: true,
      },
    ]);
    expect(csvComment(payload)).toBe('T1: Alice is improving.');
  });

  it('flattens a bullet list into readable lines rather than <li> tags', () => {
    const payload = payloadWithComments([
      {
        termNumber: 2,
        text: '<ul><li><p>Leads group work</p></li><li><p>Written fluency</p></li></ul>',
        submitted: true,
      },
    ]);
    const cell = xlsxComment(payload);
    expect(cell).not.toContain('<');
    expect(cell).toBe('T2: Leads group work\nWritten fluency');
  });

  it('keeps the terms apart when more than one comment exists', () => {
    const payload = payloadWithComments([
      { termNumber: 1, text: '<p>Settling in.</p>', submitted: true },
      { termNumber: 2, text: '<p>Much stronger.</p>', submitted: true },
    ]);
    expect(xlsxComment(payload)).toBe('T1: Settling in.\n\nT2: Much stronger.');
    expect(csvComment(payload)).toBe('T1: Settling in.\n\nT2: Much stronger.');
  });

  it('drops a term whose comment is an empty editor document', () => {
    // An adviser who opens the box, types nothing and saves leaves `<p></p>`.
    // Without this the registrar's cell reads "T2: " — a term that looks
    // commented but isn't.
    const payload = payloadWithComments([
      { termNumber: 1, text: '<p>Settling in.</p>', submitted: true },
      { termNumber: 2, text: '<p></p>', submitted: false },
    ]);
    expect(xlsxComment(payload)).toBe('T1: Settling in.');
    expect(csvComment(payload)).toBe('T1: Settling in.');
  });

  it('leaves the cell empty when every comment is a blank document', () => {
    const payload = payloadWithComments([
      { termNumber: 1, text: '<p><br></p>', submitted: false },
    ]);
    expect(xlsxComment(payload)).toBe('');
    expect(csvComment(payload)).toBe('');
  });

  it('passes through text written before the editor existed', () => {
    // Every AY2025 write-up is a bare sentence, not HTML.
    const payload = payloadWithComments([
      { termNumber: 1, text: 'Doing well.', submitted: true },
    ]);
    expect(xlsxComment(payload)).toBe('T1: Doing well.');
    expect(csvComment(payload)).toBe('T1: Doing well.');
  });

  it('does not leak an escaped tag into the CSV text', () => {
    const payload = payloadWithComments([
      {
        termNumber: 1,
        text: '<p><strong>Bold</strong> claim.</p>',
        submitted: true,
      },
    ]);
    const csv = masterfileToCsv(flattenMasterfileRows(payload));
    expect(csv).not.toContain('<strong>');
    expect(csv).toContain('Bold claim.');
  });
});
