import { unstable_cache } from 'next/cache';

import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
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

export type DrillScope = 'range' | 'ay' | 'all';

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
  rawScore: number | null; // qa_score
  maxScore: number; // qa_total from sheet (default 30)
  computedGrade: number | null; // quarterly_grade
  gradeBucket: GradeBucketKey | null;
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
  termNumber: number;
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
};

export type MarkbookDrillRow = GradeEntryRow | SheetRow | ChangeRequestRow;

// ---------------------------------------------------------------------------
// Grade buckets — DepEd-style mastery bands matching `GRADE_BANDS` in
// `lib/markbook/dashboard.ts`. Kept inline here to avoid a circular import.

export type GradeBucketKey = 'dnm' | 'fs' | 's' | 'vs' | 'o';

const GRADE_BUCKET_BOUNDS: Record<GradeBucketKey, { lo: number; hi: number }> = {
  dnm: { lo: 0, hi: 74 },
  fs: { lo: 75, hi: 79 },
  s: { lo: 80, hi: 84 },
  vs: { lo: 85, hi: 89 },
  o: { lo: 90, hi: 100 },
};

export const GRADE_BUCKET_LABEL: Record<GradeBucketKey, string> = {
  dnm: '< 75 (DNM)',
  fs: '75–79 (FS)',
  s: '80–84 (S)',
  vs: '85–89 (VS)',
  o: '90–100 (O)',
};

function classifyGradeBucket(grade: number | null): GradeBucketKey | null {
  if (grade == null || !Number.isFinite(grade)) return null;
  for (const k of ['dnm', 'fs', 's', 'vs', 'o'] as GradeBucketKey[]) {
    const b = GRADE_BUCKET_BOUNDS[k];
    if (grade >= b.lo && grade <= b.hi) return k;
  }
  return null;
}

function findBucketByLabel(label: string): GradeBucketKey | null {
  for (const k of Object.keys(GRADE_BUCKET_LABEL) as GradeBucketKey[]) {
    if (GRADE_BUCKET_LABEL[k] === label) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Range input

export type DrillRangeInput = {
  ayCode: string;
  scope: DrillScope;
  /** When scope='range', clamp the dataset by these dates. */
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
type TermLite = { id: string; term_number: number; academic_year_id: string };
type SubjectLite = { id: string; code: string };

async function resolveAyContext(ayCode: string): Promise<{
  ayId: string | null;
  sections: SectionLite[];
  levels: Map<string, string>;
  terms: TermLite[];
  termIds: string[];
  subjects: Map<string, string>;
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
      .select('id, term_number, academic_year_id')
      .eq('academic_year_id', ayId),
    service.from('subjects').select('id, code'),
  ]);
  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[]) levels.set(l.id, l.code);
  const terms = (termsRes.data ?? []) as TermLite[];
  const subjects = new Map<string, string>();
  for (const s of (subjectsRes.data ?? []) as SubjectLite[]) subjects.set(s.id, s.code);
  return {
    ayId,
    sections,
    levels,
    terms,
    termIds: terms.map((t) => t.id),
    subjects,
  };
}

// ── Entry rows ──────────────────────────────────────────────────────────────

