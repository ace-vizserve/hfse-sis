import { unstable_cache } from 'next/cache';

import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';
import {
  applyTargetFilter,
  classifyGradeBucket,
  type GradeBand,
} from '@/lib/markbook/drill-filter';
import { termIdsForRange } from '@/lib/markbook/term-range';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// Markbook drill-down primitives — sibling of `lib/admissions/drill.ts`.
//
// Markbook has THREE row shapes (entry / sheet / change-request) because the
// underlying data is multi-faceted: a "grade-entries" drill shows one row per
// student × subject; "sheets-locked" shows one row per sheet; "change-requests"
// shows one row per request. Each target maps to a row-shape kind via
// `rowKindForTarget`, and the drill sheet picks columns + cell renderers
// accordingly.
//
// CSV export delegates to the same helpers, so the downloaded file matches
// what the user sees on screen.

const CACHE_TTL_SECONDS = 60;

function tags(ayCode: string): string[] {
  return ['markbook-drill', `markbook-drill:${ayCode}`];
}

// ---------------------------------------------------------------------------
// Targets

export type MarkbookDrillTarget =
  | 'grade-entries'
  | 'sheets-locked'
  | 'change-requests'
  | 'publication-coverage'
  | 'grade-bucket-entries'
  | 'term-sheet-status'
  | 'term-publication-status'
  | 'sheet-readiness-section'
  | 'teacher-entry-velocity';

export type MarkbookDrillRowKind = 'entry' | 'sheet' | 'change-request';

// State targets load the entry set TERM-scoped (sheet's term ∈ picker terms)
// so the drill matches its KPI card. The activity target
// ('teacher-entry-velocity') instead loads AY-wide and clamps by enteredAt —
// it measures grading ACTIVITY in the window, not state for a term. Splitting
// the load here keeps applyScopeFilter's entry branch a clean pass-through.
export function isTermScopedEntryTarget(t: MarkbookDrillTarget): boolean {
  return t === 'grade-entries' || t === 'grade-bucket-entries';
}

export function rowKindForTarget(t: MarkbookDrillTarget): MarkbookDrillRowKind {
  switch (t) {
    case 'grade-entries':
    case 'grade-bucket-entries':
    case 'teacher-entry-velocity':
      return 'entry';
    case 'sheets-locked':
    case 'publication-coverage':
    case 'term-sheet-status':
    case 'term-publication-status':
    case 'sheet-readiness-section':
      return 'sheet';
    case 'change-requests':
      return 'change-request';
    default: {
      const _exhaustive: never = t;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Row shapes

export type GradeEntryRow = {
  entryId: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  enroleeNumber: string;
  level: string | null;
  sectionId: string;
  sectionName: string;
  subjectCode: string;
  termNumber: number;
  termId: string;
  wwScores: (number | null)[]; // per-slot WW scores (length matches sheet's ww_totals)
  ptScores: (number | null)[]; // per-slot PT scores
  qaScore: number | null; // qa_score
  qaMax: number; // qa_total from sheet (default 30)
  letterGrade: string | null; // letter_grade (non-examinable subjects)
  // Kept for back-compat / cohort drills — not surfaced as a default column.
  rawScore: number | null;
  maxScore: number;
  computedGrade: number | null;
  gradeBucket: GradeBand | null;
  // Sheet-level examinable flag (from `subjects.is_examinable`, KD #95) +
  // entry-level N.A. flag (Hard Rule #3) — carried so the
  // 'grade-bucket-entries' target can filter to exactly the rows the
  // grade-distribution histogram counts (loadGradeDistributionUncached in
  // dashboard.ts), without every OTHER entry-kind target (grade-entries,
  // teacher-entry-velocity) losing rows it's supposed to keep.
  isExaminable: boolean;
  isNa: boolean;
  isLocked: boolean;
  enteredAt: string; // ISO created_at
  enteredBy: string | null; // teacher email
  enteredById: string | null; // teacher_user_id
};

export type SheetRow = {
  sheetId: string;
  sectionId: string;
  sectionName: string;
  level: string | null;
  subjectCode: string;
  subjectName: string;
  termNumber: number;
  termLabel: string;
  termId: string;
  isLocked: boolean;
  lockedAt: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  entriesPresent: number;
  entriesExpected: number;
  completenessPct: number;
  teacherName: string | null;
};

export type ChangeRequestRow = {
  requestId: string;
  status: string;
  sheetId: string;
  sectionId: string;
  sectionName: string;
  subjectCode: string;
  termNumber: number;
  termId: string;
  fieldChanged: string;
  reasonCategory: string;
  requestedBy: string;
  requestedAt: string;
  resolvedAt: string | null;
  // Raw `reviewed_at` — the timestamp the "decided" set + avg-decision-hours
  // KPI (loadChangeRequestSummaryUncached / loadMarkbookKpisForRange, both in
  // dashboard.ts) key on. Distinct from `resolvedAt` (`applied_at ??
  // reviewed_at`, display-only) — a request that's been applied can carry a
  // LATER applied_at than its reviewed_at, so filtering 'decided' on
  // resolvedAt would diverge from what the KPI actually averages over.
  reviewedAt: string | null;
};

export type MarkbookDrillRow = GradeEntryRow | SheetRow | ChangeRequestRow;

// Back-compat alias — `GradeBucketKey` used to be defined locally here; the
// canonical band-key type now lives in `lib/markbook/drill-filter.ts` as
// `GradeBand`. No other file in the repo imports `GradeBucketKey` (verified),
// but the alias costs nothing to keep.
export type GradeBucketKey = GradeBand;

// ---------------------------------------------------------------------------
// Range input

export type DrillRangeInput = {
  ayCode: string;
  /** When set, clamp the dataset by these dates. Both must be present. */
  from?: string;
  to?: string;
  /** Teacher-scoping: when set, only rows for sections in this list are kept. */
  allowedSectionIds?: string[] | null;
};

// ---------------------------------------------------------------------------
// Universal loaders — one per row shape. Hoisted uncached, wrapped per-call.

type SectionLite = {
  id: string;
  name: string;
  academic_year_id: string;
  level_id: string;
};
type LevelLite = { id: string; code: string };
type TermLite = {
  id: string;
  term_number: number;
  academic_year_id: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
};
type SubjectLite = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean | null;
};

async function resolveAyContext(ayCode: string): Promise<{
  ayId: string | null;
  sections: SectionLite[];
  levels: Map<string, string>;
  terms: TermLite[];
  termIds: string[];
  subjects: Map<string, string>;
  subjectNames: Map<string, string>;
  subjectExaminable: Map<string, boolean>;
}> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) {
    return {
      ayId: null,
      sections: [],
      levels: new Map(),
      terms: [],
      termIds: [],
      subjects: new Map(),
      subjectNames: new Map(),
      subjectExaminable: new Map(),
    };
  }
  const [sectionsRes, levelsRes, termsRes, subjectsRes] = await Promise.all([
    service
      .from('sections')
      .select('id, name, academic_year_id, level_id')
      .eq('academic_year_id', ayId),
    service.from('levels').select('id, code'),
    service
      .from('terms')
      .select('id, term_number, academic_year_id, label, start_date, end_date')
      .eq('academic_year_id', ayId),
    // is_examinable per KD #95 — mirrors loadGradeDistributionUncached's
    // subjects!inner(is_examinable) join (dashboard.ts), so the
    // 'grade-bucket-entries' drill target can apply the identical
    // examinable-only filter without a second round-trip per sheet.
    service.from('subjects').select('id, code, name, is_examinable'),
  ]);
  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[])
    levels.set(l.id, l.code);
  const terms = (termsRes.data ?? []) as TermLite[];
  const subjects = new Map<string, string>();
  const subjectNames = new Map<string, string>();
  const subjectExaminable = new Map<string, boolean>();
  for (const s of (subjectsRes.data ?? []) as SubjectLite[]) {
    subjects.set(s.id, s.code);
    subjectNames.set(s.id, s.name);
    subjectExaminable.set(s.id, s.is_examinable === true);
  }
  return {
    ayId,
    sections,
    levels,
    terms,
    termIds: terms.map((t) => t.id),
    subjects,
    subjectNames,
    subjectExaminable,
  };
}

