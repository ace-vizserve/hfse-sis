// Two school years, the same fixture for every Insights parity test.
//
// AY2026: terms 1-3; T2 is_current, so the grade histogram reads T2.
//   Sections: Patience (P1), Courage (P2), Unlevelled (a level_id the
//   `levels` table lacks — the subject chart counts its sheets, the level
//   charts cannot).
// AY2025: terms 1-2, both finished, so the histogram reads T2.
//   Section: Honesty (P1).
// Subjects: Mathematics + English (examinable), Music (not examinable).
// Three students a section; Patience's third is withdrawn and keeps grades.
// Four entries are special (OVERRIDES) — each is a rule the drills must share.

import type { CompareCellResult } from '@/lib/dashboard/compare';
import type { MarkbookCompareKpis } from '@/lib/markbook/compare';

import type { Row, Tables } from './fake-service';

export const NOW = new Date('2026-09-29T04:00:00.000Z');

export const AY_CODE: Record<string, string> = {
  ay25: 'AY2025',
  ay26: 'AY2026',
};

const LEVELS = [
  { id: 'lv-p1', code: 'P1' },
  { id: 'lv-p2', code: 'P2' },
];
const LEVEL_CODE = new Map(LEVELS.map((l) => [l.id, l.code]));

const SUBJECTS = [
  { id: 'sub-math', code: 'MATH', name: 'Mathematics', is_examinable: true },
  { id: 'sub-eng', code: 'ENG', name: 'English', is_examinable: true },
  { id: 'sub-mus', code: 'MUS', name: 'Music', is_examinable: false },
];

export const TERMS = [
  {
    id: 't25-1',
    term_number: 1,
    academic_year_id: 'ay25',
    label: 'Term 1',
    start_date: '2025-01-06',
    end_date: '2025-03-14',
    is_current: false,
  },
  {
    id: 't25-2',
    term_number: 2,
    academic_year_id: 'ay25',
    label: 'Term 2',
    start_date: '2025-03-24',
    end_date: '2025-06-06',
    is_current: false,
  },
  {
    id: 't26-1',
    term_number: 1,
    academic_year_id: 'ay26',
    label: 'Term 1',
    start_date: '2026-01-05',
    end_date: '2026-03-13',
    is_current: false,
  },
  {
    id: 't26-2',
    term_number: 2,
    academic_year_id: 'ay26',
    label: 'Term 2',
    start_date: '2026-03-23',
    end_date: '2026-06-05',
    is_current: true,
  },
  {
    id: 't26-3',
    term_number: 3,
    academic_year_id: 'ay26',
    label: 'Term 3',
    start_date: '2026-06-29',
    end_date: '2026-09-04',
    is_current: false,
  },
];

const SECTIONS = [
  {
    id: 'sec26-a',
    name: 'Patience',
    academic_year_id: 'ay26',
    level_id: 'lv-p1',
  },
  {
    id: 'sec26-b',
    name: 'Courage',
    academic_year_id: 'ay26',
    level_id: 'lv-p2',
  },
  {
    id: 'sec26-x',
    name: 'Unlevelled',
    academic_year_id: 'ay26',
    level_id: 'lv-gone',
  },
  {
    id: 'sec25-a',
    name: 'Honesty',
    academic_year_id: 'ay25',
    level_id: 'lv-p1',
  },
];

const STUDENTS_PER_SECTION = 3;

type Override = {
  quarterly_grade?: number | null;
  is_na?: boolean;
  ww_scores?: (number | null)[];
  pt_scores?: (number | null)[];
  qa_score?: number | null;
};

