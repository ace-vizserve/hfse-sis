// __tests__/sis/backfill/attendance/build-attendance-import-t2.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImportT2 } from '@/lib/sis/backfill/attendance/build-attendance-import-t2';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';
import type {
  ApplySqlFile,
  RosterLookupEntry,
} from '@/lib/sis/backfill/attendance/build-attendance-import-t2';
import type { ParsedSectionWithLabels } from '@/lib/sis/backfill/attendance/attendance-workbook-t2';

function joinApply(applyFiles: ApplySqlFile[]): string {
  return applyFiles.map((f) => f.sql).join('\n');
}

const BASE_INPUT = {
  ayCode: 'AY2026',
  termNumber: 2,
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

function buildSection(
  overrides: Partial<ParsedSection> = {},
  dateLabels: Record<string, string> = { '3-Apr': 'Good Friday' }
): ParsedSectionWithLabels {
  return {
    section: {
      sheetName: 'P1 Patience(G)',
      classSectionLabel: 'P1 Patience (AM Global)',
      formTeacher: 'Ms. Kristel',
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
        {
          indexNo: '2',
          fullName: 'AMATE, Jaiden Matthew A.',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
      ],
      firstDate: '2-Apr',
      lastDate: '13-Apr',
      dateColumns: ['2-Apr', '3-Apr', '13-Apr'],
      rejectedNames: [],
      legendEntries: [],
      ...overrides,
    },
    dateLabels,
  };
}

describe('buildAttendanceImportT2', () => {
  it('classifies dates via row-8 labels, builds attendance rows, and computes stats', () => {
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.schoolDays).toBe(1); // 2-Apr
    expect(result.stats.holidays).toBe(2); // 3-Apr, 13-Apr
    expect(result.stats.attendanceRows).toBe(2); // Alvarez P, Amate P on 2-Apr
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.needsConfirmation).toBe(0); // 13-Apr has no label at all

    expect(apply).toContain("'ss-alvarez-uuid'");
    expect(apply).toContain("'2026-04-02'");
    expect(apply).toContain("'public_holiday'");
    // 2026-04-03 (Good Friday) IS written to school_calendar — but never
    // as an attendance_daily mark row, since it's not a school_day.
    const holidayMarkLine = apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-04-03') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
  });

  it('flags an unresolved (section, index_number) pair as needs-review', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '99',
          fullName: 'NOBODY, Unresolved',
          marks: { '2-Apr': 'P', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
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
          marks: { '2-Apr': 'Q', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.needsReview).toBe(1);
    expect(apply).not.toContain("'Q'");
  });

  it('treats the workbook\'s own "-" (No Class) marker as a distinct, non-error needs-review reason', () => {
    const section = buildSection({
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '2-Apr': '-', '3-Apr': '', '13-Apr': '' },
        },
      ],
    });
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.preview).toContain('"No Class" per the workbook');
  });

  it('excludes the YS sheet from attendance import, same as Phase 2', () => {
    const section = buildSection(
      { sheetName: 'YS', dateColumns: ['2-Apr'] },
      {}
    );
    const result = buildAttendanceImportT2({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.attendanceRows).toBe(0);
    expect(apply).not.toContain('ss-alvarez-uuid');
  });

  describe('needs-confirmation flagging (Locked Decision #6)', () => {
    it('does NOT flag a blank date whose label matches the public-holiday whitelist', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()], // 3-Apr labeled "Good Friday"
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(0);
      expect(result.preview).not.toContain('NEEDS CONFIRMATION');
    });

    it('flags a blank date whose label matches neither HBL nor the whitelist, and surfaces it in preview.sql', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection({}, { '13-Apr': 'Student Recollection' })],
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(1);
      expect(result.preview).toContain('[NEEDS CONFIRMATION]');
      expect(result.preview).toContain('Dates needing confirmation (1)');
      expect(result.preview).toContain('2026-04-13: "Student Recollection"');
      // Still classified no_class, not silently guessed as a holiday.
      expect(result.preview).toContain('2026-04-13: no_class');
    });

    it('does not flag a blank date with no label at all', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection({}, {})], // no labels anywhere
        rosterLookup: ROSTER,
      });

      expect(result.stats.needsConfirmation).toBe(0);
      expect(result.preview).toContain('Dates needing confirmation (0)');
      expect(result.preview).toContain('(none)');
    });
  });

  describe('apply file chunking (Supabase SQL Editor rejects one huge query)', () => {
    it('splits marks into multiple self-contained, ordered files when marksChunkSize is small', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1, // 2 attendance rows -> 2 marks chunk files
      });

      // calendar (1) + 2 marks chunks + rollups (1) = 4
      expect(result.applyFiles).toHaveLength(4);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-marks-01-of-02.sql');
      expect(result.applyFiles[2].filename).toBe('03-marks-02-of-02.sql');
      expect(result.applyFiles[3].filename).toBe('04-rollups-and-verify.sql');

      for (const f of result.applyFiles) {
        expect(f.sql).toContain('begin;');
        expect(f.sql).toContain('commit;');
      }

      const chunk1 = result.applyFiles[1].sql;
      expect(chunk1).toContain('create temp table _ay26att2_marks');
      expect(chunk1).toContain('insert into attendance_daily');
      expect(chunk1).toContain('where not exists (');

      const rollupsFile = result.applyFiles[3].sql;
      expect(rollupsFile).not.toContain('_ay26att2_marks');
      expect(rollupsFile).toContain('recompute_attendance_rollup');
    });

    it('produces one un-split marks file when the default chunk size comfortably covers all rows', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        // default marksChunkSize (2000) far exceeds this fixture's 2 rows
      });

      const marksFiles = result.applyFiles.filter((f) =>
        f.filename.includes('-marks-')
      );
      expect(marksFiles).toHaveLength(1);
      expect(marksFiles[0].filename).toBe('02-marks-01-of-01.sql');
    });

    it('lists every apply filename in run order inside preview.sql', () => {
      const result = buildAttendanceImportT2({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });

      for (const f of result.applyFiles) {
        expect(result.preview).toContain(f.filename);
      }
      const positions = result.applyFiles.map((f) =>
        result.preview.indexOf(f.filename)
      );
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });
  });
});
