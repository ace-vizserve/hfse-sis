import type { SupabaseClient } from '@supabase/supabase-js';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { isEmptyRichText } from '@/lib/rich-text';
import { subjectDisplayNamesForAy } from '@/lib/sis/subjects/display-names-for-ay';
import {
  isEnrolledForTerm,
  type EnrolmentInterval,
} from '@/lib/report-card/enrolment-coverage';
import {
  cumulativeCommentGaps,
  missingCommentStudents,
  rosterRequiredForTerm,
  type RosterStudent,
  type WriteupLite,
} from '@/lib/markbook/comment-completeness';

// ────────────────────────────────────────────────────────────────────────────
// Shared publish-readiness evaluator. Single source of truth for both the GET
// readiness route (per-row checklist display) and the POST publish mutation
// (hard-block enforcement + soft-gap override snapshot).
//
// HARD gates (block publish, not overridable):
//   • no_students          — the section has no active roster (vacuous-pass hole)
//   • no_grading_sheets    — no grading sheets for the term (vacuous-pass hole)
//   • no_form_adviser      — the section has no form class adviser assigned. The
//                            FCA is named on every report-card template (header +
//                            signature) and authors the T1–T3 comments, so a card
//                            with no adviser is never valid. All terms (incl. T4).
//   • comments_incomplete  — cumulative FCA comment + virtue gate (KD #49/#129/#138),
//                            interim terms only (T4 has no FCA block)
//
// SOFT gaps (overridable "publish anyway", now recorded on the publication row):
//   • sheets_unlocked      — grading sheets not locked
//   • attendance_incomplete — attendance not fully recorded
//   • grades_missing        — (T4) missing annual/quarterly grades
//   • nonexam_finals_missing — (T4) non-examinable Final letters missing
//   • letterhead_incomplete  — (T4) letterhead config incomplete
//
// Soft scope is the current term; comments stay cumulative (1..N) per KD #49.
// ────────────────────────────────────────────────────────────────────────────

export type PublishBlocker = { code: string; label: string; count?: number };

export type PublishReadiness = {
  grading_sheets: {
    total: number;
    locked: number;
    unlocked: { subject_name: string }[];
  };
  evaluations: {
    total_active: number;
    submitted: number;
    drafted: number;
    missing: { name: string; index: number | null }[];
  };
  attendance: {
    total_active: number;
    complete: number;
    missing: { name: string; index: number | null }[];
  };
  t4_readiness: {
    all_terms_locked: boolean;
    unlocked_terms: { term_number: number; subjects: string[] }[];
    missing_annual_grades: {
      student_name: string;
      subject_name: string;
      missing_terms: number[];
    }[];
    missing_annual_count: number;
    non_examinable_readiness: {
      missing: { student_name: string; subject_name: string }[];
      missing_count: number;
    };
    letterhead_readiness: { ok: boolean; missing_fields: string[] };
  } | null;
  comment_gate: {
    ok: boolean;
    required_through_term: number | null;
    gaps: {
      term_number: number;
      virtue_missing: boolean;
      missing: { name: string; index: number | null }[];
    }[];
  };
  // Whether the section has a form class adviser assigned (authoritative
  // `teacher_assignments` row, role='form_adviser'). false → `no_form_adviser`
  // hard blocker (all terms). The denormalized `sections.form_class_adviser`
  // display mirror is intentionally NOT used here — it can drift.
  form_adviser: { assigned: boolean };
  // Verdict (new):
  hardBlockers: PublishBlocker[];
  softGaps: PublishBlocker[];
  canPublish: boolean; // hardBlockers.length === 0
};

export type ReadinessError = { error: string; status: number };

/**
 * Compute the full publish-readiness detail + hard/soft verdict for a
 * (section, term). Pass a service client (bypasses RLS — caller is gated). On a
 * missing term returns `{ error, status }` so the route can map it directly.
 */