const OVERRIDES: Record<string, Override> = {
  // N.A. — not enrolled that term; its 95 is a placeholder, never counted.
  'ge-sh-sec26-a-MATH-T2-0': { is_na: true, quarterly_grade: 95 },
  // A grade with no raw scores behind it (imported) — every figure counts it.
  'ge-sh-sec26-a-MATH-T2-1': {
    quarterly_grade: 91,
    ww_scores: [null, null],
    pt_scores: [null],
    qa_score: null,
  },
  // Partly entered — no grade yet.
  'ge-sh-sec26-b-ENG-T3-2': {
    quarterly_grade: null,
    ww_scores: [7, null],
    pt_scores: [null],
    qa_score: null,
  },
  // Auto-seeded and untouched.
  'ge-sh-sec26-b-MATH-T3-2': {
    quarterly_grade: null,
    ww_scores: [null, null],
    pt_scores: [null],
    qa_score: null,
  },
};

export function gradeFor(
  sectionIdx: number,
  subjectIdx: number,
  termNumber: number,
  studentIdx: number
): number {
  return (
    60 +
    ((studentIdx * 13 + subjectIdx * 7 + termNumber * 5 + sectionIdx * 3) % 40)
  );
}

export type FixtureEntry = {
  id: string;
  ayCode: string;
  termNumber: number;
  subjectName: string;
  examinable: boolean;
  levelCode: string | null;
  isNa: boolean;
  grade: number | null;
};

