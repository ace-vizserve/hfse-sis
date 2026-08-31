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
 *   5. "Which subjects appear" is section-membership, via section_subjects
 *      (not the level-wide subject_level_offerings) — the student's actual
 *      section's attached subjects, deduped across transferred sections.
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
  // recordedSchoolDaysByTerm, the `school_days` half of the attendance read.
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
 * Apply a flat `.select('a, b, c')` projection to one seeded row, the way
 * PostgREST would. Only flat column lists appear in the attendance reads, so
 * embeds/aliases are deliberately not handled — an unrecognised select string
 * would silently return `{}`, which is why the caller restricts this to
 * `attendance_records`.
 */
function projectRow(row: Record<string, unknown>, sel: string) {
  const cols = sel
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (cols.length === 0) return row;
  const out: Record<string, unknown> = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

/**
 * Build a minimal chainable fake. All filter methods (.eq / .in / .order /
 * .neq) return `this` so they chain. `.single()` resolves with the first row.
 * The chain itself is Thenable (`.then`) so `await chain` resolves with
 * `{ data: rows }` — needed for queries that don't end with `.single()`.
 *
 * `attendance_records` is seeded ONCE, as whole rows, and the fake applies the
 * `.select()` projection itself (`projectRow` above). That mirrors the real
 * database — where both of this file's historical attendance reads hit the SAME
 * rows under byte-identical filters and differ only in which columns come back
 * — and it is what makes the read count invisible to these tests: whether
 * build-report-card issues one query for
 * `term_id, days_present, days_late, school_days` or two narrower ones, the
 * values it sees are identical. See the subset-equivalence test at the bottom
 * of this file.
 */
function makeClient(tables: {
  students?: unknown[];
  academic_years?: unknown[];
  terms?: unknown[];
  section_students?: unknown[];
  // "Which subjects appear on this card" is a section-membership question
  // (build-report-card.ts queries section_subjects → subject_configs →
  // subjects), not a level one — subject_level_offerings is no longer
  // queried by that file at all. Each row: { subject_config: { subject } }.
  section_subjects?: unknown[];
  grading_sheets?: unknown[];
  grade_entries?: unknown[];
  // Whole rows — { term_id, days_present, days_late, school_days }. The fake
  // projects them per the caller's `.select()` string.
  attendance_records?: unknown[];
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
        let rows = (tables[table as keyof typeof tables] ?? []) as unknown[];
        if (table === 'attendance_records') {
          rows = rows.map((r) => projectRow(r as Record<string, unknown>, sel));
        }
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
  report_label: null,
  // The per-year name (migration 137). Null here because the stub below
  // returns no subject_configs.display_name — the ordinary case, where a year
  // never renamed the subject and the catalogue name stands.
  display_name: null,
  is_examinable: true,
};

// subject_report_map fan-in fixtures — two graded subjects that both fold
// into a shared display target. This is the ONLY existing fixture pair
// (SUBJECT_MATH) can't express, since it's a single self-mapped subject.
const SUBJECT_FILIPINO = {
  id: 'sub-fil',
  code: 'FIL',
  name: 'Filipino',
  report_label: null,
  is_examinable: false,
};
const SUBJECT_MANDARIN = {
  id: 'sub-man',
  code: 'MAN',
  name: 'Mandarin',
  report_label: null,
  is_examinable: false,
};
const SUBJECT_MOTHER_TONGUE_TARGET = {
  id: 'sub-mt',
  code: 'MT',
  name: 'Mother Tongue',
  report_label: null,
  is_examinable: false,
};

/** section_subjects fixture rows — { subject_config: { subject } } shape. */
function sectionSubjectRows(...subjects: unknown[]) {
  return subjects.map((subject) => ({ subject_config: { subject } }));
}

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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        // Hard Rule #1: quarterly for T1 = 93 (already computed + stored by the
        // server when the teacher saved scores; this test proves the card reads the
        // stored value unchanged, not a re-derivation).
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [
          { term_id: 't1', days_present: 70, days_late: 2, school_days: 75 },
        ],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        // A T1 entry exists (maybe backfilled in error), but student wasn't enrolled
        // for T1 → the coverage override must null it and mark is_na=true.
        grade_entries: makeGradeEntries([80, 90, 88, 85]),
        attendance_records: [
          { term_id: 't2', days_present: 60, days_late: 1, school_days: 70 },
        ],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([80, 90, 88, 85]),
        attendance_records: [],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
        // `submitted: true` is explicit. The builder now carries the flag
        // through, and the parent API + batch print drop an unsubmitted
        // write-up — so without it these two would be drafts and the
        // assertions below would no longer certify what they read as
        // certifying (`submitted` defaults to false in the DB too).
        evaluation_writeups: [
          {
            term_id: 't1',
            writeup: 'Juan consistently demonstrates intellectual curiosity.',
            submitted: true,
          },
          {
            term_id: 't2',
            writeup: 'Juan shows strong character and diligence.',
            submitted: true,
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
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

  describe('section_subjects scoping — report card subjects follow the section, not the level', () => {
    it('a subject offered at the level but NOT attached to this section is excluded', async () => {
      const otherSubject = {
        id: 'sub-other',
        code: 'OTHER',
        name: 'Not Attached Here',
        report_label: null,
        is_examinable: true,
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
        section_students: [makeEnrolment()],
        // Only MATH is attached via section_subjects — otherSubject would
        // have shown up under the old level-wide query, but must not here.
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.subjects).toHaveLength(1);
      expect(result.payload.subjects[0].subject.id).toBe(SUBJECT_MATH.id);
      expect(
        result.payload.subjects.some((s) => s.subject.id === otherSubject.id)
      ).toBe(false);
    });

    it('carries a subject-level report_label through as its own field, without touching name', async () => {
      const relabeled = {
        id: 'sub-relabeled',
        code: 'MAPEH',
        name: 'MAPEH',
        report_label: 'STAR',
        is_examinable: false,
      };
      const relabeledSheets = TERMS.map((t) => ({
        id: `sheet-relabeled-${t.id}`,
        term_id: t.id,
        subject_id: relabeled.id,
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
        section_subjects: sectionSubjectRows(relabeled),
        grading_sheets: relabeledSheets,
        grade_entries: [
          {
            id: 'ge-relabeled-t1',
            grading_sheet_id: relabeledSheets[0].id,
            section_student_id: 'ss-1',
            quarterly_grade: null,
            letter_grade: 'A',
            is_na: false,
            annual_letter_grade: null,
          },
        ],
        attendance_records: [],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = result.payload.subjects[0];
      // name stays the real catalog name — report_label carried separately.
      expect(row.subject.name).toBe('MAPEH');
      expect(row.subject.report_label).toBe('STAR');
    });

    it("dedupes a subject shared across a transferred student's old + new sections", async () => {
      const newSection = { ...SECTION, id: 'sec-2', name: 'P1 Diligence' };
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
            id: 'ss-1',
            enrollment_status: 'withdrawn',
            withdrawal_date: '2026-04-06',
          },
          {
            ...makeEnrolment(),
            id: 'ss-2',
            section: newSection,
            enrollment_date: '2026-04-07',
          },
        ],
        // Both the old + new section attach the same MATH subject — must
        // collapse to exactly one report-card row, not two.
        section_subjects: sectionSubjectRows(SUBJECT_MATH, SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.subjects).toHaveLength(1);
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
        // Both fanned-in subjects are attached to this section. The target
        // ("Mother Tongue") is deliberately NOT in this list — per the
        // design, a pure fan-in target is never itself attached, only ever
        // a display column other subjects report into.
        section_subjects: sectionSubjectRows(
          SUBJECT_FILIPINO,
          SUBJECT_MANDARIN
        ),
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
        attendance_records: [],
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
        report_label: null,
        // Both overrides are deliberately null on a merged row: the composed
        // "{Target} ({Source})" string above already IS the final display
        // text, and leaving either populated would let the renderer
        // re-substitute over it. See resolveReportSubjects.
        display_name: null,
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: [],
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

  // ── Subset-equivalence: one attendance read, or two, must not matter ──────
  //
  // build-report-card historically issued TWO `attendance_records` reads with
  // byte-identical filters (`.in(section_student_id, allEnrolmentIds)` +
  // `.in(term_id, termList)`), one projecting `days_present, days_late` and one
  // projecting `school_days`. Because the filters are identical, the second
  // read's rows are the SAME rows as the first's — so `school_days` can be
  // carried on the first read's projection and the fallback map derived from
  // it, with no change to a single output value.
  //
  // This test pins that. It seeds whole rows once, lets the fake apply the
  // projection (so it is faithful whichever way production asks), and builds
  // the expectation by reducing the SEEDED rows — i.e. the map a merged read
  // derives — then asserts the payload matches. It was written and run GREEN
  // against the two-read version before the reads were merged, so a pass here
  // means both shapes agree, not merely that the merged shape is self-consistent.
  describe('attendance reads — merged projection equals the separate fetches', () => {
    // Two rows for T1 (a transferred student's pre- and post-transfer enrolment
    // rows both land in the same `.in()`) so the summing branch is exercised,
    // plus a single-row T2 and a term with no row at all.
    const SEEDED = [
      { term_id: 't1', days_present: 40, days_late: 1, school_days: 45 },
      { term_id: 't1', days_present: 30, days_late: 1, school_days: 30 },
      { term_id: 't2', days_present: 60, days_late: 0, school_days: 70 },
    ];

    it('payload.attendance carries the values a single merged read would derive', async () => {
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
        section_subjects: sectionSubjectRows(SUBJECT_MATH),
        grading_sheets: SHEETS,
        grade_entries: makeGradeEntries([93, 90, 88, 85]),
        attendance_records: SEEDED,
        evaluation_writeups: [],
      });

      const result = await buildReportCard(
        supabase as unknown as SupabaseClient,
        STUDENT_ID
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Derive both maps from the one seeded row set — this is exactly what a
      // merged `select('term_id, days_present, days_late, school_days')`
      // returns, and what the second fetch used to return separately.
      const derivedPresence = new Map<
        string,
        { days_present: number | null; days_late: number | null }
      >();
      const derivedSchoolDays = new Map<string, number>();
      for (const r of SEEDED) {
        const cur = derivedPresence.get(r.term_id);
        derivedPresence.set(r.term_id, {
          days_present: (cur?.days_present ?? 0) + r.days_present,
          days_late: (cur?.days_late ?? 0) + r.days_late,
        });
        derivedSchoolDays.set(
          r.term_id,
          (derivedSchoolDays.get(r.term_id) ?? 0) + r.school_days
        );
      }

      // getEncodableDatesForTerm is mocked to [] file-wide, so every term takes
      // the "calendar unconfigured" fallback — the ONLY consumer of the
      // school_days map, and therefore the branch that would break first if the
      // merged read stopped agreeing with the separate one.
      const expected = TERMS.map((t) => ({
        term_id: t.id,
        school_days: derivedSchoolDays.get(t.id) ?? null,
        days_present: derivedPresence.get(t.id)?.days_present ?? null,
        days_late: derivedPresence.get(t.id)?.days_late ?? null,
      }));

      expect(result.payload.attendance).toEqual(expected);
      // Spelled out so a future reader sees the real numbers, not just the
      // reduction: T1 sums two rows, T2 has one, T3/T4 have none.
      expect(result.payload.attendance).toEqual([
        { term_id: 't1', school_days: 75, days_present: 70, days_late: 2 },
        { term_id: 't2', school_days: 70, days_present: 60, days_late: 0 },
        {
          term_id: 't3',
          school_days: null,
          days_present: null,
          days_late: null,
        },
        {
          term_id: 't4',
          school_days: null,
          days_present: null,
          days_late: null,
        },
      ]);
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
