import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { getSchoolConfig } from '@/lib/sis/school-config';
import {
  cumulativeCommentGaps,
  missingCommentStudents,
  rosterRequiredForTerm,
  type RosterStudent,
  type WriteupLite,
} from '@/lib/markbook/comment-completeness';

// GET /api/sections/[id]/publish-readiness?term_id=...
// Returns checklist data for the pre-publish completeness check.
// Registrar+ only.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const termId = request.nextUrl.searchParams.get('term_id');
  if (!termId) {
    return NextResponse.json({ error: 'term_id is required' }, { status: 400 });
  }

  const service = createServiceClient();

  // 1) Resolve term_number + virtue_theme for T4 detection and virtue check (KD #49).
  const { data: rawTerm } = await service
    .from('terms')
    .select('id, term_number, academic_year_id, virtue_theme, end_date')
    .eq('id', termId)
    .single();
  if (!rawTerm) {
    return NextResponse.json({ error: 'term not found' }, { status: 404 });
  }
  const term = rawTerm as {
    id: string;
    term_number: number;
    academic_year_id: string;
    virtue_theme: string | null;
    end_date: string | null;
  };
  const isT4 = term.term_number === 4;

  // 2+3) Active students and grading sheets are independent — fetch in parallel.
  const [{ data: enrolments }, { data: sheets }] = await Promise.all([
    service
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, enrollment_date, student:students(id, student_number, last_name, first_name)'
      )
      .eq('section_id', sectionId)
      .in('enrollment_status', ['active', 'late_enrollee'])
      .order('index_number'),
    service
      .from('grading_sheets')
      .select('id, is_locked, subject:subjects(id, name)')
      .eq('section_id', sectionId)
      .eq('term_id', termId),
  ]);

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
  const sheetList = (sheets ?? []).map((sh) => {
    const subj = Array.isArray(sh.subject) ? sh.subject[0] : sh.subject;
    return {
      id: sh.id,
      is_locked: sh.is_locked,
      subject_name: subj?.name ?? '(unknown)',
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
    return w?.submitted === true && !!w.writeup && w.writeup.trim().length > 0;
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
  let t4Readiness = null;
  if (isT4) {
    const { data: allTerms } = await service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', term.academic_year_id)
      .order('term_number');
    const termIds = (allTerms ?? []).map((t) => t.id);

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
                'id, student_id, section:sections!inner(academic_year_id)'
              )
              .in('student_id', studentIds)
              .eq('section.academic_year_id', term.academic_year_id)
          : Promise.resolve({ data: [] as unknown[] }),
        getSchoolConfig(),
      ]);

    const studentBySectionStudent = new Map<string, string>();
    for (const r of (ayEnrolmentRows ?? []) as Array<{
      id: string;
      student_id: string;
    }>) {
      studentBySectionStudent.set(r.id, r.student_id);
    }
    const allEnrolmentIds = Array.from(studentBySectionStudent.keys());

    const { data: rawEntries } =
      allEnrolmentIds.length > 0
        ? await service
            .from('grade_entries')
            .select(
              'section_student_id, quarterly_grade, letter_grade, is_na, annual_letter_grade, grading_sheet:grading_sheets!inner(id, term_id, subject:subjects!inner(id, name, is_examinable))'
            )
            .in('section_student_id', allEnrolmentIds)
            .in('grading_sheet.term_id', termIds)
        : { data: [] };

    const entries = (rawEntries ?? []) as unknown as EntryRow[];

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
    const examinableSubjectNames = new Set<string>();
    const nonExaminableSubjectNames = new Set<string>();
    for (const sh of allSheets ?? []) {
      const subj = Array.isArray(sh.subject) ? sh.subject[0] : sh.subject;
      if (!subj) continue;
      const s = subj as { name: string; is_examinable: boolean };
      if (s.is_examinable) {
        examinableSubjectNames.add(s.name);
      } else {
        nonExaminableSubjectNames.add(s.name);
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
      const subjKey = subj.name;
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
      for (const subjName of examinableSubjectNames) {
        const grades = gradeMap.get(s.studentId)?.get(subjName) ?? blankCells();
        // An N/A term (late enrollee) has a null quarterly but is excluded
        // from computeAnnualGrade — so it is NOT a missing grade.
        const missing = grades
          .map((c, i) => (c.q == null && !c.na ? i + 1 : null))
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
      const key: NonExamKey = `${studentKey}::${subj.name}`;
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
  // per term; never future terms; T4 exempt). This mirrors exactly what the
  // publish mutation enforces server-side (same shared helper) so the checklist
  // and the block can't drift.
  let commentGate: {
    ok: boolean;
    required_through_term: number | null;
    gaps: {
      term_number: number;
      missing: { name: string; index: number | null }[];
    }[];
  } = { ok: true, required_through_term: null, gaps: [] };
  if (!isT4) {
    const { data: ayTerms } = await service
      .from('terms')
      .select('id, term_number, end_date')
      .eq('academic_year_id', term.academic_year_id)
      .order('term_number');
    const cumulativeGaps = await cumulativeCommentGaps(
      service,
      sectionId,
      (ayTerms ?? []) as {
        id: string;
        term_number: number;
        end_date: string | null;
      }[],
      term.term_number
    );
    commentGate = {
      ok: cumulativeGaps.length === 0,
      required_through_term: Math.min(term.term_number, 3),
      gaps: cumulativeGaps.map((g) => ({
        term_number: g.termNumber,
        missing: g.missing
          .slice(0, 20)
          .map((m) => ({ name: m.name, index: m.indexNumber })),
      })),
    };
  }

  // Virtue theme: only relevant for T1–T3 (T4 has no FCA comment block per KD #49).
  const virtueReadiness = !isT4
    ? {
        ok: !!(term.virtue_theme as string | null)?.trim(),
        term_label: `Term ${term.term_number}`,
      }
    : null;

  return NextResponse.json({
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
    virtue_readiness: virtueReadiness,
    // HARD gate: cumulative comment completeness for terms 1..N (KD #49/#120).
    comment_gate: commentGate,
  });
}