// ── Entry rows ──────────────────────────────────────────────────────────────

async function loadEntryRowsUncached(
  ayCode: string,
  from?: string,
  to?: string
): Promise<GradeEntryRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.termIds.length === 0) return [];

  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);

  // Scope to the terms overlapping the picker range — the SAME selection the
  // "Grades entered" KPI card uses (lib/markbook/dashboard.ts), so card count
  // == entry-drill row count. We scope by the SHEET's term (term overlap),
  // NOT by the entry's own enteredAt/created date — a grade for T2 entered
  // late must still count under T2. No range → all AY terms (ctx.termIds).
  const allowedTermIds = termIdsForRange(ctx.terms, from, to);
  if (allowedTermIds.length === 0) return [];

  // Sheets in this AY, restricted to the in-range terms. Paginated —
  // PostgREST caps a single response at 1000 rows and a large AY can carry
  // more grading sheets than that across all sections × subjects × terms.
  type SheetLite = {
    id: string;
    term_id: string;
    section_id: string;
    subject_id: string;
    qa_total: number | null;
    is_locked: boolean;
    locked_at: string | null;
    teacher_name: string | null;
  };
  const sheets = await fetchAllPages<SheetLite>((from, to) =>
    service
      .from('grading_sheets')
      .select(
        'id, term_id, section_id, subject_id, qa_total, is_locked, locked_at, teacher_name'
      )
      .in('term_id', allowedTermIds)
      .range(from, to)
  );
  if (sheets.length === 0) return [];
  const sheetById = new Map<string, SheetLite>();
  for (const s of sheets) sheetById.set(s.id, s);
  const sheetIds = sheets.map((s) => s.id);

  // teacher_assignments — used to attribute "enteredBy" for entries on this
  // sheet (subject_teacher mapping). We'll take the first match per
  // (section_id, subject_id).
  const { data: assignmentsData } = await service
    .from('teacher_assignments')
    .select('teacher_user_id, section_id, subject_id, role')
    .eq('role', 'subject_teacher');
  type AssignmentLite = {
    teacher_user_id: string;
    section_id: string;
    subject_id: string | null;
    role: string;
  };
  const assignments = (assignmentsData ?? []) as AssignmentLite[];
  const teacherKey = (sectionId: string, subjectId: string) =>
    `${sectionId}|${subjectId}`;
  const teacherBySectionSubject = new Map<string, string>();
  for (const a of assignments) {
    if (!a.subject_id) continue;
    const k = teacherKey(a.section_id, a.subject_id);
    if (!teacherBySectionSubject.has(k))
      teacherBySectionSubject.set(k, a.teacher_user_id);
  }

  const teacherEmailById = new Map<string, string>(await getTeacherEmailMap());

  // Entries — chunk by grading_sheet_id to bound the IN-clause, then
  // paginate inside each chunk so PostgREST's 1000-row response cap
  // doesn't silently drop entries (HFSE has 700+ sheets × ~20 students =
  // 14K+ entries per AY).
  type EntryLite = {
    id: string;
    grading_sheet_id: string;
    section_student_id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    quarterly_grade: number | null;
    letter_grade: string | null;
    // is_na per Hard Rule #3 — an N.A. row's quarterly_grade is computed
    // from placeholder zeros, not a real grade (mirrors dashboard.ts's
    // grade-distribution histogram, which excludes these). Selected here
    // (not just for the histogram-mirroring target) so it's available on
    // every entry row without a second query.
    is_na: boolean | null;
    created_at: string;
  };
  const CHUNK = 200;
  const entries = (
    await Promise.all(
      Array.from({ length: Math.ceil(sheetIds.length / CHUNK) }, (_, i) =>
        fetchAllPages<EntryLite>((from, to) =>
          service
            .from('grade_entries')
            .select(
              'id, grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, quarterly_grade, letter_grade, is_na, created_at'
            )
            .in('grading_sheet_id', sheetIds.slice(i * CHUNK, (i + 1) * CHUNK))
            .range(from, to)
        )
      )
    )
  ).flat();
  // "Grade entered" = the entry has any encoded data anywhere — at
  // least one WW slot, one PT slot, QA, or letter_grade. Don't gate on
  // quarterly_grade (only computed when WW+PT+QA are all filled);
  // partial fills still count as the student being mid-graded. Drops
  // auto-seeded rows where every score column is null.
  const hasAnyGrade = (e: EntryLite): boolean => {
    if (e.qa_score !== null) return true;
    if (e.letter_grade !== null) return true;
    if ((e.ww_scores ?? []).some((s) => s !== null)) return true;
    if ((e.pt_scores ?? []).some((s) => s !== null)) return true;
    return false;
  };
  const gradedEntries = entries.filter(hasAnyGrade);

  // section_students → student_id + section_id resolution.
  const ssIds = Array.from(new Set(entries.map((e) => e.section_student_id)));
  type SectionStudentLite = {
    id: string;
    section_id: string;
    student_id: string;
  };
  const sectionStudents = (
    await Promise.all(
      Array.from({ length: Math.ceil(ssIds.length / CHUNK) }, (_, i) =>
        service
          .from('section_students')
          .select('id, section_id, student_id')
          .in('id', ssIds.slice(i * CHUNK, (i + 1) * CHUNK))
          .then(({ data }) => (data ?? []) as SectionStudentLite[])
      )
    )
  ).flat();
  const ssById = new Map<string, SectionStudentLite>();
  for (const s of sectionStudents) ssById.set(s.id, s);

  // Students.
  const studentIds = Array.from(
    new Set(sectionStudents.map((s) => s.student_id))
  );
  type StudentLite = {
    id: string;
    student_number: string;
    first_name: string;
    last_name: string;
  };
  const students = (
    await Promise.all(
      Array.from({ length: Math.ceil(studentIds.length / CHUNK) }, (_, i) =>
        service
          .from('students')
          .select('id, student_number, first_name, last_name')
          .in('id', studentIds.slice(i * CHUNK, (i + 1) * CHUNK))
          .then(({ data }) => (data ?? []) as StudentLite[])
      )
    )
  ).flat();
  const studentById = new Map<string, StudentLite>();
  for (const s of students) studentById.set(s.id, s);

  // Build rows.
  const out: GradeEntryRow[] = [];
  for (const e of gradedEntries) {
    const sheet = sheetById.get(e.grading_sheet_id);
    if (!sheet) continue;
    const ss = ssById.get(e.section_student_id);
    if (!ss) continue;
    const student = studentById.get(ss.student_id);
    if (!student) continue;
    const term = termById.get(sheet.term_id);
    if (!term) continue;
    const section = sectionById.get(sheet.section_id);
    if (!section) continue;
    const levelCode = ctx.levels.get(section.level_id) ?? null;
    const subjectCode = ctx.subjects.get(sheet.subject_id) ?? sheet.subject_id;
    const teacherUserId =
      teacherBySectionSubject.get(
        teacherKey(sheet.section_id, sheet.subject_id)
      ) ?? null;
    const teacherEmail = teacherUserId
      ? (teacherEmailById.get(teacherUserId) ?? null)
      : null;
    const fullName = `${student.last_name}, ${student.first_name}`.trim();
    const enroleeNumber = student.student_number; // fallback when distinct enrolee# not exposed
    const qaTotal = sheet.qa_total ?? 30;

    out.push({
      entryId: e.id,
      studentId: student.id,
      studentName: fullName,
      studentNumber: student.student_number,
      enroleeNumber,
      level: levelCode,
      sectionId: sheet.section_id,
      sectionName: section.name,
      subjectCode,
      termNumber: term.term_number,
      termId: term.id,
      wwScores: e.ww_scores ?? [],
      ptScores: e.pt_scores ?? [],
      qaScore: e.qa_score,
      qaMax: qaTotal,
      letterGrade: e.letter_grade,
      rawScore: e.qa_score,
      maxScore: qaTotal,
      computedGrade: e.quarterly_grade,
      gradeBucket: classifyGradeBucket(e.quarterly_grade),
      isExaminable: ctx.subjectExaminable.get(sheet.subject_id) ?? false,
      isNa: e.is_na === true,
      isLocked: sheet.is_locked,
      enteredAt: e.created_at,
      enteredBy: teacherEmail,
      enteredById: teacherUserId,
    });
  }
  return out;
}

