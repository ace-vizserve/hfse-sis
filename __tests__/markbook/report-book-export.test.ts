import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { ConsolidatedFilters } from '@/lib/markbook/masterfile-export';
import type {
  MasterfilePayload,
  MasterfileSubjectRow,
} from '@/lib/markbook/masterfile';
import {
  buildReportBookWorkbook,
  reportBookToCsv,
} from '@/lib/markbook/report-book-export';

// The Final Report Book "Masterfile" sheet (KD #95): one sheet for the whole
// division, S/N running on across levels, filtered by the page's filters.

const TERMS = [1, 2, 3, 4].map((n) => ({
  id: `t${n}`,
  termNumber: n,
  label: `Term ${n}`,
}));
const MATH = {
  id: 'math',
  code: 'MATH',
  name: 'Mathematics',
  isExaminable: true,
};
const HIST = { id: 'hist', code: 'HIST', name: 'History', isExaminable: true };

function sr(subjectId: string, q: number[]): MasterfileSubjectRow {
  return {
    subjectId,
    cells: q.map((quarterly) => ({ quarterly, letter: null, isNa: false })),
    overall: 90.4,
    award: 'Bronze',
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

function level(code: string, withHistory: boolean): MasterfilePayload {
  const subjects = withHistory ? [MATH, HIST] : [MATH];
  return {
    ayCode: 'AY2026',
    level: { id: `lvl-${code}`, code, label: code },
    subjects,
    terms: TERMS,
    sections: [{ id: `sec-${code}`, name: `${code} Class` }],
    selectedSectionIds: [`sec-${code}`],
    rows: ['Tan, Alice, Lim', 'Lee, Bob, Ng'].map((fullName, i) => ({
      studentId: `${code}-${i}`,
      studentNumber: `${code}${i}`,
      fullName,
      sectionId: `sec-${code}`,
      sectionName: `${code} Class`,
      formClassAdviser: 'Ms Lee',
      enrollmentStatus: i === 1 ? 'withdrawn' : 'active',
      indexNumber: i + 1,
      subjectRows: subjects.map((s) => sr(s.id, [88, 89, 91, 92])),
      generalAverage: 90.4,
      overallAward: 'Bronze',
      attendanceByTerm: TERMS.map((t) => ({
        termId: t.id,
        schoolDays: 40,
        present: 39,
        late: 1,
        excused: 0,
      })),
      attendanceTotal: { schoolDays: 160, present: 156, late: 4, excused: 0 },
      commentsByTerm: [
        { termNumber: 1, text: '<p>Doing well.</p>', submitted: true },
      ],
      lateEnrolleeTermNumber: null,
      enrolledTermNumbers: [1, 2, 3, 4],
    })),
    sheets: [],
    thresholds: { bronzeMin: 88.5, silverMin: 91.5, goldMin: 95.5, max: 100 },
  };
}

async function sheet(
  input: MasterfilePayload | MasterfilePayload[],
  filters?: ConsolidatedFilters
) {
  const wb = XLSX.read(await buildReportBookWorkbook(input, filters), {
    type: 'buffer',
  });
  expect(wb.SheetNames).toEqual(['Masterfile']);
  return XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Masterfile, {
    header: 1,
    defval: '',
    blankrows: true,
  });
}

describe('Report Book: the school Masterfile sheet', () => {
  it('a division is one sheet, levels in order, S/N running on', async () => {
    const aoa = await sheet([level('S1', true), level('S3', false)]);
    expect(aoa[0][0]).toBe('HFSE INTERNATIONAL SCHOOL');
    expect(aoa[1][0]).toBe('AY 2026 REPORT CARD - SECONDARY');
    expect(aoa.slice(7).map((r) => [r[0], r[1], r[2]])).toEqual([
      [1, 'Tan, Alice, Lim', 'Secondary One'],
      [2, 'Lee, Bob, Ng', 'Secondary One'],
      [3, 'Tan, Alice, Lim', 'Secondary Three'],
      [4, 'Lee, Bob, Ng', 'Secondary Three'],
    ]);
    // S3 takes no History: NA, as in the school's file.
    expect(aoa[4][12]).toBe('HISTORY');
    expect(aoa[9].slice(12, 16)).toEqual(['NA', 'NA', 'NA', 'NA']);
  });

  it('filters: status picks students, subject the columns, term the terms', async () => {
    const aoa = await sheet(level('S1', true), {
      status: 'active',
      subjectId: 'math',
      termNumber: 2,
    });
    expect(aoa.slice(7)).toHaveLength(1);
    expect(aoa[4][6]).toBe('MATHEMATICS');
    expect(aoa[4][12]).toBe('OVERALL ACADEMIC AWARD');
    expect(aoa[7].slice(6, 12)).toEqual([88, 89, '', '', '', '']);
  });

  it('the CSV is the same grid', () => {
    const lines = reportBookToCsv(level('P1', false))
      .replace(/^﻿/, '')
      .split('\r\n');
    expect(lines[0].startsWith('HFSE INTERNATIONAL SCHOOL')).toBe(true);
    expect(lines[4].startsWith('S/N,STUDENT NAME,LEVEL,CLASS')).toBe(true);
    expect(
      lines[7].startsWith('1,"Tan, Alice, Lim",Primary One,P1 Class')
    ).toBe(true);
    expect(lines[7]).toContain('Doing well.');
  });
});
