import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildAttendanceSheetWorkbook,
  buildAttendanceYearWorkbook,
  narrowSheetExport,
  SheetExportScopeError,
  sheetExportFilename,
  type AttendanceSheetExportInput,
} from '@/lib/attendance/sheet-export';

function sheetCells(buf: Buffer, tab?: string): (string | number)[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[tab ?? wb.SheetNames[0]];
  return (
    XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (
      | string
      | number
    )[][]
  ).flat();
}

// Two students, a term spanning June and July, so month and student
// narrowing each have something to drop.
function twoStudentInput(): AttendanceSheetExportInput {
  const base = baseInput();
  return {
    ...base,
    events: [
      {
        startDate: '2026-06-30',
        endDate: '2026-06-30',
        label: 'Sports Day',
        category: 'school_event',
      } as AttendanceSheetExportInput['events'][number],
    ],
    students: [
      { ...base.students[0], enrolmentId: 'e1' },
      {
        enrolmentId: 'e2',
        indexNumber: 2,
        fullName: 'ROE, Rick',
        busCare: null,
        withdrawn: false,
        enrollmentDate: null,
        marksByDate: new Map([
          ['2026-06-29', 'A'],
          ['2026-07-02', 'P'],
        ]),
      },
    ],
  };
}

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

describe('narrowSheetExport — month', () => {
  it('keeps only that month’s date columns and its summary block, no term total', () => {
    const input = narrowSheetExport(twoStudentInput(), { month: '2026-07' });
    const flat = sheetCells(buildAttendanceSheetWorkbook(input)).map(String);
    expect(flat).toContain('1 Jul');
    expect(flat).toContain('2 Jul');
    expect(flat).not.toContain('29 Jun');
    expect(flat).not.toContain('30 Jun');
    expect(flat).toContain('July 2026');
    expect(flat).not.toContain('June 2026');
    expect(flat).not.toContain('Term 3 total');
    // The June event is outside the month's sheet.
    expect(flat).not.toContain('Sports Day');
  });

  it('summarises the month alone with the same formula', () => {
    const input = narrowSheetExport(twoStudentInput(), { month: '2026-07' });
    const flat = sheetCells(buildAttendanceSheetWorkbook(input));
    // Jane in July: one marked day, 'A' → 0%.
    expect(flat).toContain(0);
    // Whole-term 66.7 is not on a July sheet.
    expect(flat).not.toContain(66.7);
  });

  it('refuses a month the term does not touch', () => {
    expect(() =>
      narrowSheetExport(twoStudentInput(), { month: '2026-09' })
    ).toThrow(SheetExportScopeError);
  });

  it('without a month the sheet is unchanged (both months + term total)', () => {
    const flat = sheetCells(
      buildAttendanceSheetWorkbook(narrowSheetExport(twoStudentInput(), {}))
    ).map(String);
    expect(flat).toContain('June 2026');
    expect(flat).toContain('July 2026');
    expect(flat).toContain('Term 3 total');
  });
});

describe('narrowSheetExport — students', () => {
  it('keeps only the asked-for students, in index order', () => {
    const input = narrowSheetExport(twoStudentInput(), {
      studentIds: ['e2'],
    });
    expect(input.students.map((s) => s.fullName)).toEqual(['ROE, Rick']);
    const flat = sheetCells(buildAttendanceSheetWorkbook(input)).map(String);
    expect(flat).toContain('ROE, Rick');
    expect(flat).not.toContain('DOE, Jane');
  });

  it('keeps roster order whatever order the ids come in', () => {
    const input = narrowSheetExport(twoStudentInput(), {
      studentIds: ['e2', 'e1'],
    });
    expect(input.students.map((s) => s.indexNumber)).toEqual([1, 2]);
  });

  it('refuses a student who is not in the class', () => {
    expect(() =>
      narrowSheetExport(twoStudentInput(), { studentIds: ['e1', 'nope'] })
    ).toThrow(SheetExportScopeError);
  });

  it('narrows month and students together', () => {
    const input = narrowSheetExport(twoStudentInput(), {
      month: '2026-06',
      studentIds: ['e2'],
    });
    const flat = sheetCells(buildAttendanceSheetWorkbook(input));
    expect(flat.map(String)).not.toContain('DOE, Jane');
    // Rick in June: one marked day, 'A' → 0%.
    expect(flat).toContain(0);
    expect(flat.map(String)).not.toContain('2 Jul');
  });
});

describe('buildAttendanceYearWorkbook', () => {
  it('writes one worksheet per term, tabbed by term, each the full term sheet', () => {
    const t3 = { ...twoStudentInput(), sheetName: 'Term 3' };
    const t4: AttendanceSheetExportInput = {
      ...twoStudentInput(),
      sheetName: 'Term 4',
      term: {
        label: 'Term 4',
        termNumber: 4,
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
      calendarByDate: new Map([
        ['2026-10-05', { dayType: 'school_day', label: null }],
        ['2026-10-06', { dayType: 'school_day', label: null }],
      ]),
      events: [],
    };
    const buf = buildAttendanceYearWorkbook([t3, t4]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Term 3', 'Term 4']);
    expect(sheetCells(buf, 'Term 3').map(String)).toContain('Term 3 total');
    const t4Cells = sheetCells(buf, 'Term 4').map(String);
    expect(t4Cells).toContain('Term 4 total');
    expect(t4Cells).toContain('5 Oct');
    expect(t4Cells).not.toContain('29 Jun');
  });

  it('de-duplicates colliding tab names', () => {
    const a = twoStudentInput();
    const wb = XLSX.read(buildAttendanceYearWorkbook([a, a]), {
      type: 'buffer',
    });
    expect(new Set(wb.SheetNames).size).toBe(2);
  });
});

describe('sheetExportFilename', () => {
  it('names the scope', () => {
    const base = { levelCode: 'P5', sectionName: 'Commitment' };
    expect(sheetExportFilename({ ...base, periodLabel: 'Term 4' })).toBe(
      'P5-Commitment_Term4.xlsx'
    );
    expect(
      sheetExportFilename({
        ...base,
        periodLabel: 'Term 4',
        month: '2026-10',
      })
    ).toBe('P5-Commitment_Term4_October-2026.xlsx');
    expect(sheetExportFilename({ ...base, periodLabel: 'AY2026' })).toBe(
      'P5-Commitment_AY2026.xlsx'
    );
    expect(
      sheetExportFilename({ ...base, periodLabel: 'Term 4', studentCount: 3 })
    ).toBe('P5-Commitment_Term4_3-students.xlsx');
  });
});
