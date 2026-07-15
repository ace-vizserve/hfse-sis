/**
 * Integration-in-miniature test for buildReportCard().
 *
 * This file guards the core "card == teacher input" promise (pain-points #1/#3):
 * report card data is computed live from grade_entries — no intermediate file,
 * no transformation — so what the teacher saved is exactly what the parent sees.
 *
 * Approach: inject a hand-rolled chainable fake SupabaseClient (the makeService
 * pattern, see __tests__/markbook/publish-readiness.test.ts). Mocks needed:
 *   - @/lib/sis/school-config (getSchoolConfig + DEFAULT_SCHOOL_CONFIG)
 *   - @/lib/attendance/calendar (getEncodableDatesForTerm)
 * These two have server-only Supabase internals that would explode in jsdom.
 *
 * Core assertions:
 *   1. Hard Rule #1 canonical scores → quarterly = 93 in the payload
 *   2. Annual grade matches computeAnnualGrade (lib/compute/annual.ts)
 *   3. Non-enrolled term → is_na = true  (KD #148 enrolment-coverage proration)
 *   4. FCA comment sourced from evaluation_writeups  (KD #49)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeAnnualGrade } from '@/lib/compute/annual';
import { buildReportCard } from '@/lib/report-card/build-report-card';

// ─── Module mocks (hoisted by Vitest) ────────────────────────────────────────

vi.mock('@/lib/sis/school-config', () => {
  const cfg = {
    principalName: '',
    ceoName: '',
    peiRegistrationNumber: '',
    defaultPublishWindowDays: 7,
    defaultCompassionateAllowancePerYear: 5,
    defaultVlAllowancePerTerm: 1,
    subjectAwardBronzeMin: 88.5,
    subjectAwardSilverMin: 91.5,
    subjectAwardGoldMin: 95.5,
    subjectAwardMax: 100,
    organizationName: 'HFSE Global Education Group',
    addressLine1: '',
    addressLine2: '',
    phoneNumber: '',
    websiteUrl: '',
    contactEmail: '',
    peiRegistrationStartDate: null,
    peiRegistrationEndDate: null,
    logoUrl: '',
  };
  return {
    DEFAULT_SCHOOL_CONFIG: cfg,
    getSchoolConfig: () => Promise.resolve(cfg),
  };
});

vi.mock('@/lib/attendance/calendar', () => ({
  // Return empty dates → enrolledSchoolDays = 0 → falls back to
  // recordedSchoolDaysByTerm from the second attendance_records query.
  getEncodableDatesForTerm: vi.fn().mockResolvedValue([]),
}));

// Form-adviser name resolution (dual-source-drift fix) — configurable per
// test via mockResolvedValue; defaults to no staff (empty map), matching
// "no adviser assigned" for tests that don't seed teacher_assignments.
const getStaffDisplayNameByIdMock = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: () => getStaffDisplayNameByIdMock(),
}));

// ─── Fake SupabaseClient factory ──────────────────────────────────────────────

/**
 * Build a minimal chainable fake. All filter methods (.eq / .in / .order /
 * .neq) return `this` so they chain. `.single()` resolves with the first row.
 * The chain itself is Thenable (`.then`) so `await chain` resolves with
 * `{ data: rows }` — needed for queries that don't end with `.single()`.
 *
 * For `attendance_records` we have TWO queries with DIFFERENT select strings;
 * differentiate on whether the `sel` string contains 'school_days'.
 */