async function loadEntryRowsUncached(ayCode: string): Promise<GradeEntryRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.termIds.length === 0) return [];

  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);

  // Sheets in this AY (filter by termIds).
  const { data: sheetsData } = await service
    .from('grading_sheets')
    .select('id, term_id, section_id, subject_id, qa_total, is_locked, locked_at, teacher_name')
    .in('term_id', ctx.termIds);
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
  const sheets = (sheetsData ?? []) as SheetLite[];
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
  const teacherKey = (sectionId: string, subjectId: string) => `${sectionId}|${subjectId}`;
  const teacherBySectionSubject = new Map<string, string>();
  for (const a of assignments) {
    if (!a.subject_id) continue;
    const k = teacherKey(a.section_id, a.subject_id);
    if (!teacherBySectionSubject.has(k)) teacherBySectionSubject.set(k, a.teacher_user_id);
  }

  const teacherEmailById = new Map<string, string>(await getTeacherEmailMap());

  // Entries — split into chunks to avoid PostgREST URL length limits.
  type EntryLite = {
    id: string;
    grading_sheet_id: string;
    section_student_id: string;
    qa_score: number | null;
    quarterly_grade: number | null;
    created_at: string;
  };
  const entries: EntryLite[] = [];
  const CHUNK = 200;
  for (let i = 0; i < sheetIds.length; i += CHUNK) {
    const slice = sheetIds.slice(i, i + CHUNK);
    const { data } = await service
      .from('grade_entries')
      .select('id, grading_sheet_id, section_student_id, qa_score, quarterly_grade, created_at')
      .in('grading_sheet_id', slice);
    entries.push(...((data ?? []) as EntryLite[]));
  }

  // section_students → student_id + section_id resolution.
  const ssIds = Array.from(new Set(entries.map((e) => e.section_student_id)));
  type SectionStudentLite = { id: string; section_id: string; student_id: string };
  const sectionStudents: SectionStudentLite[] = [];
  for (let i = 0; i < ssIds.length; i += CHUNK) {
    const slice = ssIds.slice(i, i + CHUNK);
    const { data } = await service
      .from('section_students')
      .select('id, section_id, student_id')
      .in('id', slice);
    sectionStudents.push(...((data ?? []) as SectionStudentLite[]));
  }
  const ssById = new Map<string, SectionStudentLite>();
  for (const s of sectionStudents) ssById.set(s.id, s);

  // Students.
  const studentIds = Array.from(new Set(sectionStudents.map((s) => s.student_id)));
  type StudentLite = { id: string; student_number: string; first_name: string; last_name: string };
  const students: StudentLite[] = [];
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const slice = studentIds.slice(i, i + CHUNK);
    const { data } = await service
      .from('students')
      .select('id, student_number, first_name, last_name')
      .in('id', slice);
    students.push(...((data ?? []) as StudentLite[]));
  }
  const studentById = new Map<string, StudentLite>();
  for (const s of students) studentById.set(s.id, s);

  // Build rows.
  const out: GradeEntryRow[] = [];
  for (const e of entries) {
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
    const teacherUserId = teacherBySectionSubject.get(teacherKey(sheet.section_id, sheet.subject_id)) ?? null;
    const teacherEmail = teacherUserId ? teacherEmailById.get(teacherUserId) ?? null : null;
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
      rawScore: e.qa_score,
      maxScore: qaTotal,
      computedGrade: e.quarterly_grade,
      gradeBucket: classifyGradeBucket(e.quarterly_grade),
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

  const [{ data: sheetsData }, { data: pubsData }, { data: ssRollupData }, { data: entriesRollupData }] =
    await Promise.all([
      service
        .from('grading_sheets')
        .select('id, term_id, section_id, subject_id, is_locked, locked_at, teacher_name')
        .in('term_id', ctx.termIds),
      service
        .from('report_card_publications')
        .select('section_id, term_id, publish_from'),
      service
        .from('section_students')
        .select('section_id, enrollment_status'),
      service
        .from('grade_entries')
        .select('grading_sheet_id'),
    ]);

  type SheetLite = {
    id: string;
    term_id: string;
    section_id: string;
    subject_id: string;
    is_locked: boolean;
    locked_at: string | null;
    teacher_name: string | null;
  };
  const sheets = (sheetsData ?? []) as SheetLite[];

  type PubLite = { section_id: string; term_id: string; publish_from: string };
  const pubKey = (sec: string, term: string) => `${sec}|${term}`;
  const pubByKey = new Map<string, string>();
  for (const p of (pubsData ?? []) as PubLite[]) {
    pubByKey.set(pubKey(p.section_id, p.term_id), p.publish_from);
  }

  type SsRollupLite = { section_id: string; enrollment_status: string };
  const activeStudentsBySection = new Map<string, number>();
  for (const r of (ssRollupData ?? []) as SsRollupLite[]) {
    if (r.enrollment_status !== 'active' && r.enrollment_status !== 'late_enrollee') continue;
    activeStudentsBySection.set(r.section_id, (activeStudentsBySection.get(r.section_id) ?? 0) + 1);
  }

  type EntryLite = { grading_sheet_id: string };
  const entriesPerSheet = new Map<string, number>();
  for (const e of (entriesRollupData ?? []) as EntryLite[]) {
    entriesPerSheet.set(e.grading_sheet_id, (entriesPerSheet.get(e.grading_sheet_id) ?? 0) + 1);
  }

  const out: SheetRow[] = [];
  for (const s of sheets) {
    const term = termById.get(s.term_id);
    if (!term) continue;
    const section = sectionById.get(s.section_id);
    if (!section) continue;
    const levelCode = ctx.levels.get(section.level_id) ?? null;
    const subjectCode = ctx.subjects.get(s.subject_id) ?? s.subject_id;
    const expected = activeStudentsBySection.get(s.section_id) ?? 0;
    const present = entriesPerSheet.get(s.id) ?? 0;
    const completeness = expected > 0 ? Math.round((present / expected) * 100) : 0;
    const publishedAt = pubByKey.get(pubKey(s.section_id, s.term_id)) ?? null;

    out.push({
      sheetId: s.id,
      sectionId: s.section_id,
      sectionName: section.name,
      level: levelCode,
      subjectCode,
      termNumber: term.term_number,
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

async function loadChangeRequestRowsUncached(ayCode: string): Promise<ChangeRequestRow[]> {
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
  type SheetLite = { id: string; term_id: string; section_id: string; subject_id: string };
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
  const requests: CrLite[] = [];
  const CHUNK = 200;
  for (let i = 0; i < sheetIds.length; i += CHUNK) {
    const slice = sheetIds.slice(i, i + CHUNK);
    const { data } = await service
      .from('grade_change_requests')
      .select(
        'id, grading_sheet_id, field_changed, reason_category, status, requested_by_email, requested_at, reviewed_at, applied_at',
      )
      .in('grading_sheet_id', slice);
    requests.push(...((data ?? []) as CrLite[]));
  }

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
    });
  }
  return out;
}

// ── Cache wrappers ──────────────────────────────────────────────────────────

async function loadEntryRows(ayCode: string): Promise<GradeEntryRow[]> {
  return unstable_cache(
    () => loadEntryRowsUncached(ayCode),
    ['markbook-drill', 'entry-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}

async function loadSheetRows(ayCode: string): Promise<SheetRow[]> {
  return unstable_cache(
    () => loadSheetRowsUncached(ayCode),
    ['markbook-drill', 'sheet-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}

async function loadChangeRequestRows(ayCode: string): Promise<ChangeRequestRow[]> {
  return unstable_cache(
    () => loadChangeRequestRowsUncached(ayCode),
    ['markbook-drill', 'cr-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}

// ---------------------------------------------------------------------------
// Universal drill row builder — public entry point.

export type BuildDrillRowsInput = DrillRangeInput & {
  target: MarkbookDrillTarget;
  segment?: string | null;
};

export async function buildMarkbookDrillRows(
  input: BuildDrillRowsInput,
): Promise<MarkbookDrillRow[]> {
  const kind = rowKindForTarget(input.target);
  let rows: MarkbookDrillRow[];
  if (kind === 'entry') {
    rows = (await loadEntryRows(input.ayCode)) as MarkbookDrillRow[];
  } else if (kind === 'sheet') {
    rows = (await loadSheetRows(input.ayCode)) as MarkbookDrillRow[];
  } else {
    rows = (await loadChangeRequestRows(input.ayCode)) as MarkbookDrillRow[];
  }
  rows = applyScopeFilter(rows, kind, input);
  rows = applyTeacherFilter(rows, kind, input.allowedSectionIds ?? null);
  rows = applyTargetFilter(rows, input.target, input.segment ?? null);
  return rows;
}

/**
 * Same as `buildMarkbookDrillRows` but returns the raw kind+rows pair, so the
 * page can pre-fetch all 3 row sets in parallel without picking a single
 * target. Used by `app/(markbook)/markbook/page.tsx` to seed `initialRows`.
 */
export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
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
    scope: input.scope,
    from: input.from,
    to: input.to,
    allowedSectionIds: input.allowedSectionIds ?? null,
  };
  const filteredSheets = applyTeacherFilter(
    applyScopeFilter(sheets as MarkbookDrillRow[], 'sheet', rangeInput),
    'sheet',
    input.allowedSectionIds ?? null,
  ) as SheetRow[];
  const filteredCrs = applyTeacherFilter(
    applyScopeFilter(changeRequests as MarkbookDrillRow[], 'change-request', rangeInput),
    'change-request',
    input.allowedSectionIds ?? null,
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
  input: DrillRangeInput,
): MarkbookDrillRow[] {
  if (input.scope !== 'range') return rows;
  const from = input.from;
  const to = input.to;
  if (!from || !to) return rows;
  if (kind === 'entry') {
    return (rows as GradeEntryRow[]).filter((r) => {
      const d = r.enteredAt.slice(0, 10);
      return d >= from && d <= to;
    }) as MarkbookDrillRow[];
  }
  if (kind === 'sheet') {
    // For sheets, "in range" = lockedAt OR publishedAt in range. If neither,
    // include only when scope explicitly requests "range" and one of the
    // timestamps fell into it. We default to including unlocked, unpublished
    // sheets in 'range' too — they remain visible when nothing has happened
    // yet, matching how operators think about a "what's in this range" view.
    return (rows as SheetRow[]).filter((r) => {
      if (!r.lockedAt && !r.publishedAt) return true;
      const lockIn = r.lockedAt && r.lockedAt.slice(0, 10) >= from && r.lockedAt.slice(0, 10) <= to;
      const pubIn = r.publishedAt && r.publishedAt.slice(0, 10) >= from && r.publishedAt.slice(0, 10) <= to;
      return Boolean(lockIn || pubIn);
    }) as MarkbookDrillRow[];
  }
  // change-request
  return (rows as ChangeRequestRow[]).filter((r) => {
    const d = r.requestedAt.slice(0, 10);
    return d >= from && d <= to;
  }) as MarkbookDrillRow[];
}

// Teacher-scope filter — for non-registrar+ users, narrow rows to sections in
// the allowed list. Empty list → no rows; null → no filter.
function applyTeacherFilter(
  rows: MarkbookDrillRow[],
  kind: MarkbookDrillRowKind,
  allowedSectionIds: string[] | null,
): MarkbookDrillRow[] {
  if (allowedSectionIds === null) return rows;
  const allow = new Set(allowedSectionIds);
  if (kind === 'entry') {
    return (rows as GradeEntryRow[]).filter((r) => allow.has(r.sectionId)) as MarkbookDrillRow[];
  }
  if (kind === 'sheet') {
    return (rows as SheetRow[]).filter((r) => allow.has(r.sectionId)) as MarkbookDrillRow[];
  }
  return (rows as ChangeRequestRow[]).filter((r) => allow.has(r.sectionId)) as MarkbookDrillRow[];
}

// ---------------------------------------------------------------------------
// Target filter — narrow universal row set to the rows the user expected.

export function applyTargetFilter(
  rows: MarkbookDrillRow[],
  target: MarkbookDrillTarget,
  segment?: string | null,
): MarkbookDrillRow[] {
  switch (target) {
    case 'grade-entries':
      return rows;
    case 'sheets-locked':
      return (rows as SheetRow[]).filter((r) => r.isLocked) as MarkbookDrillRow[];
    case 'change-requests':
      if (!segment) return rows;
      return (rows as ChangeRequestRow[]).filter((r) => r.status === segment) as MarkbookDrillRow[];
    case 'publication-coverage':
      if (!segment) return rows;
      if (segment === 'published') {
        return (rows as SheetRow[]).filter((r) => r.isPublished) as MarkbookDrillRow[];
      }
      if (segment === 'not-published') {
        return (rows as SheetRow[]).filter((r) => !r.isPublished) as MarkbookDrillRow[];
      }
      return rows;
    case 'grade-bucket-entries': {
      if (!segment) return rows;
      // Accept either the bucket key ('o', 'vs', …) or the bucket label.
      const key =
        (segment as GradeBucketKey) in GRADE_BUCKET_LABEL
          ? (segment as GradeBucketKey)
          : findBucketByLabel(segment);
      if (!key) return rows;
      return (rows as GradeEntryRow[]).filter((r) => r.gradeBucket === key) as MarkbookDrillRow[];
    }
    case 'term-sheet-status': {
      // segment format: "T<n>:<status>" where status ∈ {locked, open}.
      // Backwards-compatible: bare "T<n>" returns all sheets in that term.
      if (!segment) return rows;
      const m = /^T(\d+)(?::(locked|open))?$/i.exec(segment);
      if (!m) return rows;
      const termNumber = Number(m[1]);
      const status = (m[2] ?? '').toLowerCase() as 'locked' | 'open' | '';
      return (rows as SheetRow[]).filter((r) => {
        if (r.termNumber !== termNumber) return false;
        if (status === 'locked') return r.isLocked;
        if (status === 'open') return !r.isLocked;
        return true;
      }) as MarkbookDrillRow[];
    }
    case 'term-publication-status': {
      if (!segment) return rows;
      const m = /^T(\d+)(?::(published|not-published))?$/i.exec(segment);
      if (!m) return rows;
      const termNumber = Number(m[1]);
      const status = (m[2] ?? '').toLowerCase() as 'published' | 'not-published' | '';
      return (rows as SheetRow[]).filter((r) => {
        if (r.termNumber !== termNumber) return false;
        if (status === 'published') return r.isPublished;
        if (status === 'not-published') return !r.isPublished;
        return true;
      }) as MarkbookDrillRow[];
    }
    case 'sheet-readiness-section': {
      // Segment = section name. Show non-locked sheets in that section so
      // the user sees the open-sheet backlog drilled-into.
      if (!segment) {
        return (rows as SheetRow[]).filter((r) => !r.isLocked) as MarkbookDrillRow[];
      }
      return (rows as SheetRow[]).filter(
        (r) => r.sectionName === segment && !r.isLocked,
      ) as MarkbookDrillRow[];
    }
    case 'teacher-entry-velocity': {
      // Segment = teacher email. Show entries by that teacher; if no segment,
      // return all entries (teacher view will still group by enteredBy).
      if (!segment) return rows;
      return (rows as GradeEntryRow[]).filter((r) => r.enteredBy === segment) as MarkbookDrillRow[];
    }
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-target column defaults

export type DrillColumnKey =
  // Entry-only
  | 'studentName'
  | 'studentNumber'
  | 'subjectCode'
  | 'termNumber'
  | 'rawScore'
  | 'computedGrade'
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
  studentNumber: 'Student #',
  subjectCode: 'Subject',
  termNumber: 'Term',
  rawScore: 'Raw',
  computedGrade: 'Grade',
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

const ENTRY_ALL_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'studentNumber',
  'subjectCode',
  'sectionName',
  'level',
  'termNumber',
  'rawScore',
  'computedGrade',
  'gradeBucket',
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

export function allColumnsForKind(kind: MarkbookDrillRowKind): DrillColumnKey[] {
  if (kind === 'entry') return ENTRY_ALL_COLUMNS;
  if (kind === 'sheet') return SHEET_ALL_COLUMNS;
  return CR_ALL_COLUMNS;
}

export function defaultColumnsForTarget(target: MarkbookDrillTarget): DrillColumnKey[] {
  switch (target) {
    case 'grade-entries':
      return ['studentName', 'subjectCode', 'sectionName', 'computedGrade', 'gradeBucket', 'enteredAt'];
    case 'grade-bucket-entries':
      return ['studentName', 'subjectCode', 'sectionName', 'computedGrade', 'enteredAt'];
    case 'teacher-entry-velocity':
      return ['enteredBy', 'studentName', 'subjectCode', 'sectionName', 'computedGrade', 'enteredAt'];
    case 'sheets-locked':
      return ['sectionName', 'subjectCode', 'termNumber', 'isLocked', 'lockedAt', 'completeness'];
    case 'publication-coverage':
    case 'term-publication-status':
      return ['sectionName', 'subjectCode', 'termNumber', 'publishedAt', 'isLocked'];
    case 'term-sheet-status':
      return ['sectionName', 'subjectCode', 'termNumber', 'isLocked', 'lockedAt', 'completeness'];
    case 'sheet-readiness-section':
      return ['sectionName', 'subjectCode', 'termNumber', 'completeness', 'isLocked'];
    case 'change-requests':
      return ['sectionName', 'subjectCode', 'fieldChanged', 'status', 'requestedBy', 'requestedAt'];
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
  segment?: string | null,
): { eyebrow: string; title: string } {
  switch (target) {
    case 'grade-entries':
      return { eyebrow: 'Drill · Grade entries', title: 'Grade entries in scope' };
    case 'sheets-locked':
      return { eyebrow: 'Drill · Sheets locked', title: 'Locked grading sheets' };
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