// ── Sheet rows ──────────────────────────────────────────────────────────────

async function loadSheetRowsUncached(ayCode: string): Promise<SheetRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.termIds.length === 0) return [];

  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);

  // Fetch sheets first so we can scope the entries + publications queries
  // by term/sheet IDs — avoids unbounded scans across all AYs' data.
  // Paginated — PostgREST caps a single response at 1000 rows and a large
  // AY can carry more grading sheets than that.
  const sectionIds = ctx.sections.map((s) => s.id);
  type SheetLite = {
    id: string;
    term_id: string;
    section_id: string;
    subject_id: string;
    is_locked: boolean;
    locked_at: string | null;
    teacher_name: string | null;
  };
  const sheets = await fetchAllPages<SheetLite>((from, to) =>
    service
      .from('grading_sheets')
      .select(
        'id, term_id, section_id, subject_id, is_locked, locked_at, teacher_name'
      )
      .in('term_id', ctx.termIds)
      .range(from, to)
  );
  const sheetIdsForRollup = sheets.map((s) => s.id);

  // Chunk the sheet-IDs IN-clause so the URL doesn't blow past PostgREST's
  // URL length cap when an AY has many sheets (sibling pattern in
  // loadEntryRowsUncached above). Run all three rollups in parallel still.
  const ROLLUP_CHUNK = 200;
  async function loadEntriesRollup(): Promise<{ grading_sheet_id: string }[]> {
    if (sheetIdsForRollup.length === 0) return [];
    const out: { grading_sheet_id: string }[] = [];
    for (let i = 0; i < sheetIdsForRollup.length; i += ROLLUP_CHUNK) {
      const slice = sheetIdsForRollup.slice(i, i + ROLLUP_CHUNK);
      const rows = await fetchAllPages<{ grading_sheet_id: string }>(
        (from, to) =>
          service
            .from('grade_entries')
            .select('grading_sheet_id')
            .in('grading_sheet_id', slice)
            .range(from, to)
      );
      out.push(...rows);
    }
    return out;
  }
  type SsRollupLite = { section_id: string; enrollment_status: string };
  const [{ data: pubsData }, ssRollupData, entriesRollupData] =
    await Promise.all([
      sectionIds.length > 0
        ? service
            .from('report_card_publications')
            .select('section_id, term_id, publish_from')
            .in('term_id', ctx.termIds)
        : Promise.resolve({ data: [] }),
      sectionIds.length > 0
        ? fetchAllPages<SsRollupLite>((from, to) =>
            service
              .from('section_students')
              .select('section_id, enrollment_status')
              .in('section_id', sectionIds)
              .range(from, to)
          )
        : Promise.resolve([] as SsRollupLite[]),
      loadEntriesRollup(),
    ]);

  type PubLite = { section_id: string; term_id: string; publish_from: string };
  const pubKey = (sec: string, term: string) => `${sec}|${term}`;
  const pubByKey = new Map<string, string>();
  for (const p of (pubsData ?? []) as PubLite[]) {
    pubByKey.set(pubKey(p.section_id, p.term_id), p.publish_from);
  }

  const activeStudentsBySection = new Map<string, number>();
  for (const r of ssRollupData) {
    if (
      r.enrollment_status !== 'active' &&
      r.enrollment_status !== 'late_enrollee'
    )
      continue;
    activeStudentsBySection.set(
      r.section_id,
      (activeStudentsBySection.get(r.section_id) ?? 0) + 1
    );
  }

  const entriesPerSheet = new Map<string, number>();
  for (const e of entriesRollupData) {
    entriesPerSheet.set(
      e.grading_sheet_id,
      (entriesPerSheet.get(e.grading_sheet_id) ?? 0) + 1
    );
  }

  const out: SheetRow[] = [];
  for (const s of sheets) {
    const term = termById.get(s.term_id);
    if (!term) continue;
    const section = sectionById.get(s.section_id);
    if (!section) continue;
    const levelCode = ctx.levels.get(section.level_id) ?? null;
    const subjectCode = ctx.subjects.get(s.subject_id) ?? s.subject_id;
    const subjectName = ctx.subjectNames.get(s.subject_id) ?? subjectCode;
    const expected = activeStudentsBySection.get(s.section_id) ?? 0;
    const present = entriesPerSheet.get(s.id) ?? 0;
    const completeness =
      expected > 0 ? Math.round((present / expected) * 100) : 0;
    const publishedAt = pubByKey.get(pubKey(s.section_id, s.term_id)) ?? null;

    out.push({
      sheetId: s.id,
      sectionId: s.section_id,
      sectionName: section.name,
      level: levelCode,
      subjectCode,
      subjectName,
      termNumber: term.term_number,
      termLabel: term.label,
      termId: term.id,
      isLocked: s.is_locked,
      lockedAt: s.locked_at,
      isPublished: publishedAt !== null,
      publishedAt,
      entriesPresent: present,
      entriesExpected: expected,
      completenessPct: completeness,
      teacherName: s.teacher_name,
    });
  }
  return out;
}