function makeClient(tables: {
  students?: unknown[];
  academic_years?: unknown[];
  terms?: unknown[];
  section_students?: unknown[];
  // Migration 080 dropped subject_configs.level_id — the "which subjects
  // appear on this card" query in build-report-card.ts now reads
  // subject_level_offerings instead (Pattern A). Keyed here to match.
  subject_level_offerings?: unknown[];
  grading_sheets?: unknown[];
  grade_entries?: unknown[];
  'attendance_records:presence'?: unknown[]; // term_id, days_present, days_late
  'attendance_records:school_days'?: unknown[]; // term_id, school_days
  evaluation_writeups?: unknown[];
  teacher_assignments?: unknown[]; // { teacher_user_id } — role='form_adviser' row
  // subject_report_map wiring: subject_id/report_subject_id rows (flat, no
  // embed) + the plain `subjects` lookup used to resolve target metadata.
  // Distinct keys — build-report-card.ts issues two separate `.from()`
  // calls (no `subjects!<fk>` embed hint), matching this fake client's
  // per-table dispatch.
  subject_report_map?: unknown[];
  subjects?: unknown[];
}) {
  function makeChain(table: string, sel: string = ''): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select(s: string) {
        return makeChain(table, s);
      },
      eq() {
        return chain;
      },
      in() {
        return chain;
      },
      order() {
        return chain;
      },
      neq() {
        return chain;
      },
      maybeSingle() {
        const rows = (tables[table as keyof typeof tables] ?? []) as unknown[];
        return Promise.resolve({ data: rows[0] ?? null });
      },
      single() {
        const rows = (tables[table as keyof typeof tables] ?? []) as unknown[];
        return Promise.resolve({ data: rows[0] ?? null });
      },
      then(
        onFulfilled: (v: { data: unknown[] }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        let key: string = table;
        if (table === 'attendance_records') {
          key = sel.includes('school_days')
            ? 'attendance_records:school_days'
            : 'attendance_records:presence';
        }
        const rows = (tables[key as keyof typeof tables] ?? []) as unknown[];
        return Promise.resolve({ data: rows }).then(
          onFulfilled as (v: unknown) => unknown,
          onRejected
        );
      },
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) };
}

// ─── Shared fixture data ──────────────────────────────────────────────────────

const STUDENT_ID = 'stu-1';

/** T1: '2026-01-05' → '2026-03-31'; T2: '2026-04-07' → '2026-06-30' etc. */
const TERMS = [
  {
    id: 't1',
    term_number: 1,
    label: 'Term 1',
    virtue_theme: 'Honesty',
    start_date: '2026-01-05',
    end_date: '2026-03-31',
  },
  {
    id: 't2',
    term_number: 2,
    label: 'Term 2',
    virtue_theme: 'Diligence',
    start_date: '2026-04-07',
    end_date: '2026-06-30',
  },
  {
    id: 't3',
    term_number: 3,
    label: 'Term 3',
    virtue_theme: null,
    start_date: '2026-07-01',
    end_date: '2026-09-30',
  },
  {
    id: 't4',
    term_number: 4,
    label: 'Term 4',
    virtue_theme: null,
    start_date: '2026-10-01',
    end_date: '2026-11-28',
  },
];

const LEVEL = {
  id: 'level-p1',
  code: 'P1',
  label: 'Primary One',
  level_type: 'primary',
};
const SECTION = {
  id: 'sec-1',
  name: 'P1 Obedience',
  form_class_adviser: null,
  academic_year_id: 'ay-1',
  level: LEVEL,
};
const SUBJECT_MATH = {
  id: 'sub-math',
  code: 'MATH',
  name: 'Mathematics',
  is_examinable: true,
};

// subject_report_map fan-in fixtures — two graded subjects that both fold
// into a shared display target. This is the ONLY existing fixture pair
// (SUBJECT_MATH) can't express, since it's a single self-mapped subject.
const SUBJECT_FILIPINO = {
  id: 'sub-fil',
  code: 'FIL',
  name: 'Filipino',
  is_examinable: false,
};
const SUBJECT_MANDARIN = {
  id: 'sub-man',
  code: 'MAN',
  name: 'Mandarin',
  is_examinable: false,
};
const SUBJECT_MOTHER_TONGUE_TARGET = {
  id: 'sub-mt',
  code: 'MT',
  name: 'Mother Tongue',
  is_examinable: false,
};

/** 4 grading sheets — one per term for Mathematics */
const SHEETS = TERMS.map((t) => ({
  id: `sheet-${t.id}`,
  term_id: t.id,
  subject_id: SUBJECT_MATH.id,
  section_id: SECTION.id,
}));

function makeEnrolment(
  overrides: Partial<{
    enrollment_date: string | null;
    withdrawal_date: string | null;
    enrollment_status: string;
  }> = {}
) {
  return {
    id: 'ss-1',
    enrollment_status: 'active',
    created_at: '2026-01-05T08:00:00Z',
    enrollment_date: null,
    withdrawal_date: null,
    section: SECTION,
    ...overrides,
  };
}

/**
 * Grade entries for all 4 terms.
 * Use the canonical Hard-Rule-#1 quarterly (93) for T1.
 */
