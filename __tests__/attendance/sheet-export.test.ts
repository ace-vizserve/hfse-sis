import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildAttendanceSheetWorkbook,
  type AttendanceSheetExportInput,
} from '@/lib/attendance/sheet-export';

function baseInput(): AttendanceSheetExportInput {
  return {
    schoolName: 'HFSE INTERNATIONAL SCHOOL',
    sheetName: 'P1 Obedience',
    term: {
      label: 'Term 3',
      termNumber: 3,
      startDate: '2026-06-29',
      endDate: '2026-07-02',
    },
    courseLabel: 'Primary One',
    sectionName: 'Obedience',
    formAdviser: 'Ms. Kristel',
    scheduleLabel: null,
    calendarByDate: new Map([
      ['2026-06-29', { dayType: 'school_day', label: null }],
      ['2026-06-30', { dayType: 'school_day', label: null }],
      ['2026-07-01', { dayType: 'public_holiday', label: 'Youth Day' }],
      ['2026-07-02', { dayType: 'school_day', label: null }],
    ]),
    events: [],
    students: [
      {
        indexNumber: 1,
        fullName: 'DOE, Jane',
        busCare: 'BUS 5',
        withdrawn: false,
        enrollmentDate: null,
        marksByDate: new Map([
          ['2026-06-29', 'P'],
          ['2026-06-30', 'L'],
          ['2026-07-02', 'A'],
        ]),
      },
    ],
  };
}

function lateEnrolleeInput(): AttendanceSheetExportInput {
  return {
    schoolName: 'HFSE INTERNATIONAL SCHOOL',
    sheetName: 'P1 Obedience',
    term: {
      label: 'Term 3',
      termNumber: 3,
      startDate: '2026-06-29',
      endDate: '2026-07-02',
    },
    courseLabel: 'Primary One',
    sectionName: 'Obedience',
    formAdviser: 'Ms. Kristel',
    scheduleLabel: null,
    calendarByDate: new Map([
      ['2026-06-29', { dayType: 'school_day', label: null }],
      ['2026-06-30', { dayType: 'school_day', label: null }],
      ['2026-07-01', { dayType: 'public_holiday', label: 'Youth Day' }],
      ['2026-07-02', { dayType: 'school_day', label: null }],
    ]),
    events: [],
    students: [
      {
        indexNumber: 1,
        fullName: 'LATE, Enrollee',
        busCare: null,
        withdrawn: false,
        // Enrolled on 06-30 — a back-dated 'A' on 06-29 exists (e.g. from a
        // bulk import) but must not drag down the summary %.
        enrollmentDate: '2026-06-30',
        marksByDate: new Map([
          ['2026-06-29', 'A'],
          ['2026-06-30', 'P'],
          ['2026-07-02', 'P'],
        ]),
      },
    ],
  };
}

describe('buildAttendanceSheetWorkbook', () => {
  it('produces one worksheet named after the section', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    expect(wb.SheetNames).toContain('P1 Obedience');
  });

  it('writes the title band + class info', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
    }) as string[][];
    const flat = aoa.flat().map(String);
    expect(flat).toContain('HFSE INTERNATIONAL SCHOOL');
    expect(flat).toContain('STUDENT ATTENDANCE SHEET');
    expect(flat).toContain('Ms. Kristel');
    expect(flat).toContain('Primary One');
  });

  it('renders every date in the term window incl weekends', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
    }) as string[][];
    const flat = aoa.flat().map(String);
    // 2026-06-29..2026-07-02 = 4 dates including weekend boundaries
    for (const d of ['29 Jun', '30 Jun', '1 Jul', '2 Jul']) {
      expect(flat.some((c) => c.includes(d))).toBe(true);
    }
  });

  it('writes the marks and the HFSE summary (P+L+EX)/marked-days', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (
      | string
      | number
    )[][];
    const flat = aoa.flat();
    // marks present
    expect(flat).toContain('P');
    expect(flat).toContain('L');
    expect(flat).toContain('A');
    // term summary: 3 marked days, (P+L)=2 in-attendance → 66.7
    expect(flat).toContain(66.7);
  });

  it('excludes pre-enrollment marks from the summary but still renders the raw cell (matches the on-screen Term sheet)', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(lateEnrolleeInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (
      | string
      | number
    )[][];
    const flat = aoa.flat();
    // The back-dated 'A' on 06-29 (before enrollment) still shows as a raw
    // cell — only the summary calculation is prorated.
    expect(flat).toContain('A');
    // Term total, prorated: 06-29 excluded → 2 marked days (06-30 P, 07-02
    // P), both present → 100%. Without proration it would read 66.7 (3
    // marked, 2 present).
    expect(flat).toContain(100);
    expect(flat).not.toContain(66.7);
  });
});