// ── Change-request rows ─────────────────────────────────────────────────────

async function loadChangeRequestRowsUncached(
  ayCode: string
): Promise<ChangeRequestRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.termIds.length === 0) return [];

  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);

  const { data: sheetsData } = await service
    .from('grading_sheets')
    .select('id, term_id, section_id, subject_id')
    .in('term_id', ctx.termIds);
  type SheetLite = {
    id: string;
    term_id: string;
    section_id: string;
    subject_id: string;
  };
  const sheets = (sheetsData ?? []) as SheetLite[];
  const sheetById = new Map<string, SheetLite>();
  for (const s of sheets) sheetById.set(s.id, s);
  const sheetIds = sheets.map((s) => s.id);
  if (sheetIds.length === 0) return [];

  type CrLite = {
    id: string;
    grading_sheet_id: string;
    field_changed: string;
    reason_category: string;
    status: string;
    requested_by_email: string;
    requested_at: string;
    reviewed_at: string | null;
    applied_at: string | null;
  };
  const CHUNK = 200;
  const requests = (
    await Promise.all(
      Array.from({ length: Math.ceil(sheetIds.length / CHUNK) }, (_, i) =>
        service
          .from('grade_change_requests')
          .select(
            'id, grading_sheet_id, field_changed, reason_category, status, requested_by_email, requested_at, reviewed_at, applied_at'
          )
          .in('grading_sheet_id', sheetIds.slice(i * CHUNK, (i + 1) * CHUNK))
          .then(({ data }) => (data ?? []) as CrLite[])
      )
    )
  ).flat();

  const out: ChangeRequestRow[] = [];
  for (const r of requests) {
    const sheet = sheetById.get(r.grading_sheet_id);
    if (!sheet) continue;
    const term = termById.get(sheet.term_id);
    if (!term) continue;
    const section = sectionById.get(sheet.section_id);
    if (!section) continue;
    const subjectCode = ctx.subjects.get(sheet.subject_id) ?? sheet.subject_id;
    out.push({
      requestId: r.id,
      status: r.status,
      sheetId: sheet.id,
      sectionId: sheet.section_id,
      sectionName: section.name,
      subjectCode,
      termNumber: term.term_number,
      termId: term.id,
      fieldChanged: r.field_changed,
      reasonCategory: r.reason_category,
      requestedBy: r.requested_by_email,
      requestedAt: r.requested_at,
      resolvedAt: r.applied_at ?? r.reviewed_at,
      reviewedAt: r.reviewed_at,
    });
  }
  return out;
}