export function buildInsightsFixture(): {
  tables: Tables;
  entries: FixtureEntry[];
} {
  const students: Row[] = [];
  const sectionStudents: Row[] = [];
  const sheets: Row[] = [];
  const gradeEntries: Row[] = [];
  const entries: FixtureEntry[] = [];

  SECTIONS.forEach((sec, secIdx) => {
    for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
      const studentId = `st-${sec.id}-${i}`;
      students.push({
        id: studentId,
        student_number: `H${secIdx}${i}0001`,
        first_name: `Student ${i + 1}`,
        last_name: sec.name,
      });
      sectionStudents.push({
        id: `ss-${sec.id}-${i}`,
        section_id: sec.id,
        student_id: studentId,
        enrollment_status:
          sec.id === 'sec26-a' && i === 2 ? 'withdrawn' : 'active',
      });
    }
    const levelCode = LEVEL_CODE.get(sec.level_id) ?? null;
    const terms = TERMS.filter(
      (t) => t.academic_year_id === sec.academic_year_id
    );
    SUBJECTS.forEach((sub, subIdx) => {
      for (const term of terms) {
        const sheetId = `sh-${sec.id}-${sub.code}-T${term.term_number}`;
        const isLocked =
          term.term_number === 1 ||
          (sec.id === 'sec26-a' &&
            sub.code === 'MATH' &&
            term.term_number === 2);
        sheets.push({
          id: sheetId,
          term_id: term.id,
          section_id: sec.id,
          subject_id: sub.id,
          qa_total: 30,
          is_locked: isLocked,
          locked_at: isLocked ? '2026-04-01T00:00:00Z' : null,
          teacher_name: null,
          subject: { name: sub.name, is_examinable: sub.is_examinable },
          section: { level: levelCode ? { code: levelCode } : null },
        });
        for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
          const id = `ge-${sheetId}-${i}`;
          const o = OVERRIDES[id] ?? {};
          const grade =
            o.quarterly_grade === undefined
              ? gradeFor(secIdx, subIdx, term.term_number, i)
              : o.quarterly_grade;
          const isNa = o.is_na ?? false;
          gradeEntries.push({
            id,
            grading_sheet_id: sheetId,
            section_student_id: `ss-${sec.id}-${i}`,
            ww_scores: o.ww_scores ?? [8, 9],
            pt_scores: o.pt_scores ?? [9],
            qa_score: o.qa_score === undefined ? 25 : o.qa_score,
            quarterly_grade: grade,
            letter_grade: null,
            is_na: isNa,
            created_at: '2026-02-01T00:00:00Z',
          });
          entries.push({
            id,
            ayCode: AY_CODE[sec.academic_year_id],
            termNumber: term.term_number,
            subjectName: sub.name,
            examinable: sub.is_examinable,
            levelCode,
            isNa,
            grade,
          });
        }
      }
    });
  });

  const cr = (
    id: string,
    sheet: string,
    ay: string,
    status: string,
    requestedAt: string,
    reviewedAt: string | null = null,
    appliedAt: string | null = null
  ): Row => ({
    id,
    grading_sheet_id: sheet,
    field_changed: 'ww_scores',
    reason_category: 'data_entry_error',
    status,
    requested_by_email: 'teacher@hfse.test',
    requested_at: requestedAt,
    reviewed_at: reviewedAt,
    applied_at: appliedAt,
    grading_sheets: { sections: { academic_year_id: ay } },
  });

  return {
    entries,
    tables: {
      academic_years: [
        { id: 'ay25', ay_code: 'AY2025' },
        { id: 'ay26', ay_code: 'AY2026' },
      ],
      terms: TERMS,
      sections: SECTIONS,
      levels: LEVELS,
      subjects: SUBJECTS,
      subject_configs: [],
      students,
      section_students: sectionStudents,
      grading_sheets: sheets,
      grade_entries: gradeEntries,
      teacher_assignments: [],
      report_card_publications: [],
      // NOW = 2026-09-29T04:00Z → the 30-day window opens 2026-08-30T04:00Z.
      grade_change_requests: [
        cr(
          'cr-1',
          'sh-sec26-a-MATH-T1',
          'ay26',
          'pending',
          '2026-09-20T02:00:00Z'
        ),
        cr(
          'cr-2',
          'sh-sec26-a-ENG-T1',
          'ay26',
          'approved',
          '2026-09-10T00:00:00Z',
          '2026-09-11T06:00:00Z'
        ),
        cr(
          'cr-3',
          'sh-sec26-b-MATH-T1',
          'ay26',
          'applied',
          '2026-09-01T00:00:00Z',
          '2026-09-01T12:00:00Z',
          '2026-09-03T00:00:00Z'
        ),
        // Reviewed "before" it was requested — the average skips it.
        cr(
          'cr-4',
          'sh-sec26-b-ENG-T1',
          'ay26',
          'rejected',
          '2026-09-15T00:00:00Z',
          '2026-09-14T00:00:00Z'
        ),
        // Outside the window.
        cr(
          'cr-5',
          'sh-sec26-a-MATH-T1',
          'ay26',
          'pending',
          '2026-08-20T00:00:00Z'
        ),
        cr(
          'cr-7',
          'sh-sec26-x-MATH-T1',
          'ay26',
          'cancelled',
          '2026-09-25T00:00:00Z'
        ),
        // The comparison year.
        cr(
          'cr-6',
          'sh-sec25-a-MATH-T1',
          'ay25',
          'approved',
          '2026-09-21T00:00:00Z',
          '2026-09-21T10:00:00Z'
        ),
      ],
    },
  };
}

/** The Insights page's term cells for these years (getSubjectPerformanceTrend input). */
export function termCells(
  ayCodes: string[]
): CompareCellResult<MarkbookCompareKpis>[] {
  return TERMS.filter((t) => ayCodes.includes(AY_CODE[t.academic_year_id])).map(
    (t) => ({
      cell: {
        ayCode: AY_CODE[t.academic_year_id],
        label: `${AY_CODE[t.academic_year_id]} · T${t.term_number}`,
        range: { from: t.start_date, to: t.end_date },
        kind: 'term',
        termNumber: t.term_number,
        termId: t.id,
      },
      data: null,
    })
  ) as unknown as CompareCellResult<MarkbookCompareKpis>[];
}

/** Ids of the entries an Insights average counts, narrowed by `pred` — computed from the fixture, independent of any loader. */
export function expectedIds(
  entries: FixtureEntry[],
  pred: (e: FixtureEntry) => boolean
): string[] {
  return entries
    .filter((e) => e.examinable && !e.isNa && e.grade !== null && pred(e))
    .map((e) => e.id)
    .sort();
}

export function mean1(values: number[]): number {
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  );
}
