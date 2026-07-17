// __tests__/sis/backfill/attendance/build-attendance-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImport } from '@/lib/sis/backfill/attendance/build-attendance-import';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';
import type {
  ApplySqlFile,
  RosterLookupEntry,
} from '@/lib/sis/backfill/attendance/build-attendance-import';

// Most assertions don't care about file boundaries — concatenate every
// apply file's SQL in order, the same way a reviewer reads them file-by-file.
function joinApply(applyFiles: ApplySqlFile[]): string {
  return applyFiles.map((f) => f.sql).join('\n');
}

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
    const apply = joinApply(result.applyFiles);

    expect(result.stats.schoolDays).toBe(2); // 8-Jan, 9-Jan
    expect(result.stats.holidays).toBe(1); // 17-Feb
    expect(result.stats.attendanceRows).toBe(3); // Alvarez P+A, Amate P (blank 9-Jan skipped)
    expect(result.stats.needsReview).toBe(0);

    expect(apply).toContain("'ss-alvarez-uuid'");
    expect(apply).toContain("'2026-01-08'");
    expect(apply).toContain("'2026-01-09'");
    // 2026-02-17 IS written (school_calendar gets a row for every date,
    // including holidays) — but never as an attendance_daily mark row.
    const holidayMarkLine = apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-02-17') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
    expect(apply).toContain('school_calendar');
    expect(apply).toContain("'public_holiday'");
  });

  it('skips a blank cell on a school_day date rather than writing a row for it', () => {
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    // Amate's 9-Jan cell is blank on a school_day date — her only real mark
    // (8-Jan) gets an attendance_daily row, 9-Jan does not.
    expect(apply).toContain("'ss-amate-uuid', date '2026-01-08', 'P'");
    expect(apply).not.toContain("'ss-amate-uuid', date '2026-01-09'");
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
    const apply = joinApply(result.applyFiles);

    expect(result.stats.needsReview).toBe(1);
    expect(apply).not.toContain('NOBODY');
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
    const apply = joinApply(result.applyFiles);

    expect(result.stats.needsReview).toBe(1);
    expect(apply).not.toContain("'Q'");
  });

  it('excludes the YS sheet from attendance import, same as Phase 1', () => {
    const section = buildSection({ sheetName: 'YS', dateColumns: ['8-Jan'] });
    const result = buildAttendanceImport({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.attendanceRows).toBe(0);
    expect(apply).not.toContain('ss-alvarez-uuid');
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
    const apply = joinApply(result.applyFiles);

    // The 'EX' mark was captured into the temp-table VALUES row.
    expect(apply).toContain("'ss-alvarez-uuid', date '2026-01-08', 'EX'");
    // ex_reason is written explicitly as a literal NULL in the INSERT
    // (never omitted, never guessed) — column list includes it, and the
    // select clause supplies null in that position for every row.
    expect(apply).toMatch(
      /insert into attendance_daily \(section_student_id, term_id, date, status, ex_reason,/
    );
    expect(apply).toMatch(/select .*m\.status, null,/);
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
    const apply = joinApply(result.applyFiles);

    // 1) The malformed header's own mark data ('L' / 'EX') never leaks into
    // any apply file at all.
    expect(apply).not.toContain("'L'");
    expect(apply).not.toContain("'ss-alvarez-uuid', date '2026-01-08', 'EX'");
    expect(apply).not.toContain("'ss-amate-uuid', date '2026-01-08', 'EX'");

    // 2) The real dates before and after the malformed header are still
    // correctly processed, under the CORRECT (not shifted) ISO date.
    expect(apply).toContain("'ss-alvarez-uuid', date '2026-01-08', 'P'");
    expect(apply).toContain("'ss-alvarez-uuid', date '2026-01-09', 'A'");
    expect(apply).toContain("'ss-amate-uuid', date '2026-01-08', 'A'");
    expect(apply).toContain("'ss-amate-uuid', date '2026-01-09', 'P'");

    // 3) The malformed header is tracked for operator visibility.
    expect(result.stats.unparseableDateHeaders).toContain('5-Xyz');
  });

  describe('apply file chunking (Supabase SQL Editor rejects one huge query)', () => {
    it('splits marks into multiple self-contained, ordered files when marksChunkSize is small', () => {
      const result = buildAttendanceImport({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1, // 3 attendance rows -> 3 marks chunk files
      });

      // calendar (1) + 3 marks chunks (marksChunkSize=1, 3 rows) + rollups (1) = 5
      expect(result.applyFiles).toHaveLength(5);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-marks-01-of-03.sql');
      expect(result.applyFiles[2].filename).toBe('03-marks-02-of-03.sql');
      expect(result.applyFiles[3].filename).toBe('04-marks-03-of-03.sql');
      expect(result.applyFiles[4].filename).toBe('05-rollups-and-verify.sql');

      // Every file is independently self-contained: its own begin/commit.
      for (const f of result.applyFiles) {
        expect(f.sql).toContain('begin;');
        expect(f.sql).toContain('commit;');
      }

      // Each marks chunk file carries exactly one row's worth of VALUES and
      // its own guarded insert — not a fragment relying on another file's
      // temp table.
      const chunk1 = result.applyFiles[1].sql;
      expect(chunk1).toContain('create temp table _ay26att_marks');
      expect(chunk1).toContain('insert into attendance_daily');
      expect(chunk1).toContain('where not exists (');

      // The rollups file has no marks VALUES list of its own — it only
      // calls recompute_attendance_rollup per distinct student.
      const rollupsFile = result.applyFiles[4].sql;
      expect(rollupsFile).not.toContain('_ay26att_marks');
      expect(rollupsFile).toContain('recompute_attendance_rollup');
    });

    it('emits exactly 2 files (calendar + rollups, no marks chunk) when there are zero attendance rows', () => {
      const section = buildSection({ sheetName: 'YS', dateColumns: ['8-Jan'] });
      const result = buildAttendanceImport({
        ...BASE_INPUT,
        sections: [section],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });

      expect(result.stats.attendanceRows).toBe(0);
      expect(result.applyFiles).toHaveLength(2);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-rollups-and-verify.sql');
    });

    it('lists every apply filename in run order inside preview.sql', () => {
      const result = buildAttendanceImport({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });

      for (const f of result.applyFiles) {
        expect(result.preview).toContain(f.filename);
      }
      // Filenames appear in the same order they must be run.
      const positions = result.applyFiles.map((f) =>
        result.preview.indexOf(f.filename)
      );
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });

    it('produces one un-split marks file when the default chunk size comfortably covers all rows', () => {
      const result = buildAttendanceImport({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        // default marksChunkSize (2000) far exceeds this fixture's 3 rows
      });

      const marksFiles = result.applyFiles.filter((f) =>
        f.filename.includes('-marks-')
      );
      expect(marksFiles).toHaveLength(1);
      expect(marksFiles[0].filename).toBe('02-marks-01-of-01.sql');
    });
  });
});