// ── Cache wrappers ──────────────────────────────────────────────────────────

// AY-scoped caches; scope/range/teacher filtering applied post-cache by
// callers. We deliberately do NOT include scope/from/to/allowedSectionIds
// in the cache key — they would fragment the cache without saving any DB
// work (the underlying tables are the same regardless of date scope).
// See lib/admissions/drill.ts::buildDrillRows for the same rationale.

// loadEntryRows: uncached on purpose. The full AY's grade_entries set runs
// ~28K rows (21 sections × ~13 students × 10 subjects × 4 terms) and ~7MB
// serialized — well past Next.js's 2MB unstable_cache limit. Wrapping this
// in unstable_cache silently failed the cache write and made every drill
// re-hit Supabase from cold.
//
// Per KD #56: pre-fetch returns ROLLED-UP shapes (loadSheetRows + change
// requests cached separately, both << 2MB). Raw entries are consumed by:
//   1. getTeacherEntryVelocity — wraps its own small rolled-up output in
//      unstable_cache below.
//   2. Drill API routes for entry-kind drills — already lazy-fetch per
//      request; per-request latency is acceptable.
// from/to scope the entries to the terms overlapping the picker range (via
// termIdsForRange inside loadEntryRowsUncached). They're part of the cache
// key — mirroring getTeacherEntryVelocity below — so a scoped drill (e.g.
// "Term 2") doesn't share a slot with the AY-wide set. Absent → AY-wide.
async function loadEntryRows(
  ayCode: string,
  from?: string,
  to?: string
): Promise<GradeEntryRow[]> {
  return loadEntryRowsUncached(ayCode, from, to);
}

