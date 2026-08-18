import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { buildMasterfileWorkbook } from '@/lib/markbook/masterfile-export';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';

// Regression test for the Masterfile Excel export (KD #95). Locks the
// column/merge math so the off-by-one bug (non-exam subjects exporting 4
// sub-columns when the grid renders 5: T1·T2·T3·T4·Final) can't return.
//
// Column model the export builds (must match masterfile-grid.tsx):
//   Identity:    7 columns (S/N · Name · No. · Level · Class · FCA · Status)
//   Examinable:  6 columns each (T1·T2·T3·T4·Overall·Award)
//   Non-exam:    5 columns each (T1·T2·T3·T4·Final)
//   Overall Award: 2 columns (General Average · Award)
//   Attendance:  3 per term + 3 totals
//   Comments:    1 column

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

// Parse the workbook back into the AOA + sheet object.
function readBack(payload: MasterfilePayload) {
  const buffer = buildMasterfileWorkbook(payload);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1,
    defval: '',
    blankrows: false,
  });
  return { ws, aoa };
}

// Expected column geometry for the fixture (1 exam, 2 non-exam, 4 terms).
const IDENTITY_COLS = 7;
const EXAM_WIDTH = 6;
const NONEXAM_WIDTH = 5;
const OVERALL_AWARD_WIDTH = 2;
const ATTENDANCE_WIDTH = 3 * TERMS.length + 3; // per-term + totals
const COMMENTS_WIDTH = 1;
const EXPECTED_TOTAL_COLS =
  IDENTITY_COLS +
  1 * EXAM_WIDTH +
  2 * NONEXAM_WIDTH +
  OVERALL_AWARD_WIDTH +
  ATTENDANCE_WIDTH +
  COMMENTS_WIDTH;

describe('buildMasterfileWorkbook', () => {
  it('(a) every data row has the same column count as the header', () => {
    const payload = makePayload();
    const { aoa } = readBack(payload);

    // aoa[0] = group header, aoa[1] = sub-header, aoa[2..] = data rows.
    const groupRow = aoa[0];
    const subRow = aoa[1];
    const dataRows = aoa.slice(2);

    expect(subRow.length).toBe(EXPECTED_TOTAL_COLS);
    // Group row's last cell is at the same final column index — but trailing
    // merged-blank cells may be trimmed by sheet_to_json. The authoritative
    // count is the sub-header (every column has a value there).
    expect(groupRow.length).toBeLessThanOrEqual(EXPECTED_TOTAL_COLS);

    expect(dataRows.length).toBe(2);
    for (const r of dataRows) {
      // Trailing comments cell can be empty for the withdrawn student; pad
      // the row to the full width before comparing.
      const padded = [...r];
      while (padded.length < EXPECTED_TOTAL_COLS) padded.push('');
      expect(padded.length).toBe(EXPECTED_TOTAL_COLS);
    }
  });

  it('(b) the examinable Award and a non-exam Final letter land in the right columns', () => {
    const payload = makePayload();
    const { aoa } = readBack(payload);
    const activeRow = aoa[2]; // first data row (Tan, Alice)
    const withdrawnRow = aoa[3]; // second data row (Lim, Bob)

    // S/N uses the permanent indexNumber field, not the array position.
    // active.indexNumber=7 (not 1), withdrawn.indexNumber=2 (matches position).
    // If S/N were idx+1 both would be 1 and 2 respectively — this proves it uses
    // the real field.
    expect(activeRow[0]).toBe(7); // S/N = indexNumber 7, not array position 1
    expect(withdrawnRow[0]).toBe(2); // S/N = indexNumber 2 (also happens to be pos 2)

    // Examinable block: starts after identity (index 7). Award is the 6th
    // sub-column → index 7 + 6 - 1 = 12.
    const examAwardCol = IDENTITY_COLS + EXAM_WIDTH - 1;
    expect(activeRow[examAwardCol]).toBe('Silver');

    // Music block follows the examinable block. Final = its 5th sub-column.
    const musicStart = IDENTITY_COLS + EXAM_WIDTH;
    const musicFinalCol = musicStart + NONEXAM_WIDTH - 1;
    expect(activeRow[musicFinalCol]).toBe('Passed');

    // Music term cells = derived letters A·B·C·IP.
    expect(activeRow[musicStart]).toBe('A');
    expect(activeRow[musicStart + 1]).toBe('B');
    expect(activeRow[musicStart + 2]).toBe('C');
    expect(activeRow[musicStart + 3]).toBe('IP');

    // Art block follows Music. T1 override = UG, T2 = N.A., T4 derived = A,
    // Final = blank (annualLetter null).
    const artStart = musicStart + NONEXAM_WIDTH;
    expect(activeRow[artStart]).toBe('UG');
    expect(activeRow[artStart + 1]).toBe('N.A.');
    expect(activeRow[artStart + 3]).toBe('A');
    const artFinalCol = artStart + NONEXAM_WIDTH - 1;
    expect(activeRow[artFinalCol] ?? '').toBe('');

    // Overall Academic Award block follows the non-exam blocks.
    const overallStart = artStart + NONEXAM_WIDTH;
    expect(activeRow[overallStart]).toBe(93.4); // General Average (1dp)
    expect(activeRow[overallStart + 1]).toBe('Silver');
  });

  it('(c) merges do not overlap and each group merge width equals its sub-column count', () => {
    const payload = makePayload();
    const { ws } = readBack(payload);
    const merges = ws['!merges'] ?? [];

    // No two merge ranges overlap.
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

    // Group-header merges (row 0) must have the right widths. Identity columns
    // merge vertically (r0..r1, width 1); subject/section groups merge
    // horizontally on row 0.
    const horizontalGroupMerges = merges.filter(
      (m) => m.s.r === 0 && m.e.r === 0 && m.e.c > m.s.c
    );
    const widths = horizontalGroupMerges
      .map((m) => m.e.c - m.s.c + 1)
      .sort((a, b) => a - b);

    // 1 exam (6) + 2 non-exam (5,5) + overall award (2) + attendance (15).
    expect(widths).toEqual(
      [
        EXAM_WIDTH,
        NONEXAM_WIDTH,
        NONEXAM_WIDTH,
        OVERALL_AWARD_WIDTH,
        ATTENDANCE_WIDTH,
      ].sort((a, b) => a - b)
    );

    // The full merged width across all group headers + vertical-merge identity
    // and comments columns must cover exactly EXPECTED_TOTAL_COLS columns.
    const maxCol = Math.max(...merges.map((m) => m.e.c));
    expect(maxCol).toBe(EXPECTED_TOTAL_COLS - 1);
  });

  it('(d) a 0-attendance cell exports as 0, not blank', () => {
    const payload = makePayload();
    const { aoa } = readBack(payload);
    const withdrawnRow = aoa[3]; // second data row (Lim, Bob)

    // Attendance block starts after identity + exam + 2 non-exam + overall.
    const attStart =
      IDENTITY_COLS + EXAM_WIDTH + 2 * NONEXAM_WIDTH + OVERALL_AWARD_WIDTH;

    // First per-term School Days cell = 0 (a real zero, not blank).
    expect(withdrawnRow[attStart]).toBe(0);

    // Totals = last 3 attendance columns, all 0.
    const totalsStart = attStart + 3 * TERMS.length;
    expect(withdrawnRow[totalsStart]).toBe(0); // total school days
    expect(withdrawnRow[totalsStart + 1]).toBe(0); // total present
    expect(withdrawnRow[totalsStart + 2]).toBe(0); // total late
  });
});