function makeGradeEntries(
  quarterlies: [number | null, number | null, number | null, number | null]
): unknown[] {
  return SHEETS.map((sheet, i) => ({
    id: `ge-${i}`,
    grading_sheet_id: sheet.id,
    section_student_id: 'ss-1',
    quarterly_grade: quarterlies[i],
    letter_grade: null,
    is_na: false,
    annual_letter_grade: null,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildReportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hard Rule #1 — canonical quarterly 93 passes through unchanged', () => {
    it('payload.subjects[0].t1.quarterly === 93', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        // Hard Rule #1: quarterly for T1 = 93 (already computed + stored by the
        // server when the teacher saved scores; this test proves the card reads the
        // stored value unchanged, not a re-derivation).
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [
          { term_id: 't1', days_present: 70, days_late: 2 },
        ],
        'attendance_records:school_days': [{ term_id: 't1', school_days: 75 }],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.subjects[0].t1.quarterly).toBe(93);
    });
  });

  describe('Annual grade matches computeAnnualGrade output', () => {
    it('annual = computeAnnualGrade(93, 90, 88, 85, all-enrolled)', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Use the same function the loader calls so the test tracks real output,
      // not a hand-calculated constant that can drift.
      const expectedAnnual = computeAnnualGrade(93, 90, 88, 85, [
        false,
        false,
        false,
        false,
      ]);
      expect(result.payload.subjects[0].annual).toBe(expectedAnnual);
    });
  });

  describe('KD #148 — non-enrolled term → N.A.', () => {
    it('T1 is_na=true when enrollment_date is in T2 (student joined mid-year)', async () => {
      // enrollment_date='2026-04-07' (T2 start) → T1 dates (Jan–Mar) are before
      // enrolment → isEnrolledForTerm(T1) === false → grades overridden to N.A.
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [
          makeEnrolment({
            enrollment_date: '2026-04-07',
            enrollment_status: 'late_enrollee',
          }),
        ],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        // A T1 entry exists (maybe backfilled in error), but student wasn't enrolled
        // for T1 → the coverage override must null it and mark is_na=true.
        grade_entries: makeGradeEntries([80, 90, 88, 85]),
        'attendance_records:presence': [
          { term_id: 't2', days_present: 60, days_late: 1 },
        ],
        'attendance_records:school_days': [{ term_id: 't2', school_days: 70 }],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const t1 = result.payload.subjects[0].t1;
      expect(t1.is_na).toBe(true);
      expect(t1.quarterly).toBeNull();
    });

    it('T2–T4 are enrolled normally when enrollment_date is in T2', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [
          makeEnrolment({
            enrollment_date: '2026-04-07',
            enrollment_status: 'late_enrollee',
          }),
        ],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([80, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // T2/T3/T4: enrolled → is_na = false (the stored grade passes through)
      expect(result.payload.subjects[0].t2.is_na).toBe(false);
      expect(result.payload.subjects[0].t2.quarterly).toBe(90);
    });
  });

  describe('KD #49 — FCA comment from evaluation_writeups', () => {
    it('comment text and term_id appear in payload.comments', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [
          {
            term_id: 't1',
            writeup: 'Juan consistently demonstrates intellectual curiosity.',
          },
          {
            term_id: 't2',
            writeup: 'Juan shows strong character and diligence.',
          },
        ],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const comments = result.payload.comments;
      expect(comments).toHaveLength(2);
      const t1Comment = comments.find((c) => c.term_id === 't1');
      expect(t1Comment?.comment).toBe(
        'Juan consistently demonstrates intellectual curiosity.'
      );
      const t2Comment = comments.find((c) => c.term_id === 't2');
      expect(t2Comment?.comment).toBe(
        'Juan shows strong character and diligence.'
      );
    });

    it('null/missing writeups pass through as null comment', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [{ term_id: 't1', writeup: null }],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const t1Comment = result.payload.comments.find((c) => c.term_id === 't1');
      expect(t1Comment?.comment).toBeNull();
    });
  });

  describe('Form class adviser — resolved from teacher_assignments, not the sections mirror', () => {
    it('reads the LIVE teacher_assignments row, ignoring a stale sections.form_class_adviser value', async () => {
      // Seed the two sources with DIFFERENT names on purpose — if the fix
      // regresses to reading the denormalized mirror, this assertion catches
      // it immediately (dual-source drift, KD publish-readiness.ts pattern).
      const staleSection = {
        ...SECTION,
        form_class_adviser: 'Old Adviser Name',
      };
      getStaffDisplayNameByIdMock.mockResolvedValueOnce([
        ['user-adviser-1', 'Current Adviser Name'],
      ]);
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [{ ...makeEnrolment(), section: staleSection }],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
        teacher_assignments: [{ teacher_user_id: 'user-adviser-1' }],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.section.form_class_adviser).toBe(
        'Current Adviser Name'
      );
    });

    it('is null when no teacher_assignments row exists for the section, even if the stale mirror has a name', async () => {
      const staleSection = {
        ...SECTION,
        form_class_adviser: 'Old Adviser Name',
      };
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [{ ...makeEnrolment(), section: staleSection }],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
        teacher_assignments: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.section.form_class_adviser).toBeNull();
    });
  });

  describe('subject_report_map wiring — end-to-end fan-in', () => {
    it('folds two mapped subjects into one merged row using the mapper with real grade data', async () => {
      const filSheets = TERMS.map((t) => ({
        id: `sheet-fil-${t.id}`,
        term_id: t.id,
        subject_id: SUBJECT_FILIPINO.id,
        section_id: SECTION.id,
      }));
      const manSheets = TERMS.map((t) => ({
        id: `sheet-man-${t.id}`,
        term_id: t.id,
        subject_id: SUBJECT_MANDARIN.id,
        section_id: SECTION.id,
      }));

      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        // Both fanned-in subjects are offered/graded this level. The
        // target ("Mother Tongue") is deliberately NOT in this list — per
        // the design, a pure fan-in target is never itself offered, only
        // ever a display column other subjects report into.
        subject_level_offerings: [
          { subject: SUBJECT_FILIPINO },
          { subject: SUBJECT_MANDARIN },
        ],
        grading_sheets: [...filSheets, ...manSheets],
        grade_entries: [
          // Filipino has a real T1 grade; Mandarin has none at all (no
          // entry row) — proves source-selection picks the mapper with
          // data, not just the first in the group.
          {
            id: 'ge-fil-t1',
            grading_sheet_id: filSheets[0].id,
            section_student_id: 'ss-1',
            quarterly_grade: 92,
            letter_grade: null,
            is_na: false,
            annual_letter_grade: null,
          },
        ],
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
        subject_report_map: [
          {
            subject_id: SUBJECT_FILIPINO.id,
            report_subject_id: SUBJECT_MOTHER_TONGUE_TARGET.id,
          },
          {
            subject_id: SUBJECT_MANDARIN.id,
            report_subject_id: SUBJECT_MOTHER_TONGUE_TARGET.id,
          },
        ],
        subjects: [SUBJECT_MOTHER_TONGUE_TARGET],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Two graded subjects fold into exactly one report-card row.
      expect(result.payload.subjects).toHaveLength(1);
      const merged = result.payload.subjects[0];
      expect(merged.subject).toEqual({
        id: SUBJECT_MOTHER_TONGUE_TARGET.id,
        code: SUBJECT_MOTHER_TONGUE_TARGET.code,
        name: 'Mother Tongue (Filipino)',
        is_examinable: false,
      });
      // Filipino's T1 data passed through onto the merged row unchanged.
      expect(merged.t1.quarterly).toBe(92);
      expect(merged.t1.letter).toBe('A'); // numericToLetter(92) — non-examinable derived letter
    });

    it('is a no-op when every subject self-maps (the current production shape)', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [makeEnrolment()],
        subject_level_offerings: [{ subject: SUBJECT_MATH }],
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        'attendance_records:presence': [],
        'attendance_records:school_days': [],
        evaluation_writeups: [],
        subject_report_map: [
          { subject_id: SUBJECT_MATH.id, report_subject_id: SUBJECT_MATH.id },
        ],
        subjects: [SUBJECT_MATH],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.payload.subjects).toHaveLength(1);
      expect(result.payload.subjects[0].subject).toEqual(SUBJECT_MATH);
      expect(result.payload.subjects[0].t1.quarterly).toBe(93);
    });
  });

  describe('error cases', () => {
    it('returns student_not_found when students table is empty', async () => {
      const supabase = makeClient({ students: [] });
      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('student_not_found');
    });

    it('returns no_current_ay when academic_years returns nothing', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [],
      });
      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('no_current_ay');
    });

    it('returns not_enrolled_this_ay when no section_students rows belong to the current AY', async () => {
      const supabase = makeClient({
        students: [
          {
            id: STUDENT_ID,
            student_number: 'SN-001',
            last_name: 'Dela Cruz',
            first_name: 'Juan',
            middle_name: null,
          },
        ],
        academic_years: [{ id: 'ay-1', label: 'AY2026' }],
        terms: TERMS,
        section_students: [
          {
            ...makeEnrolment(),
            // Section belongs to a DIFFERENT AY → filtered out by ayEnrolments
            section: { ...SECTION, academic_year_id: 'ay-other' },
          },
        ],
      });
      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('not_enrolled_this_ay');
    });
  });
});