async function loadSheetRows(ayCode: string): Promise<SheetRow[]> {
  return unstable_cache(
    () => loadSheetRowsUncached(ayCode),
    ['markbook-drill', 'sheet-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

async function loadChangeRequestRows(
  ayCode: string
): Promise<ChangeRequestRow[]> {
  return unstable_cache(
    () => loadChangeRequestRowsUncached(ayCode),
    ['markbook-drill', 'cr-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ---------------------------------------------------------------------------
// Teacher-entry-velocity rollup. Surfaced on the dashboard as a chart card
// (registrar+ only — gated at the page level via canSeeAdmin). Drill into a
// teacher segment shows the actual entries via target='teacher-entry-velocity'.

export type TeacherVelocityRow = {
  teacherUserId: string;
  teacherEmail: string | null;
  entryCount: number;
  lastEntryAt: string | null;
};

async function getTeacherEntryVelocityUncached(
  ayCode: string,
  range?: { from: string; to: string }
): Promise<TeacherVelocityRow[]> {
  const entries = await loadEntryRows(ayCode);
  type Acc = { count: number; lastAt: string | null; email: string | null };
  const map = new Map<string, Acc>();
  for (const e of entries) {
    if (!e.enteredById) continue;
    if (
      range &&
      (e.enteredAt.slice(0, 10) < range.from ||
        e.enteredAt.slice(0, 10) > range.to)
    ) {
      continue;
    }
    let acc = map.get(e.enteredById);
    if (!acc) {
      acc = { count: 0, lastAt: null, email: e.enteredBy };
      map.set(e.enteredById, acc);
    }
    acc.count += 1;
    if (!acc.lastAt || e.enteredAt > acc.lastAt) acc.lastAt = e.enteredAt;
  }
  const out: TeacherVelocityRow[] = [];
  for (const [teacherUserId, acc] of map.entries()) {
    out.push({
      teacherUserId,
      teacherEmail: acc.email,
      entryCount: acc.count,
      lastEntryAt: acc.lastAt,
    });
  }
  out.sort((a, b) => b.entryCount - a.entryCount);
  return out;
}

// Cached at the OUTPUT level — at most ~50 teachers per AY × 4 fields each
// is well under 2MB. Per-call key includes the optional date range so a
// scoped trend (e.g. "T1 only") doesn't share a cache slot with the full
// AY rollup. Replaces the prior inner-loadEntryRows cache which kept
// failing the 2MB write limit and forced every render to re-fetch.
export function getTeacherEntryVelocity(
  ayCode: string,
  range?: { from: string; to: string }
): Promise<TeacherVelocityRow[]> {
  return unstable_cache(
    () => getTeacherEntryVelocityUncached(ayCode, range),
    [
      'markbook-drill',
      'teacher-velocity',
      ayCode,
      range?.from ?? '',
      range?.to ?? '',
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ---------------------------------------------------------------------------
// Universal drill row builder — public entry point.

export type BuildDrillRowsInput = DrillRangeInput & {
  target: MarkbookDrillTarget;
  segment?: string | null;
};

export async function buildMarkbookDrillRows(
  input: BuildDrillRowsInput
): Promise<MarkbookDrillRow[]> {
  const kind = rowKindForTarget(input.target);
  let rows: MarkbookDrillRow[];
  if (kind === 'entry') {
    if (isTermScopedEntryTarget(input.target)) {
      // State target ('grade-entries' / 'grade-bucket-entries'): term-scope
      // entries by the picker range (term overlap) — same selection as the
      // "Grades entered" KPI card. The enteredAt date-clamp is dropped from
      // applyScopeFilter for entries (see below) so a late-entered T2 grade
      // still counts under T2.
      rows = (await loadEntryRows(
        input.ayCode,
        input.from,
        input.to
      )) as MarkbookDrillRow[];
    } else {
      // Activity target ('teacher-entry-velocity'): load AY-wide (no term
      // scoping) and clamp by enteredAt to the picker range, matching
      // getTeacherEntryVelocityUncached so the velocity card == its drill.
      const all = (await loadEntryRows(input.ayCode)) as MarkbookDrillRow[];
      rows =
        input.from && input.to
          ? applyDateRangeFilter(
              all as GradeEntryRow[],
              input,
              (r) => r.enteredAt,
              { caller: 'markbook/drill:teacher-entry-velocity' }
            )
          : all;
    }
  } else if (kind === 'sheet') {
    rows = (await loadSheetRows(input.ayCode)) as MarkbookDrillRow[];
  } else {
    rows = (await loadChangeRequestRows(input.ayCode)) as MarkbookDrillRow[];
  }
  rows = applyScopeFilter(rows, kind, input);
  rows = applyTeacherFilter(rows, kind, input.allowedSectionIds ?? null);
  rows = applyTargetFilter(rows, input.target, input.segment ?? null, {
    from: input.from,
    to: input.to,
  });
  return rows;
}

/**
 * Same as `buildMarkbookDrillRows` but returns the raw kind+rows pair, so the
 * page can pre-fetch all 3 row sets in parallel without picking a single
 * target. Used by `app/(markbook)/markbook/page.tsx` to seed `initialRows`.
 */
export async function buildAllRowSets(input: {
  ayCode: string;
  from?: string;
  to?: string;
  allowedSectionIds?: string[] | null;
}): Promise<{
  sheets: SheetRow[];
  changeRequests: ChangeRequestRow[];
}> {
  // entries deliberately excluded — at 1000 students × 10 subjects × 4 terms
  // that's ~40k rows, ~10 MB JSON shipped through the RSC payload for users
  // who may never open an entry-kind drill. Drill sheets with target kind
  // 'entry' lazy-fetch via /api/markbook/drill/{target}. sheets +
  // changeRequests stay pre-fetched (small + read often).
  const [sheets, changeRequests] = await Promise.all([
    loadSheetRows(input.ayCode),
    loadChangeRequestRows(input.ayCode),
  ]);
  const rangeInput: DrillRangeInput = {
    ayCode: input.ayCode,
    from: input.from,
    to: input.to,
    allowedSectionIds: input.allowedSectionIds ?? null,
  };
  const filteredSheets = applyTeacherFilter(
    applyScopeFilter(sheets as MarkbookDrillRow[], 'sheet', rangeInput),
    'sheet',
    input.allowedSectionIds ?? null
  ) as SheetRow[];
  const filteredCrs = applyTeacherFilter(
    applyScopeFilter(
      changeRequests as MarkbookDrillRow[],
      'change-request',
      rangeInput
    ),
    'change-request',
    input.allowedSectionIds ?? null
  ) as ChangeRequestRow[];
  return {
    sheets: filteredSheets,
    changeRequests: filteredCrs,
  };
}

// ---------------------------------------------------------------------------
// Scope filter

function applyScopeFilter(
  rows: MarkbookDrillRow[],
  kind: MarkbookDrillRowKind,
  input: DrillRangeInput
): MarkbookDrillRow[] {
  if (kind === 'entry') {
    // Entries are TERM-scoped at load time (loadEntryRowsUncached restricts
    // sheets to termIdsForRange) so the drill matches the "Grades entered"
    // KPI card, which scopes the same way. Do NOT additionally clamp by
    // enteredAt here — a grade for an in-range term entered late (outside the
    // picker window) must still count under its term. Scoping by enteredAt
    // would re-narrow the set and re-break the count↔drill parity.
    return rows;
  }
  if (kind === 'sheet') {
    // Sheet "in range" = lockedAt OR publishedAt in range. Unlocked +
    // unpublished sheets always pass — they remain visible when nothing
    // has happened yet, matching how operators think about "what's in
    // this range." Custom OR-logic doesn't fit applyDateRangeFilter; the
    // missing-range guard is replicated here.
    if (!input.from || !input.to) return rows;
    const from = input.from;
    const to = input.to;
    return (rows as SheetRow[]).filter((r) => {
      if (!r.lockedAt && !r.publishedAt) return true;
      const lockIn =
        r.lockedAt &&
        r.lockedAt.slice(0, 10) >= from &&
        r.lockedAt.slice(0, 10) <= to;
      const pubIn =
        r.publishedAt &&
        r.publishedAt.slice(0, 10) >= from &&
        r.publishedAt.slice(0, 10) <= to;
      return Boolean(lockIn || pubIn);
    }) as MarkbookDrillRow[];
  }
  // change-request
  return applyDateRangeFilter(
    rows as ChangeRequestRow[],
    input,
    (r) => r.requestedAt,
    { caller: 'markbook/drill:change-request' }
  ) as MarkbookDrillRow[];
}

// Teacher-scope filter — for non-registrar+ users, narrow rows to sections in
// the allowed list. Empty list → no rows; null → no filter.
function applyTeacherFilter(
  rows: MarkbookDrillRow[],
  kind: MarkbookDrillRowKind,
  allowedSectionIds: string[] | null
): MarkbookDrillRow[] {
  if (allowedSectionIds === null) return rows;
  const allow = new Set(allowedSectionIds);
  if (kind === 'entry') {
    return (rows as GradeEntryRow[]).filter((r) =>
      allow.has(r.sectionId)
    ) as MarkbookDrillRow[];
  }
  if (kind === 'sheet') {
    return (rows as SheetRow[]).filter((r) =>
      allow.has(r.sectionId)
    ) as MarkbookDrillRow[];
  }
  return (rows as ChangeRequestRow[]).filter((r) =>
    allow.has(r.sectionId)
  ) as MarkbookDrillRow[];
}

// ---------------------------------------------------------------------------
// Per-target column defaults

export type DrillColumnKey =
  // Entry-only
  | 'studentName'
  | 'studentNumber'
  | 'subjectCode'
  | 'termNumber'
  | 'wwScores'
  | 'ptScores'
  | 'qaScore'
  | 'rawScore'
  | 'computedGrade'
  | 'letterGrade'
  | 'gradeBucket'
  | 'enteredAt'
  | 'enteredBy'
  // Sheet-only
  | 'sheetSubjectTerm'
  | 'completeness'
  | 'lockedAt'
  | 'publishedAt'
  | 'teacherName'
  // Change-request-only
  | 'fieldChanged'
  | 'reasonCategory'
  | 'requestedBy'
  | 'requestedAt'
  | 'resolvedAt'
  // Shared
  | 'sectionName'
  | 'level'
  | 'isLocked'
  | 'status';

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  studentName: 'Student',
  studentNumber: 'Student ID',
  subjectCode: 'Subject',
  termNumber: 'Term',
  wwScores: 'WW',
  ptScores: 'PT',
  qaScore: 'QA',
  rawScore: 'QA',
  computedGrade: 'Quarterly',
  letterGrade: 'Letter',
  gradeBucket: 'Band',
  enteredAt: 'Entered',
  enteredBy: 'Teacher',
  sheetSubjectTerm: 'Sheet',
  completeness: 'Completeness',
  lockedAt: 'Locked',
  publishedAt: 'Published',
  teacherName: 'Teacher',
  fieldChanged: 'Field',
  reasonCategory: 'Reason',
  requestedBy: 'Requested by',
  requestedAt: 'Requested',
  resolvedAt: 'Resolved',
  sectionName: 'Section',
  level: 'Level',
  isLocked: 'Locked?',
  status: 'Status',
};

// gradeBucket (DepEd-style mastery band) is intentionally omitted — HFSE
// uses numeric Quarterly + letter grade only; no band tier on the report
// card. The column key remains in the union for back-compat with cached
// query strings, but no surface renders it by default.
const ENTRY_ALL_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'studentNumber',
  'subjectCode',
  'sectionName',
  'level',
  'termNumber',
  'wwScores',
  'ptScores',
  'qaScore',
  'letterGrade',
  'isLocked',
  'enteredAt',
  'enteredBy',
];

const SHEET_ALL_COLUMNS: DrillColumnKey[] = [
  'sheetSubjectTerm',
  'sectionName',
  'level',
  'subjectCode',
  'termNumber',
  'isLocked',
  'lockedAt',
  'publishedAt',
  'completeness',
  'teacherName',
];

const CR_ALL_COLUMNS: DrillColumnKey[] = [
  'sectionName',
  'subjectCode',
  'termNumber',
  'fieldChanged',
  'reasonCategory',
  'status',
  'requestedBy',
  'requestedAt',
  'resolvedAt',
];

export function allColumnsForKind(
  kind: MarkbookDrillRowKind
): DrillColumnKey[] {
  if (kind === 'entry') return ENTRY_ALL_COLUMNS;
  if (kind === 'sheet') return SHEET_ALL_COLUMNS;
  return CR_ALL_COLUMNS;
}

export function defaultColumnsForTarget(
  target: MarkbookDrillTarget
): DrillColumnKey[] {
  switch (target) {
    case 'grade-entries':
      return [
        'studentName',
        'subjectCode',
        'wwScores',
        'ptScores',
        'qaScore',
        'letterGrade',
        'enteredAt',
      ];
    case 'grade-bucket-entries':
      return [
        'studentName',
        'subjectCode',
        'sectionName',
        'computedGrade',
        'enteredAt',
      ];
    case 'teacher-entry-velocity':
      return [
        'enteredBy',
        'studentName',
        'subjectCode',
        'sectionName',
        'computedGrade',
        'enteredAt',
      ];
    case 'sheets-locked':
      return [
        'sectionName',
        'subjectCode',
        'termNumber',
        'isLocked',
        'lockedAt',
        'completeness',
      ];
    case 'publication-coverage':
      return [
        'sectionName',
        'subjectCode',
        'termNumber',
        'publishedAt',
        'isLocked',
      ];
    case 'term-publication-status':
      // One row per section after the dedupe in applyTargetFilter — drop
      // subject-specific columns since a section's status is identical
      // across all its subject sheets in a given term.
      return ['sectionName', 'level', 'termNumber', 'publishedAt'];
    case 'term-sheet-status':
      return [
        'sectionName',
        'subjectCode',
        'termNumber',
        'isLocked',
        'lockedAt',
        'completeness',
      ];
    case 'sheet-readiness-section':
      return [
        'sectionName',
        'subjectCode',
        'termNumber',
        'completeness',
        'isLocked',
      ];
    case 'change-requests':
      return [
        'sectionName',
        'subjectCode',
        'fieldChanged',
        'status',
        'requestedBy',
        'requestedAt',
      ];
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Header

export function drillHeaderForTarget(
  target: MarkbookDrillTarget,
  segment?: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'grade-entries':
      return {
        eyebrow: 'Drill · Grade entries',
        title: 'Grade entries in scope',
      };
    case 'sheets-locked':
      return {
        eyebrow: 'Drill · Sheets locked',
        title: 'Locked grading sheets',
      };
    case 'change-requests':
      return {
        eyebrow: 'Drill · Change requests',
        title: segment ? `Change requests · ${segment}` : 'Change requests',
      };
    case 'publication-coverage':
      return {
        eyebrow: 'Drill · Publication coverage',
        title:
          segment === 'published'
            ? 'Sections with a publication'
            : segment === 'not-published'
              ? 'Sections without a publication'
              : 'Publication coverage',
      };
    case 'grade-bucket-entries':
      return {
        eyebrow: 'Drill · Grade band',
        title: segment ? `Band: ${segment}` : 'Grade band',
      };
    case 'term-sheet-status':
      return {
        eyebrow: 'Drill · Sheet progress',
        title: segment ? `Sheets · ${segment}` : 'Sheet progress',
      };
    case 'term-publication-status':
      return {
        eyebrow: 'Drill · Publication',
        title: segment ? `Publication · ${segment}` : 'Publication coverage',
      };
    case 'sheet-readiness-section':
      return {
        eyebrow: 'Drill · Sheet readiness',
        title: segment ? `Open sheets · ${segment}` : 'Open sheets by section',
      };
    case 'teacher-entry-velocity':
      return {
        eyebrow: 'Drill · Teacher velocity',
        title: segment ? `Entries by ${segment}` : 'Entries by teacher',
      };
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}
