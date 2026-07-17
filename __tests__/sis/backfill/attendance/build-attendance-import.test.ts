// __tests__/sis/backfill/attendance/build-attendance-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImport } from '@/lib/sis/backfill/attendance/build-attendance-import';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';
import type { RosterLookupEntry } from '@/lib/sis/backfill/attendance/build-attendance-import';

const BASE_INPUT = {
  ayCode: 'AY2026',
  termNumber: 1,
  year: 2026,
};

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'P1',
    cleanName: 'Patience',
    indexNumber: 1,
    sectionStudentId: 'ss-alvarez-uuid',
  },
  {
    levelCode: 'P1',
    cleanName: 'Patience',
    indexNumber: 2,
    sectionStudentId: 'ss-amate-uuid',
  },
];

function buildSection(overrides: Partial<ParsedSection> = {}): ParsedSection {
  return {
    sheetName: 'P1 Patience(G)',
    classSectionLabel: 'P1 Patience (AM Global)',
    formTeacher: 'Ms. Kristel',
    students: [
      {
        indexNo: '1',
        fullName: 'ALVAREZ, Jaime III D.',
        marks: { '8-Jan': 'P', '9-Jan': 'A', '17-Feb': '' },
      },
      {
        indexNo: '2',
        fullName: 'AMATE, Jaiden Matthew A.',
        marks: { '8-Jan': 'P', '9-Jan': '', '17-Feb': '' },
      },
    ],
    firstDate: '8-Jan',
    lastDate: '17-Feb',
    dateColumns: ['8-Jan', '9-Jan', '17-Feb'],
    rejectedNames: [],
    legendEntries: [{ rawText: 'Feb 17-18 CNY', column: 'schoolHoliday' }],
    ...overrides,
  };
}

describe('buildAttendanceImport', () => {
  it('classifies dates, builds attendance rows, and computes stats', () => {
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });

    expect(result.stats.schoolDays).toBe(2); // 8-Jan, 9-Jan
    expect(result.stats.holidays).toBe(1); // 17-Feb
    expect(result.stats.attendanceRows).toBe(3); // Alvarez P+A, Amate P (blank 9-Jan skipped)
    expect(result.stats.needsReview).toBe(0);

    expect(result.apply).toContain("'ss-alvarez-uuid'");
    expect(result.apply).toContain("'2026-01-08'");
    expect(result.apply).toContain("'2026-01-09'");
    // 2026-02-17 IS written (school_calendar gets a row for every date,
    // including holidays) — but never as an attendance_daily mark row.
    const holidayMarkLine = result.apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-02-17') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
    expect(result.apply).toContain('school_calendar');
    expect(result.apply).toContain("'public_holiday'");
  });

  it('skips a blank cell on a school_day date rather than writing a row for it', () => {
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });

    // Amate's 9-Jan cell is blank on a school_day date — her only real mark
    // (8-Jan) gets an attendance_daily row, 9-Jan does not.
    expect(result.apply).toContain("'ss-amate-uuid', date '2026-01-08', 'P'");
    expect(result.apply).not.toContain("'ss-amate-uuid', date '2026-01-09'");
  });

  it('flags an unresolved (section, index_number) pair as needs-review', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '99',
          fullName: 'NOBODY, Unresolved',
          marks: { '8-Jan': 'P', '9-Jan': 'P', '17-Feb': '' },
        },
      ],
    });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('NOBODY');
  });

  it('flags an unexpected mark value as needs-review instead of writing invalid SQL', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '8-Jan': 'Q', '9-Jan': 'P', '17-Feb': '' },
        },
      ],
    });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain("'Q'");
  });

  it('excludes the YS sheet from attendance import, same as Phase 1', () => {
    const section = buildSection({ sheetName: 'YS', dateColumns: ['8-Jan'] });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    expect(result.stats.attendanceRows).toBe(0);
    expect(result.apply).not.toContain('ss-alvarez-uuid');
  });

  it('always writes ex_reason as an explicit NULL for EX marks', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '8-Jan': 'EX', '9-Jan': 'P', '17-Feb': '' },
        },
      ],
    });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    // The 'EX' mark was captured into the temp-table VALUES row.
    expect(result.apply).toContain(
      "'ss-alvarez-uuid', date '2026-01-08', 'EX'"
    );
    // ex_reason is written explicitly as a literal NULL in the INSERT
    // (never omitted, never guessed) — column list includes it, and the
    // select clause supplies null in that position for every row.
    expect(result.apply).toMatch(
      /insert into attendance_daily \(section_student_id, term_id, date, status, ex_reason,/
    );
    expect(result.apply).toMatch(/select .*m\.status, null,/);
  });

  it('keeps dates index-aligned when a malformed header sits between two valid ones', () => {
    // "5-Xyz" structurally matches the D-Mon header shape but "Xyz" is not
    // a real month, so resolveHeaderDate returns null for it. Before the
    // fix, .filter()-ing the null out of allDatesISO desynchronized it from
    // allDatesRaw — every downstream loop indexes both arrays by the same
    // `i`, so the real data under 9-Jan (the header AFTER the bad one)
    // would get silently misattributed or dropped.
    const section = buildSection({
      dateColumns: ['8-Jan', '5-Xyz', '9-Jan'],
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '8-Jan': 'P', '5-Xyz': 'L', '9-Jan': 'A' },
        },
        {
          indexNo: '2',
          fullName: 'AMATE, Jaiden Matthew A.',
          marks: { '8-Jan': 'A', '5-Xyz': 'EX', '9-Jan': 'P' },
        },
      ],
    });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    // 1) The malformed header's own mark data ('L' / 'EX') never leaks into
    // apply.sql at all.
    expect(result.apply).not.toContain("'L'");
    expect(result.apply).not.toContain(
      "'ss-alvarez-uuid', date '2026-01-08', 'EX'"
    );
    expect(result.apply).not.toContain(
      "'ss-amate-uuid', date '2026-01-08', 'EX'"
    );

    // 2) The real dates before and after the malformed header are still
    // correctly processed, under the CORRECT (not shifted) ISO date.
    expect(result.apply).toContain("'ss-alvarez-uuid', date '2026-01-08', 'P'");
    expect(result.apply).toContain("'ss-alvarez-uuid', date '2026-01-09', 'A'");
    expect(result.apply).toContain("'ss-amate-uuid', date '2026-01-08', 'A'");
    expect(result.apply).toContain("'ss-amate-uuid', date '2026-01-09', 'P'");

    // 3) The malformed header is tracked for operator visibility.
    expect(result.stats.unparseableDateHeaders).toContain('5-Xyz');
  });
});
