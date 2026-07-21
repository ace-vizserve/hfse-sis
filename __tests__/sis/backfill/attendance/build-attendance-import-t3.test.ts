// __tests__/sis/backfill/attendance/build-attendance-import-t3.test.ts
import { describe, expect, it } from 'vitest';

import { buildAttendanceImportT3 } from '@/lib/sis/backfill/attendance/build-attendance-import-t3';
import type {
  ApplySqlFile,
  RosterLookupEntry,
} from '@/lib/sis/backfill/attendance/build-attendance-import-t3';
import type {
  LegendEntryT3,
  LegendGroupT3,
  ParsedSectionT3,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t3';

function joinApply(applyFiles: ApplySqlFile[]): string {
  return applyFiles.map((f) => f.sql).join('\n');
}

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 3, year: 2026 };

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

function emptyLegendGroups(): Record<LegendGroupT3, LegendEntryT3[]> {
  return {
    schoolEvents: [],
    schoolHoliday: [],
    publicHoliday: [],
    examination: [],
  };
}

function buildSection(
  overrides: Partial<ParsedSectionT3> = {}
): ParsedSectionT3 {
  return {
    section: {
      sheetName: 'P1 Patience (Global)',
      students: [
        {
          indexNo: '1',
          fullName: 'ALVAREZ, Jaime III D.',
          marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': 'P' },
        },
        {
          indexNo: '2',
          fullName: 'AMATE, Jaiden Matthew A.',
          marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
        },
      ],
      dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
    },
    term: '3',
    course: 'Primary One',
    sectionLabel: 'Patience (Global)',
    formAdviser: 'Ms. Kristel',
    legendGroups: {
      ...emptyLegendGroups(),
      schoolHoliday: [{ dateText: '6-Jul', label: 'In Lieu of Youth Day' }],
      schoolEvents: [
        { dateText: '21-Jul', label: 'Racial Harmony Celebration' },
      ],
    },
    dateTags: { '6-Jul': 'SH', '21-Jul': 'SE' },
    ...overrides,
  };
}

describe('buildAttendanceImportT3', () => {
  it('classifies dates via row-11 tags + legend labels, builds attendance rows, and computes stats', () => {
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [buildSection()],
      rosterLookup: ROSTER,
    });
    const apply = joinApply(result.applyFiles);

    expect(result.stats.schoolDays).toBe(2); // 29-Jun, 21-Jul (SE, has marks)
    expect(result.stats.holidays).toBe(1); // 6-Jul (SH)
    expect(result.stats.events).toBe(1); // 21-Jul's school_event
    expect(result.stats.eventsMissingLabel).toBe(0);
    expect(result.stats.attendanceRows).toBe(3); // Alvarez P x2, Amate P x1
    expect(result.stats.needsReview).toBe(0);

    expect(apply).toContain("'ss-alvarez-uuid'");
    expect(apply).toContain("'2026-06-29'");
    expect(apply).toContain("'school_holiday'");
    expect(apply).toContain("'Racial Harmony Celebration'");
    expect(apply).toContain("'school_event'");

    const holidayMarkLine = apply
      .split('\n')
      .find(
        (l) =>
          l.includes('2026-07-06') &&
          (l.includes('ss-alvarez-uuid') || l.includes('ss-amate-uuid'))
      );
    expect(holidayMarkLine).toBeUndefined();
  });

  it('normalizes a "Section - N" sheet name to the DB\'s "Section N" naming before roster lookup', () => {
    const section = buildSection({
      section: {
        sheetName: 'S1 Discipline - 1',
        students: [
          {
            indexNo: '1',
            fullName: 'CRUZ, Juan A.',
            marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const roster: RosterLookupEntry[] = [
      {
        levelCode: 'S1',
        cleanName: 'Discipline 1',
        indexNumber: 1,
        sectionStudentId: 'ss-cruz-uuid',
      },
    ];
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: roster,
    });
    expect(result.stats.needsReview).toBe(0);
    expect(joinApply(result.applyFiles)).toContain("'ss-cruz-uuid'");
  });

  it('flags an unresolved (section, index_number) pair as needs-review', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '99',
            fullName: 'NOBODY, Unresolved',
            marks: { '29-Jun': 'P', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(1);
    expect(joinApply(result.applyFiles)).not.toContain('NOBODY');
  });

  it('flags an unexpected mark value as needs-review instead of writing invalid SQL', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '1',
            fullName: 'ALVAREZ, Jaime III D.',
            marks: { '29-Jun': 'Q', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(1);
    expect(joinApply(result.applyFiles)).not.toContain("'Q'");
  });

  it('normalizes a lowercase mark before writing it', () => {
    const section = buildSection({
      section: {
        sheetName: 'P1 Patience (Global)',
        students: [
          {
            indexNo: '1',
            fullName: 'ALVAREZ, Jaime III D.',
            marks: { '29-Jun': 'p', '6-Jul': '', '21-Jul': '' },
          },
        ],
        dateColumns: ['29-Jun', '6-Jul', '21-Jul'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.needsReview).toBe(0);
    expect(joinApply(result.applyFiles)).toContain("date '2026-06-29', 'P'");
  });

  it('excludes the YS sheet from the import', () => {
    const section = buildSection({
      section: {
        sheetName: 'YS',
        students: [
          {
            indexNo: '1',
            fullName: 'NURSERY, Someone A.',
            marks: { '29-Jun': 'Present' },
          },
        ],
        dateColumns: ['29-Jun'],
      },
    });
    const result = buildAttendanceImportT3({
      ...BASE_INPUT,
      sections: [section],
      rosterLookup: ROSTER,
    });
    expect(result.stats.attendanceRows).toBe(0);
    expect(joinApply(result.applyFiles)).not.toContain('NURSERY');
  });

  describe('event label handling', () => {
    it('skips an SE/EX-tagged date with no matching legend entry from calendar_events, flags it in stats + preview', () => {
      const section = buildSection({
        dateTags: { '21-Jul': 'SE' },
        legendGroups: emptyLegendGroups(),
      });
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [section],
        rosterLookup: ROSTER,
      });
      expect(result.stats.events).toBe(1);
      expect(result.stats.eventsMissingLabel).toBe(1);
      expect(result.preview).toContain('NEEDS LABEL');
      expect(joinApply(result.applyFiles)).not.toContain('school_event');
    });
  });

  describe('apply file chunking', () => {
    it('splits marks into multiple self-contained, ordered files, with calendar + events always first', () => {
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
        marksChunkSize: 1,
      });
      // calendar (1) + events (1) + 3 marks chunks (3 attendanceRows) + rollups (1) = 6
      expect(result.applyFiles).toHaveLength(6);
      expect(result.applyFiles[0].filename).toBe('01-calendar.sql');
      expect(result.applyFiles[1].filename).toBe('02-events.sql');
      expect(result.applyFiles[2].filename).toBe('03-marks-01-of-03.sql');
      expect(result.applyFiles[5].filename).toBe('06-rollups-and-verify.sql');
      for (const f of result.applyFiles) {
        expect(f.sql).toContain('begin;');
        expect(f.sql).toContain('commit;');
      }
    });

    it('produces one un-split marks file when the default chunk size comfortably covers all rows', () => {
      const result = buildAttendanceImportT3({
        ...BASE_INPUT,
        sections: [buildSection()],
        rosterLookup: ROSTER,
      });
      const marksFiles = result.applyFiles.filter((f) =>
        f.filename.includes('-marks-')
      );
      expect(marksFiles).toHaveLength(1);
      expect(marksFiles[0].filename).toBe('03-marks-01-of-01.sql');
    });
  });
});