export async function computePublishReadiness(
  service: SupabaseClient,
  sectionId: string,
  termId: string
): Promise<PublishReadiness | ReadinessError> {
  // 1) Resolve term_number for T4 detection + end_date for per-term roster
  // correctness (KD #49/#120).
  const { data: rawTerm } = await service
    .from('terms')
    .select('id, term_number, academic_year_id, end_date')
    .eq('id', termId)
    .single();
  if (!rawTerm) {
    return { error: 'term not found', status: 404 };
  }
  const term = rawTerm as {
    id: string;
    term_number: number;
    academic_year_id: string;
    end_date: string | null;
  };
  const isT4 = term.term_number === 4;

  // 2+3+4) Active students, grading sheets, and the form-adviser assignment are
  // independent — fetch in parallel. The form adviser is the authoritative
  // `teacher_assignments` row (unique per section, role='form_adviser') — NOT the
  // denormalized `sections.form_class_adviser` mirror, which is best-effort and
  // can drift.
  const [{ data: enrolments }, { data: sheets }, { data: adviserRow }] =
    await Promise.all([
      service
        .from('section_students')
        .select(
          'id, index_number, enrollment_status, enrollment_date, student:students(id, last_name, first_name)'
        )
        .eq('section_id', sectionId)
        .in('enrollment_status', ENROLLED_STATUSES)
        .order('index_number'),
      service
        .from('grading_sheets')
        .select('id, is_locked, subject:subjects(id, name)')
        .eq('section_id', sectionId)
        .eq('term_id', termId),
      service
        .from('teacher_assignments')
        .select('id')
        .eq('section_id', sectionId)
        .eq('role', 'form_adviser')
        .maybeSingle(),
    ]);
  const hasFormAdviser = !!adviserRow;

  const activeStudents = (enrolments ?? []).map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const rawDate = (e.enrollment_date as string | null) ?? null;
    return {
      sectionStudentId: e.id,
      indexNumber: e.index_number,
      studentId: s?.id ?? null,
      name: s ? `${s.last_name}, ${s.first_name}` : '(unknown)',
      enrollmentDate: rawDate ? rawDate.slice(0, 10) : null,
    };
  });
  // The checklist names the sheets an adviser still has to deal with, so it
  // uses the name this academic year uses (migration 137) — telling somebody
  // "MAPEH is unlocked" when their screen says STAR is the whole failure this
  // pass exists to stop.
  const sheetSubjects = (sheets ?? [])
    .map((sh) => (Array.isArray(sh.subject) ? sh.subject[0] : sh.subject))
    .filter((s): s is { id: string; name: string } => !!s);
  const sheetSubjectNames = await subjectDisplayNamesForAy(
    service,
    term.academic_year_id,
    sheetSubjects
  );
  const sheetList = (sheets ?? []).map((sh) => {
    const subj = Array.isArray(sh.subject) ? sh.subject[0] : sh.subject;
    return {
      id: sh.id,
      is_locked: sh.is_locked,
      subject_name: subj
        ? (sheetSubjectNames.get(subj.id) ?? subj.name)
        : '(unknown)',
    };
  });
  const unlockedSheets = sheetList.filter((s) => !s.is_locked);

  // 4+5) Write-ups (T1–T3 only — T4 has no FCA comment block per KD #49, so
  // skip the check there) and attendance — fetch in parallel.
  const studentIds = activeStudents
    .map((s) => s.studentId)
    .filter((id): id is string => !!id);
  const sectionStudentIds = activeStudents.map((s) => s.sectionStudentId);

  const [{ data: writeupRows }, { data: attendanceRows }] = await Promise.all([
    !isT4 && studentIds.length > 0
      ? // Match by the section's current active roster (student_id), NOT the
        // write-up's denormalized section_id — that tag doesn't follow a
        // mid-year transfer (KD #67), so a transferred student's write-up would
        // be wrongly reported "missing" for their new section.
        service
          .from('evaluation_writeups')
          .select('student_id, writeup, submitted')
          .eq('term_id', termId)
          .in('student_id', studentIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sectionStudentIds.length > 0
      ? service
          .from('attendance_records')
          .select('section_student_id, school_days, days_present, days_late')
          .eq('term_id', termId)
          .in('section_student_id', sectionStudentIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const writeupsByStudent = new Map<string, WriteupLite>(
    (writeupRows ?? []).map((w) => [
      (w as WriteupLite).student_id,
      w as WriteupLite,
    ])
  );
  // Roster shape for the shared completeness helper (KD #120 — by student_id).
  const roster: RosterStudent[] = activeStudents.map((s) => ({
    sectionStudentId: s.sectionStudentId,
    studentId: s.studentId,
    indexNumber: s.indexNumber,
    name: s.name,
    enrollmentDate: s.enrollmentDate,
  }));
  // THIS-term advisory display. Restrict to the roster actually REQUIRED for
  // this term (KD #49/#120) — a late enrollee who joined after this term ended
  // could never have written its comment, so the hard gate excludes them via
  // rosterRequiredForTerm; the advisory must use the SAME roster or it would
  // falsely flag them "missing" and disagree with the block. T4 has no end_date
  // gating need (write-up check is skipped on T4 anyway).
  const requiredRosterForThis = rosterRequiredForTerm(roster, term.end_date);
  // "Missing" = submitted + non-empty missing (the same predicate the hard gate
  // enforces, so the checklist never disagrees with the block).
  const missingEvaluations = missingCommentStudents(
    requiredRosterForThis,
    (writeupRows ?? []) as WriteupLite[]
  );
  const submittedCount = requiredRosterForThis.filter((s) => {
    if (!s.studentId) return false;
    const w = writeupsByStudent.get(s.studentId);
    // Submitted AND non-empty — an emptied write-up is "missing", not submitted
    // (without this it double-counts as both missing and submitted, skewing drafted).
    //
    // ⚠ MUST ASK THE SAME QUESTION AS `missingCommentStudents` ABOVE, and the
    // question is about prose, not string length. The comment box stores HTML,
    // so an adviser who submits an empty one leaves `<p></p>` behind: counted
    // here as submitted while the line above counts them as missing, which is
    // the double-count this comment already warns about — and `drafted` is
    // `required − missing − submitted`, so it would go NEGATIVE on the
    // registrar's checklist.
    return w?.submitted === true && !isEmptyRichText(w.writeup);
  }).length;
  // Drafted = required − missing − submitted; over the same required roster so
  // it can never go negative.
  const draftedCount =
    requiredRosterForThis.length - missingEvaluations.length - submittedCount;

  const attendanceBySSId = new Map(
    (attendanceRows ?? []).map((a) => {
      const row = a as {
        section_student_id: string;
        school_days: number | null;
        days_present: number | null;
        days_late: number | null;
      };
      return [row.section_student_id, row];
    })
  );
  const missingAttendance = activeStudents.filter((s) => {
    const rec = attendanceBySSId.get(s.sectionStudentId);
    return (
      !rec ||
      rec.school_days == null ||
      rec.days_present == null ||
      rec.days_late == null
    );
  });

  // 6) T4-specific: all four terms locked + annual grades present
  let t4Readiness: PublishReadiness['t4_readiness'] = null;
  // Count of grading sheets across ALL four terms for this section (drives the
  // T4 "no grading sheets" vacuous-pass hard block — the masterfile spans the
  // whole AY, so a term-scoped count would falsely read empty).
  let t4AllSheetCount = 0;
  if (isT4) {
    const { data: allTerms } = await service
      .from('terms')
      .select('id, term_number, start_date, end_date')
      .eq('academic_year_id', term.academic_year_id)
      .order('term_number');
    const termIds = (allTerms ?? []).map((t) => t.id);
    // Term windows (date-only SGT strings, KD #32) — drive the KD #148
    // enrolment-coverage exemption in the missing-grades scan below. A term
    // without dated boundaries can't be coverage-checked and stays flagged.
    const termWindowByNumber = new Map<
      number,
      { start: string; end: string }
    >();
    for (const t of (allTerms ?? []) as Array<{
      term_number: number;
      start_date: string | null;
      end_date: string | null;
    }>) {
      if (t.start_date && t.end_date) {
        termWindowByNumber.set(t.term_number, {
          start: t.start_date.slice(0, 10),
          end: t.end_date.slice(0, 10),
        });
      }
    }

    // allSheets, grade entries, and school config are independent — fetch in parallel.
    type EntryRow = {
      section_student_id: string;
      quarterly_grade: number | null;
      letter_grade: string | null;
      is_na: boolean;
      annual_letter_grade: string | null;
      grading_sheet:
        | {
            id: string;
            term_id: string;
            subject: { id: string; name: string; is_examinable: boolean };
          }
        | {
            id: string;
            term_id: string;
            subject: { id: string; name: string; is_examinable: boolean };
          }[];
    };

    // Resolve every section_student_id these active students hold this AY —
    // across ALL sections, so a mid-year transfer's pre-transfer grades (which
    // live under the now-withdrawn old enrolment, KD #67) are counted, matching
    // build-report-card.ts. `grade_entries` has NO student_id column (Hard Rule
    // #6 — keyed by section_student_id), so query by enrolment id and map back.
    const [{ data: allSheets }, { data: ayEnrolmentRows }, schoolConfig] =
      await Promise.all([
        service
          .from('grading_sheets')
          .select(
            'id, term_id, is_locked, subject:subjects(id, name, is_examinable)'
          )
          .eq('section_id', sectionId)
          .in('term_id', termIds),
        studentIds.length > 0
          ? service
              .from('section_students')
              .select(
                'id, student_id, enrollment_date, withdrawal_date, section:sections!inner(academic_year_id)'
              )
              .in('student_id', studentIds)
              .eq('section.academic_year_id', term.academic_year_id)
          : Promise.resolve({ data: [] as unknown[] }),
        getSchoolConfig(),
      ]);

    const studentBySectionStudent = new Map<string, string>();
    // KD #148 — per-student enrolment coverage: the union of the student's
    // [enrollment_date, withdrawal_date] intervals across ALL their AY
    // enrolment rows (transfer-safe, KD #67; null start/end = open-ended).
    // A term entirely outside coverage renders N.A. on the report card at
    // RENDER time (build-report-card.ts) — it is never stored as is_na on any
    // entry — so the missing-grades scan must apply the same exemption or a
    // late enrollee false-flags "grades missing" for pre-join terms.
    const coverageByStudent = new Map<string, EnrolmentInterval[]>();
    for (const r of (ayEnrolmentRows ?? []) as Array<{
      id: string;
      student_id: string;
      enrollment_date: string | null;
      withdrawal_date: string | null;
    }>) {
      studentBySectionStudent.set(r.id, r.student_id);
      const intervals = coverageByStudent.get(r.student_id) ?? [];
      intervals.push({
        start: r.enrollment_date ? r.enrollment_date.slice(0, 10) : null,
        end: r.withdrawal_date ? r.withdrawal_date.slice(0, 10) : null,
      });
      coverageByStudent.set(r.student_id, intervals);
    }
    const allEnrolmentIds = Array.from(studentBySectionStudent.keys());

    // Paginate around PostgREST's 1000-row response cap (silent truncation) —
    // this read spans all four terms × every subject × every enrolment row the
    // roster holds this AY (a 40-student section × ~13 subjects × 4 terms is
    // ~2,080 rows), so a single query under-reports and the missing-grade /
    // non-exam-final checks read wrong.
    const rawEntries =
      allEnrolmentIds.length > 0
        ? await fetchAllPages((from, to) =>
            service
              .from('grade_entries')
              .select(
                'section_student_id, quarterly_grade, letter_grade, is_na, annual_letter_grade, grading_sheet:grading_sheets!inner(id, term_id, subject:subjects!inner(id, name, is_examinable))'
              )
              .in('section_student_id', allEnrolmentIds)
              .in('grading_sheet.term_id', termIds)
              .range(from, to)
          )
        : [];

    const entries = rawEntries as unknown as EntryRow[];

    t4AllSheetCount = (allSheets ?? []).length;

    const unlockedByTerm: { term_number: number; subjects: string[] }[] = [];
    for (const t of allTerms ?? []) {
      const termSheets = (allSheets ?? []).filter((s) => s.term_id === t.id);
      const unlocked = termSheets
        .filter((s) => !s.is_locked)
        .map((s) => {
          const subj = Array.isArray(s.subject) ? s.subject[0] : s.subject;
          return (subj as { name: string } | null)?.name ?? '(unknown)';
        });
      if (unlocked.length > 0) {
        unlockedByTerm.push({ term_number: t.term_number, subjects: unlocked });
      }
    }

    // Collect the subject sets for this section from the sheet list.
    //
    // These names are BOTH the key of the grade map below AND the words in the
    // "missing grades" list a person reads, so they resolve to the name this
    // academic year uses (migration 137). Resolving them everywhere from ONE
    // map, keyed by subject id, is what keeps the two roles in agreement — a
    // set built from renamed names and a map keyed on raw ones would report
    // every subject as missing every grade.
    const allSheetSubjects = (allSheets ?? [])
      .map((sh) => (Array.isArray(sh.subject) ? sh.subject[0] : sh.subject))
      .filter(
        (
          s
        ): s is {
          id: string;
          name: string;
          is_examinable: boolean;
        } => !!s
      );
    const annualSubjectNames = await subjectDisplayNamesForAy(
      service,
      term.academic_year_id,
      allSheetSubjects
    );
    const nameOfSubject = (s: { id: string; name: string }) =>
      annualSubjectNames.get(s.id) ?? s.name;

    const examinableSubjectNames = new Set<string>();
    const nonExaminableSubjectNames = new Set<string>();
    for (const s of allSheetSubjects) {
      if (s.is_examinable) {
        examinableSubjectNames.add(nameOfSubject(s));
      } else {
        nonExaminableSubjectNames.add(nameOfSubject(s));
      }
    }

    // Check for missing quarterly grades across all 4 terms (examinable only).
    // Build map: student × subject → [t1, t2, t3, t4] quarterly grades.
    // Fix: iterate activeStudents × examinableSubjectNames (not gradeMap.keys()) so
    // students with zero entry rows at all are caught and not silently skipped.
    type GradeCell = { q: number | null; na: boolean };
    const blankCells = (): GradeCell[] => [
      { q: null, na: false },
      { q: null, na: false },
      { q: null, na: false },
      { q: null, na: false },
    ];
    const gradeMap = new Map<string, Map<string, GradeCell[]>>();
    for (const e of entries) {
      const gs = Array.isArray(e.grading_sheet)
        ? e.grading_sheet[0]
        : e.grading_sheet;
      if (!gs) continue;
      const subj = Array.isArray(gs.subject) ? gs.subject[0] : gs.subject;
      if (!subj?.is_examinable) continue;
      const termObj = (allTerms ?? []).find((t) => t.id === gs.term_id);
      if (!termObj) continue;

      const studentKey = studentBySectionStudent.get(e.section_student_id);
      if (!studentKey) continue;
      const subjKey = nameOfSubject(subj);
      if (!gradeMap.has(studentKey)) gradeMap.set(studentKey, new Map());
      const subjMap = gradeMap.get(studentKey)!;
      if (!subjMap.has(subjKey)) subjMap.set(subjKey, blankCells());
      const idx = termObj.term_number - 1;
      const cell = subjMap.get(subjKey)![idx];
      // A transferred student can hold an entry for the same (subject, term) in
      // two sections — keep whichever has data (graded or NA) over a blank.
      const newHasData = e.quarterly_grade != null || e.is_na;
      const oldHasData = cell.q != null || cell.na;
      if (newHasData || !oldHasData) {
        subjMap.get(subjKey)![idx] = { q: e.quarterly_grade, na: e.is_na };
      }
    }

    const missingAnnual: {
      student_name: string;
      subject_name: string;
      missing_terms: number[];
    }[] = [];
    for (const s of activeStudents) {
      if (!s.studentId) continue;
      const coverage = coverageByStudent.get(s.studentId) ?? [];
      for (const subjName of examinableSubjectNames) {
        const grades = gradeMap.get(s.studentId)?.get(subjName) ?? blankCells();
        // An N/A term (late enrollee) has a null quarterly but is excluded
        // from computeAnnualGrade — so it is NOT a missing grade. Same for a
        // term outside the student's enrolment coverage (KD #148): the card
        // renders it N.A. and prorates the annual over enrolled terms only.
        // Undated terms / missing coverage rows keep flagging (conservative).
        const missing = grades
          .map((c, i) => {
            if (c.q != null || c.na) return null;
            const win = termWindowByNumber.get(i + 1);
            if (
              win &&
              coverage.length > 0 &&
              !isEnrolledForTerm(coverage, win.start, win.end)
            ) {
              return null; // not enrolled this term → N.A., not missing
            }
            return i + 1;
          })
          .filter((t): t is number => t !== null);
        if (missing.length > 0) {
          missingAnnual.push({
            student_name: s.name,
            subject_name: subjName,
            missing_terms: missing,
          });
        }
      }
    }

    // Check non-examinable subjects: the T4 entry must have annual_letter_grade
    // set (KD #100). This is the registrar-confirmed Final Grade that appears
    // in the Final column on the published report card. N/A rows (is_na=true)
    // are exempt — they have no Final Grade by definition.
    type NonExamKey = string; // `${studentId}::${subjName}`
    const t4TermId = (allTerms ?? []).find((t) => t.term_number === 4)?.id;
    const nonExamHasAnnualGrade = new Map<NonExamKey, boolean>();
    for (const e of entries) {
      const gs = Array.isArray(e.grading_sheet)
        ? e.grading_sheet[0]
        : e.grading_sheet;
      if (!gs || gs.term_id !== t4TermId) continue;
      const subj = Array.isArray(gs.subject) ? gs.subject[0] : gs.subject;
      if (!subj || subj.is_examinable) continue;
      const studentKey = studentBySectionStudent.get(e.section_student_id);
      if (!studentKey) continue;
      // Resolved, matching nonExaminableSubjectNames above — the two halves of
      // this key have to be built the same way or every non-examinable subject
      // reads as missing its Final Grade.
      const key: NonExamKey = `${studentKey}::${nameOfSubject(subj)}`;
      const hasGrade =
        e.is_na === true ||
        (e.annual_letter_grade !== null && e.annual_letter_grade.trim() !== '');
      // OR across the student's enrolments — a confirmed grade anywhere counts.
      nonExamHasAnnualGrade.set(
        key,
        (nonExamHasAnnualGrade.get(key) ?? false) || hasGrade
      );
    }

    const missingNonExam: { student_name: string; subject_name: string }[] = [];
    for (const s of activeStudents) {
      if (!s.studentId) continue;
      for (const subjName of nonExaminableSubjectNames) {
        const key: NonExamKey = `${s.studentId}::${subjName}`;
        if (!nonExamHasAnnualGrade.get(key)) {
          missingNonExam.push({ student_name: s.name, subject_name: subjName });
        }
      }
    }

    // Letterhead: principalName, ceoName, peiRegistrationNumber must all be non-empty
    // (KD #101). Empty values produce blank signature lines on the T4 final card.
    const letterheadMissing: string[] = [];
    if (!schoolConfig.principalName.trim())
      letterheadMissing.push('Principal name');
    if (!schoolConfig.ceoName.trim())
      letterheadMissing.push('CEO / Founder name');
    if (!schoolConfig.peiRegistrationNumber.trim())
      letterheadMissing.push('PEI registration number');

    t4Readiness = {
      all_terms_locked: unlockedByTerm.length === 0,
      unlocked_terms: unlockedByTerm,
      missing_annual_grades: missingAnnual.slice(0, 20),
      missing_annual_count: missingAnnual.length,
      non_examinable_readiness: {
        missing: missingNonExam.slice(0, 20),
        missing_count: missingNonExam.length,
      },
      letterhead_readiness: {
        ok: letterheadMissing.length === 0,
        missing_fields: letterheadMissing,
      },
    };
  }

  // CUMULATIVE comment hard-gate (KD #49 + #120). A published interim card for
  // term N shows the FCA comment boxes for terms 1..N — so publishing N is
  // HARD-blocked until comments are done for EVERY term 1..N (roster-correct
  // per term; never future terms; T4 exempt). Virtue theme is included: a term
  // without a virtue theme is also a gap (the comment-box heading would render
  // without its HFSE-Virtues framing). This mirrors exactly what the publish
  // mutation enforces server-side (same shared helper) so the checklist and the
  // block can't drift.
  let commentGate: PublishReadiness['comment_gate'] = {
    ok: true,
    required_through_term: null,
    gaps: [],
  };
  if (!isT4) {
    const { data: ayTerms } = await service
      .from('terms')
      .select('id, term_number, end_date, virtue_theme')
      .eq('academic_year_id', term.academic_year_id)
      .order('term_number');
    const cumulativeGaps = await cumulativeCommentGaps(
      service,
      sectionId,
      (ayTerms ?? []) as {
        id: string;
        term_number: number;
        end_date: string | null;
        virtue_theme: string | null;
      }[],
      term.term_number,
      // The roster this function already loaded, rather than a second
      // independent read. See `cumulativeCommentGaps` — that second read
      // discarded its error, and a failure turned the comment hard gate into
      // a vacuous pass.
      roster
    );
    commentGate = {
      ok: cumulativeGaps.length === 0,
      required_through_term: Math.min(term.term_number, 3),
      gaps: cumulativeGaps.map((g) => ({
        term_number: g.termNumber,
        virtue_missing: g.virtueMissing,
        missing: g.missing
          .slice(0, 20)
          .map((m) => ({ name: m.name, index: m.indexNumber })),
      })),
    };
  }

  const detail: Omit<
    PublishReadiness,
    'hardBlockers' | 'softGaps' | 'canPublish'
  > = {
    grading_sheets: {
      total: sheetList.length,
      locked: sheetList.length - unlockedSheets.length,
      unlocked: unlockedSheets.map((s) => ({ subject_name: s.subject_name })),
    },
    // Adviser-comment readiness (KD #49) — sourced from `evaluation_writeups`
    // since migration 024 retired `report_card_comments`. T1–T3 only: the T4
    // final card has no FCA comment block, so report it as nothing-to-do.
    evaluations: isT4
      ? {
          total_active: activeStudents.length,
          submitted: 0,
          drafted: 0,
          missing: [] as { name: string; index: number | null }[],
        }
      : {
          // Total over the term-required roster so submitted + drafted + missing
          // reconcile (late enrollees who joined after this term are excluded,
          // matching the hard gate).
          total_active: requiredRosterForThis.length,
          submitted: submittedCount,
          drafted: draftedCount,
          missing: missingEvaluations.map((s) => ({
            name: s.name,
            index: s.indexNumber,
          })),
        },
    attendance: {
      total_active: activeStudents.length,
      complete: activeStudents.length - missingAttendance.length,
      missing: missingAttendance.map((s) => ({
        name: s.name,
        index: s.indexNumber,
      })),
    },
    t4_readiness: t4Readiness,
    // HARD gate: cumulative comment completeness for terms 1..N (KD #49/#120).
    // virtue_readiness is subsumed here — a term with no virtue theme is a gap.
    comment_gate: commentGate,
    form_adviser: { assigned: hasFormAdviser },
  };

  // ── Derive the hard/soft verdict from the computed detail ─────────────────
  const hardBlockers: PublishBlocker[] = [];
  const softGaps: PublishBlocker[] = [];

  // HARD — vacuous-pass holes: an empty section or a section with no grading
  // sheets currently passes every "0 missing" check and would publish an empty
  // window. Block both.
  if (activeStudents.length === 0) {
    hardBlockers.push({
      code: 'no_students',
      label: 'Section has no students',
    });
  }
  // Interim: the term's own grading-sheet list. T4: the masterfile draws on all
  // four terms, so "no grading sheets" means none across the AY for this
  // section — track that as we accumulate the per-term sheet sets.
  const gradingSheetsPresent = isT4
    ? t4AllSheetCount > 0
    : sheetList.length > 0;
  if (!gradingSheetsPresent) {
    hardBlockers.push({
      code: 'no_grading_sheets',
      label: isT4
        ? 'No grading sheets found for this section'
        : 'No grading sheets for this term',
    });
  }
  // HARD — no form class adviser assigned (all terms). The FCA is named on every
  // report-card template + signature and authors the interim comments, so a card
  // with no adviser is never valid. One boolean per section, no false-positive
  // risk (same safety rationale as the virtue hard gate, KD #138).
  if (!hasFormAdviser) {
    hardBlockers.push({
      code: 'no_form_adviser',
      label: 'No form class adviser assigned',
    });
  }

  // HARD — cumulative comment + virtue gate (interim only; T4 has no FCA block).
  if (!isT4 && !commentGate.ok) {
    hardBlockers.push({
      code: 'comments_incomplete',
      label: 'Adviser comments / virtue theme incomplete',
    });
  }

  // SOFT — grading sheets not locked.
  if (isT4) {
    if (t4Readiness && !t4Readiness.all_terms_locked) {
      softGaps.push({
        code: 'sheets_unlocked',
        label: 'Grading sheets not locked',
      });
    }
  } else if (unlockedSheets.length > 0) {
    softGaps.push({
      code: 'sheets_unlocked',
      label: 'Grading sheets not locked',
      count: unlockedSheets.length,
    });
  }

  // SOFT — attendance incomplete.
  if (missingAttendance.length > 0) {
    softGaps.push({
      code: 'attendance_incomplete',
      label: 'Attendance incomplete',
      count: missingAttendance.length,
    });
  }

  // SOFT — T4-only grade/non-exam/letterhead gaps.
  if (isT4 && t4Readiness) {
    if (t4Readiness.missing_annual_count > 0) {
      softGaps.push({
        code: 'grades_missing',
        label: 'Annual grades missing',
        count: t4Readiness.missing_annual_count,
      });
    }
    if (t4Readiness.non_examinable_readiness.missing_count > 0) {
      softGaps.push({
        code: 'nonexam_finals_missing',
        label: 'Non-examinable Final grades missing',
        count: t4Readiness.non_examinable_readiness.missing_count,
      });
    }
    if (!t4Readiness.letterhead_readiness.ok) {
      softGaps.push({
        code: 'letterhead_incomplete',
        label: 'Letterhead details incomplete',
      });
    }
  }

  return {
    ...detail,
    hardBlockers,
    softGaps,
    canPublish: hardBlockers.length === 0,
  };
}
