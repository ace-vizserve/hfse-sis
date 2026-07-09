import { unstable_cache } from 'next/cache';

import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTerm } from '@/lib/sis/current-term';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Evaluation drill primitives — single row shape (WriteupRow). Simpler than
// Markbook/Attendance because the underlying table is uniform.

const CACHE_TTL_SECONDS = 60;

function tags(ayCode: string): string[] {
  return ['evaluation-drill', `evaluation-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

export type EvaluationDrillTarget =
  | 'submission-status' // sections × submission %
  | 'submitted' // submitted writeups
  | 'submission-velocity-day' // writeups submitted on a specific day
  | 'writeups-by-section' // section × counts
  | 'outstanding-writeups' // chase: students missing a submitted, non-empty write-up (current term, live-state)
  | 'advisers-behind'; // chase: form advisers with ≥1 outstanding write-up (current term, live-state)

// ─── Row shapes ─────────────────────────────────────────────────────────────

export type WriteupRow = {
  writeupId: string | null; // null when missing
  termId: string;
  termNumber: number;
  sectionId: string;
  sectionName: string;
  level: string | null;
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  adviserId: string | null;
  adviserEmail: string | null;
  status: 'submitted' | 'draft' | 'missing';
  draftCharCount: number;
  submittedAt: string | null;
  daysToSubmit: number | null;
};

export type SectionWriteupRow = {
  sectionId: string;
  sectionName: string;
  level: string | null;
  termNumber: number;
  total: number;
  submitted: number;
  draft: number;
  missing: number;
  submissionPct: number;
};

// Chase row: one outstanding student (current term, live-state). Used by the
// `outstanding-writeups` drill — the registrar's worklist.
export type OutstandingWriteupRow = {
  studentNumber: string;
  studentName: string;
  sectionName: string;
  adviserName: string | null; // null = no form adviser assigned to the section
};

// Chase row: one form adviser who is behind this term (current term,
// live-state). Used by the `advisers-behind` drill. `adviserName === null`
// is the "Unassigned section" bucket — surfaced, never dropped.
export type AdviserBehindRow = {
  adviserName: string | null; // null = sections with no form adviser
  outstanding: number;
  sections: string;
};

export type EvaluationDrillRow =
  | WriteupRow
  | SectionWriteupRow
  | OutstandingWriteupRow
  | AdviserBehindRow;

export type EvaluationDrillRowKind =
  | 'writeup'
  | 'section-rollup'
  | 'outstanding'
  | 'adviser-behind';

export function rowKindForTarget(
  t: EvaluationDrillTarget
): EvaluationDrillRowKind {
  switch (t) {
    case 'submission-status':
    case 'submitted':
    case 'submission-velocity-day':
      return 'writeup';
    case 'writeups-by-section':
      return 'section-rollup';
    case 'outstanding-writeups':
      return 'outstanding';
    case 'advisers-behind':
      return 'adviser-behind';
    default: {
      const _exhaustive: never = t;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  from?: string;
  to?: string;
  /** When set, only include sections in this list (form-adviser scoping). */
  allowedSectionIds?: string[] | null;
};

// ─── Loaders ────────────────────────────────────────────────────────────────

type SectionLite = { id: string; name: string; level_id: string };
type StudentSectionLite = {
  id: string;
  section_id: string;
  student_id: string;
  enrollment_status: string;
};
export type StudentLite = {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  student_number: string;
};
type TermLite = { id: string; term_number: number };
type LevelLite = { id: string; code: string };

// Schema: evaluation_writeups (migration 018) uses `student_id` + `section_id`
// (not `section_student_id`) and `writeup` (not `draft_text`). The earlier
// shape with the wrong column names returned a 400 from PostgREST, leaving
// every drill empty across all AYs.
type WriteupRecord = {
  id: string;
  student_id: string;
  section_id: string;
  term_id: string;
  writeup: string | null;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type EvalTermRecord = { term_id: string; opened_at: string | null };

type AdviserAssignment = {
  teacher_user_id: string;
  section_id: string;
  role: string;
};

function studentName(s: StudentLite): string {
  const parts = [s.first_name, s.middle_name, s.last_name].filter(Boolean);
  const name = parts.join(' ').trim();
  return name || s.student_number || s.id;
}

async function loadWriteupRowsUncached(ayCode: string): Promise<WriteupRow[]> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) return [];

  const [termsRes, sectionsRes, levelsRes, advisersRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', ayId)
      .neq('term_number', 4),
    service
      .from('sections')
      .select('id, name, level_id')
      .eq('academic_year_id', ayId),
    service.from('levels').select('id, code'),
    service
      .from('teacher_assignments')
      .select('teacher_user_id, section_id, role')
      .eq('role', 'form_adviser'),
  ]);

  const terms = (termsRes.data ?? []) as TermLite[];
  const termIds = terms.map((t) => t.id);
  const termById = new Map<string, TermLite>();
  for (const t of terms) termById.set(t.id, t);

  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const sectionById = new Map<string, SectionLite>();
  for (const s of sections) sectionById.set(s.id, s);
  const sectionIds = sections.map((s) => s.id);

  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[])
    levels.set(l.id, l.code);

  const adviserBySection = new Map<string, string>();
  for (const a of (advisersRes.data ?? []) as AdviserAssignment[]) {
    if (!adviserBySection.has(a.section_id))
      adviserBySection.set(a.section_id, a.teacher_user_id);
  }

  if (sectionIds.length === 0 || termIds.length === 0) return [];

  // Section students — active roster (active + late_enrollee, i.e. not
  // withdrawn) per KD #120, matching the KPI loaders + the chase loader so the
  // submission/submitted drills agree with their card counts (a late enrollee
  // still owes a write-up).
  const { data: ssRows } = await service
    .from('section_students')
    .select('id, section_id, student_id, enrollment_status')
    .in('section_id', sectionIds)
    .neq('enrollment_status', 'withdrawn');
  const ss = (ssRows ?? []) as StudentSectionLite[];
  const ssById = new Map<string, StudentSectionLite>();
  for (const s of ss) ssById.set(s.id, s);

  const studentIds = Array.from(new Set(ss.map((s) => s.student_id)));
  const studentMap = new Map<string, StudentLite>();
  if (studentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 100)
      chunks.push(studentIds.slice(i, i + 100));
    for (const chunk of chunks) {
      const { data: studs } = await service
        .from('students')
        .select('id, first_name, middle_name, last_name, student_number')
        .in('id', chunk);
      for (const s of (studs ?? []) as StudentLite[]) studentMap.set(s.id, s);
    }
  }

  // Paginated around PostgREST's 1000-row cap — ~490 enrolled students ×
  // 3 terms (T1-T3, T4 excluded per KD #49) routinely exceeds it.
  const writeups = await fetchAllPages<WriteupRecord>((from, to) =>
    service
      .from('evaluation_writeups')
      .select(
        'id, student_id, section_id, term_id, writeup, submitted, submitted_at, created_at, updated_at'
      )
      .in('term_id', termIds)
      .range(from, to)
  );
  // Writeup uniqueness in DB is (term_id, student_id) per migration 018 —
  // key the lookup map by student id, not section_student id, so the join
  // below resolves correctly.
  const writeupKey = (studentId: string, termId: string) =>
    `${studentId}|${termId}`;
  const writeupByKey = new Map<string, WriteupRecord>();
  for (const w of writeups)
    writeupByKey.set(writeupKey(w.student_id, w.term_id), w);

  const { data: evalTermRows } = await service
    .from('evaluation_terms')
    .select('term_id, opened_at')
    .in('term_id', termIds);
  const openedAtByTerm = new Map<string, string | null>();
  for (const r of (evalTermRows ?? []) as EvalTermRecord[])
    openedAtByTerm.set(r.term_id, r.opened_at);

  const adviserUserIds = Array.from(
    new Set(Array.from(adviserBySection.values()))
  );
  const allEmails = new Map(await getTeacherEmailMap());
  const adviserEmailById = new Map<string, string>();
  for (const id of adviserUserIds) {
    const email = allEmails.get(id);
    if (email) adviserEmailById.set(id, email);
  }

  const out: WriteupRow[] = [];
  for (const term of terms) {
    for (const sectionStudent of ss) {
      const section = sectionById.get(sectionStudent.section_id);
      if (!section) continue;
      const student = studentMap.get(sectionStudent.student_id);
      if (!student) continue;
      const w = writeupByKey.get(
        writeupKey(sectionStudent.student_id, term.id)
      );
      const draftLen = (w?.writeup ?? '').trim().length;
      // KD #120: 'submitted' requires the submitted flag AND non-empty content
      // — an emptied-but-still-submitted write-up reads as 'missing' (matches
      // the KPI numerator in lib/evaluation/dashboard.ts::kpisFrom, the chase
      // loader below, and publish-readiness; count == drill per KD #124).
      let status: WriteupRow['status'] = 'missing';
      if (w?.submitted && draftLen > 0) status = 'submitted';
      else if (draftLen > 0) status = 'draft';

      let daysToSubmit: number | null = null;
      if (w?.submitted_at) {
        const openedAt = openedAtByTerm.get(term.id) ?? null;
        const start = openedAt
          ? Date.parse(openedAt)
          : Date.parse(w.created_at);
        const end = Date.parse(w.submitted_at);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          daysToSubmit = Math.round((end - start) / 86_400_000);
        }
      }

      const adviserId = adviserBySection.get(section.id) ?? null;
      out.push({
        writeupId: w?.id ?? null,
        termId: term.id,
        termNumber: term.term_number,
        sectionId: section.id,
        sectionName: section.name,
        level: levels.get(section.level_id) ?? null,
        studentSectionId: sectionStudent.id,
        studentName: studentName(student),
        studentNumber: student.student_number,
        adviserId,
        adviserEmail: adviserId
          ? (adviserEmailById.get(adviserId) ?? null)
          : null,
        status,
        draftCharCount: draftLen,
        submittedAt: w?.submitted_at ?? null,
        daysToSubmit,
      });
    }
  }
  return out;
}

function loadWriteupRows(ayCode: string): Promise<WriteupRow[]> {
  return unstable_cache(
    () => loadWriteupRowsUncached(ayCode),
    ['evaluation-drill', 'rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ─── Chase state (live, current-term only) ───────────────────────────────────
//
// The chase metrics are LIVE STATE — the current gap right now — scoped to the
// picker's resolved current term (KD #124 `resolveCurrentTerm`), NOT
// date-windowed. So the count and the drill share the exact same row set
// (count == drill). T4 has no FCA write-up (KD #49) → returns `null` so the
// dashboard can render "—" without ever running the queries.
//
// "Has a write-up" = a row with `submitted = true` AND non-empty content
// (matches the KD #120 submitted-count rule). Roster is resolved by the live
// `section_students` (`enrollment_status != 'withdrawn'`) tallied by
// `student_id` — never the denormalized `evaluation_writeups.section_id`, which
// doesn't follow a mid-year transfer (KD #67/#120).

export type EvaluationChaseState = {
  termId: string;
  termNumber: number;
  outstanding: OutstandingWriteupRow[];
  advisersBehind: AdviserBehindRow[];
  /** True when ≥1 section with outstanding write-ups has no form adviser. */
  hasUnassignedSection: boolean;
};

type SgTodayFn = () => string;

async function loadChaseStateUncached(
  ayCode: string,
  getToday: SgTodayFn
): Promise<EvaluationChaseState | null> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) return null;

  // Resolve the current term from the date (KD #124). T4 carries no FCA
  // write-up (KD #49) so it's never a chase target — return null → "—".
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current')
    .eq('academic_year_id', ayId);
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean | null;
  }>;
  if (terms.length === 0) return null;

  const currentTerm = resolveCurrentTerm(terms, getToday());
  if (!currentTerm || currentTerm.term_number === 4) return null;
  const termId = currentTerm.id;
  const termNumber = currentTerm.term_number;

  // Sections + their form adviser (first wins, mirrors loadWriteupRows).
  const [sectionsRes, advisersRes] = await Promise.all([
    service.from('sections').select('id, name').eq('academic_year_id', ayId),
    service
      .from('teacher_assignments')
      .select('teacher_user_id, section_id, role')
      .eq('role', 'form_adviser'),
  ]);
  const sections = (sectionsRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const sectionById = new Map(sections.map((s) => [s.id, s.name]));
  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) {
    return {
      termId,
      termNumber,
      outstanding: [],
      advisersBehind: [],
      hasUnassignedSection: false,
    };
  }

  const adviserBySection = new Map<string, string>();
  for (const a of (advisersRes.data ?? []) as AdviserAssignment[]) {
    if (!adviserBySection.has(a.section_id))
      adviserBySection.set(a.section_id, a.teacher_user_id);
  }

  // Live roster — active + late_enrollee (everything not withdrawn), tallied by
  // the student's CURRENT section (KD #120 transfer-safe).
  const { data: ssRows } = await service
    .from('section_students')
    .select('section_id, student_id, enrollment_status')
    .in('section_id', sectionIds)
    .neq('enrollment_status', 'withdrawn');
  const roster = (ssRows ?? []) as Array<{
    section_id: string;
    student_id: string;
  }>;
  const studentIds = Array.from(new Set(roster.map((r) => r.student_id)));

  // Students with a SUBMITTED, NON-EMPTY write-up this term.
  const submittedStudentIds = new Set<string>();
  if (studentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 100)
      chunks.push(studentIds.slice(i, i + 100));
    for (const chunk of chunks) {
      const { data: wRows } = await service
        .from('evaluation_writeups')
        .select('student_id, writeup')
        .eq('term_id', termId)
        .eq('submitted', true)
        .in('student_id', chunk);
      for (const w of (wRows ?? []) as Array<{
        student_id: string;
        writeup: string | null;
      }>) {
        if (w.writeup && w.writeup.trim().length > 0)
          submittedStudentIds.add(w.student_id);
      }
    }
  }

  // Student names for the outstanding worklist.
  const outstandingStudentIds = Array.from(
    new Set(
      roster
        .filter((r) => !submittedStudentIds.has(r.student_id))
        .map((r) => r.student_id)
    )
  );
  const studentMap = new Map<string, StudentLite>();
  if (outstandingStudentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < outstandingStudentIds.length; i += 100)
      chunks.push(outstandingStudentIds.slice(i, i + 100));
    for (const chunk of chunks) {
      const { data: studs } = await service
        .from('students')
        .select('id, first_name, middle_name, last_name, student_number')
        .in('id', chunk);
      for (const s of (studs ?? []) as StudentLite[]) studentMap.set(s.id, s);
    }
  }

  // Adviser display names (userId → name) via email → name join.
  const adviserUserIds = Array.from(new Set(adviserBySection.values()));
  const emailByUserId = new Map(await getTeacherEmailMap());
  const nameByEmail = new Map(await getStaffDisplayEntries());
  const adviserNameById = new Map<string, string>();
  for (const id of adviserUserIds) {
    const email = emailByUserId.get(id);
    const name = email ? nameByEmail.get(email) : undefined;
    adviserNameById.set(id, name ?? email ?? 'Unknown adviser');
  }

  return buildChaseState({
    roster,
    submittedStudentIds,
    sectionById,
    adviserBySection,
    studentMap,
    adviserNameById,
    termId,
    termNumber,
  });
}

/**
 * Pure aggregator: given already-fetched maps, build the
 * `EvaluationChaseState` payload (outstanding write-up rows + per-adviser
 * rollup). Exported so it can be unit-tested without a Supabase service
 * client or `unstable_cache`.
 *
 * NOTE: this function is called by `loadChaseStateUncached` after all DB
 * fetches are done. It contains the business rules only — no I/O.
 */
export function buildChaseState({
  roster,
  submittedStudentIds,
  sectionById,
  adviserBySection,
  studentMap,
  adviserNameById,
  termId,
  termNumber,
}: {
  /** Active roster: every non-withdrawn student × their section for this AY + term */
  roster: Array<{ section_id: string; student_id: string }>;
  /** Students who have a submitted + non-empty write-up for this term */
  submittedStudentIds: Set<string>;
  /** section_id → section name */
  sectionById: Map<string, string>;
  /** section_id → adviser userId (first-wins; undefined = no adviser) */
  adviserBySection: Map<string, string>;
  /** student_id → student info */
  studentMap: Map<string, StudentLite>;
  /** adviser userId → display name */
  adviserNameById: Map<string, string>;
  termId: string;
  termNumber: number;
}): EvaluationChaseState {
  // Build the outstanding rows + per-adviser rollup in one pass.
  const outstanding: OutstandingWriteupRow[] = [];
  // adviserKey: userId for assigned advisers, '__unassigned__' for the bucket.
  const UNASSIGNED = '__unassigned__';
  type AdviserAcc = {
    adviserName: string | null;
    outstanding: number;
    sectionNames: Set<string>;
  };
  const adviserAcc = new Map<string, AdviserAcc>();

  for (const r of roster) {
    if (submittedStudentIds.has(r.student_id)) continue;
    const sectionName = sectionById.get(r.section_id) ?? 'Section';
    const adviserId = adviserBySection.get(r.section_id) ?? null;
    const adviserName = adviserId
      ? (adviserNameById.get(adviserId) ?? null)
      : null;
    const student = studentMap.get(r.student_id);

    outstanding.push({
      studentNumber: student?.student_number ?? '',
      studentName: student ? studentName(student) : r.student_id,
      sectionName,
      adviserName,
    });

    const key = adviserId ?? UNASSIGNED;
    let acc = adviserAcc.get(key);
    if (!acc) {
      acc = { adviserName, outstanding: 0, sectionNames: new Set() };
      adviserAcc.set(key, acc);
    }
    acc.outstanding += 1;
    acc.sectionNames.add(sectionName);
  }

  outstanding.sort(
    (a, b) =>
      a.sectionName.localeCompare(b.sectionName) ||
      a.studentName.localeCompare(b.studentName)
  );

  const advisersBehind: AdviserBehindRow[] = Array.from(adviserAcc.values())
    .map((a) => ({
      adviserName: a.adviserName,
      outstanding: a.outstanding,
      sections: Array.from(a.sectionNames).sort().join(', '),
    }))
    // Biggest gap first; the Unassigned bucket (null name) sorts last on ties.
    .sort(
      (a, b) =>
        b.outstanding - a.outstanding ||
        (a.adviserName ?? '￿').localeCompare(b.adviserName ?? '￿')
    );

  return {
    termId,
    termNumber,
    outstanding,
    advisersBehind,
    hasUnassignedSection: adviserAcc.has(UNASSIGNED),
  };
}

// Cached live-state chase loader. 60s TTL like the rest of the drill layer;
// the eval-drill tag means a write-up submit invalidates it.
export function loadEvaluationChaseState(
  ayCode: string,
  getToday: SgTodayFn = sgToday
): Promise<EvaluationChaseState | null> {
  return unstable_cache(
    () => loadChaseStateUncached(ayCode, getToday),
    ['evaluation-drill', 'chase-state', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ─── Aggregators ────────────────────────────────────────────────────────────

function rollupBySection(rows: WriteupRow[]): SectionWriteupRow[] {
  type Acc = {
    sectionId: string;
    sectionName: string;
    level: string | null;
    termNumber: number;
    total: number;
    submitted: number;
    draft: number;
    missing: number;
  };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const key = `${r.sectionId}|${r.termNumber}`;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        sectionId: r.sectionId,
        sectionName: r.sectionName,
        level: r.level,
        termNumber: r.termNumber,
        total: 0,
        submitted: 0,
        draft: 0,
        missing: 0,
      };
      map.set(key, acc);
    }
    acc.total += 1;
    if (r.status === 'submitted') acc.submitted += 1;
    else if (r.status === 'draft') acc.draft += 1;
    else acc.missing += 1;
  }
  const out: SectionWriteupRow[] = [];
  for (const a of map.values()) {
    out.push({
      sectionId: a.sectionId,
      sectionName: a.sectionName,
      level: a.level,
      termNumber: a.termNumber,
      total: a.total,
      submitted: a.submitted,
      draft: a.draft,
      missing: a.missing,
      submissionPct:
        a.total > 0 ? Math.round((a.submitted / a.total) * 100) : 0,
    });
  }
  out.sort((a, b) => a.submissionPct - b.submissionPct);
  return out;
}

// ─── Public builders ────────────────────────────────────────────────────────

export type BuildDrillRowsInput = DrillRangeInput & {
  target: EvaluationDrillTarget;
  segment?: string | null;
};

function applyScope(rows: WriteupRow[], input: DrillRangeInput): WriteupRow[] {
  // Drafts / never-submitted writeups always pass — they're "in progress"
  // and a date-range view should still surface them.
  return applyDateRangeFilter(rows, input, (r) => r.submittedAt, {
    caller: 'evaluation/drill',
    includeMissingDate: true,
  });
}

function applyAllowedSections(
  rows: WriteupRow[],
  allowed: string[] | null | undefined
): WriteupRow[] {
  if (!allowed) return rows;
  const set = new Set(allowed);
  return rows.filter((r) => set.has(r.sectionId));
}

export async function buildEvaluationDrillRows(
  input: BuildDrillRowsInput
): Promise<EvaluationDrillRow[]> {
  const kind = rowKindForTarget(input.target);

  // Chase targets are LIVE STATE — current-term only, no date scoping (count ==
  // drill). They never go through the date-windowed write-up row set.
  if (kind === 'outstanding' || kind === 'adviser-behind') {
    // Chase is registrar/oversight-only and live-state — no date scoping, no
    // section narrowing (allowedSectionIds is always null here).
    const chase = await loadEvaluationChaseState(input.ayCode);
    if (!chase) return []; // T4 / no term → "—"
    return (
      kind === 'outstanding' ? chase.outstanding : chase.advisersBehind
    ) as EvaluationDrillRow[];
  }

  const all = await loadWriteupRows(input.ayCode);
  const scoped = applyAllowedSections(
    applyScope(all, input),
    input.allowedSectionIds ?? null
  );

  if (kind === 'writeup') {
    return applyTargetFilter(
      scoped,
      input.target,
      input.segment ?? null
    ) as EvaluationDrillRow[];
  }
  // section-rollup
  return rollupBySection(scoped) as EvaluationDrillRow[];
}

export async function buildAllRowSets(input: {
  ayCode: string;
  from?: string;
  to?: string;
  allowedSectionIds?: string[] | null;
}): Promise<{
  writeups: WriteupRow[];
  bySection: SectionWriteupRow[];
}> {
  const all = await loadWriteupRows(input.ayCode);
  const scoped = applyAllowedSections(
    applyScope(all, { ayCode: input.ayCode, from: input.from, to: input.to }),
    input.allowedSectionIds ?? null
  );
  return {
    writeups: scoped,
    bySection: rollupBySection(scoped),
  };
}

// ─── Target filter ──────────────────────────────────────────────────────────

function applyTargetFilter(
  rows: WriteupRow[],
  target: EvaluationDrillTarget,
  segment: string | null
): WriteupRow[] {
  switch (target) {
    case 'submission-status':
      return rows;
    case 'submitted':
      return rows.filter((r) => r.status === 'submitted');
    case 'submission-velocity-day':
      if (!segment) return rows;
      return rows.filter((r) => r.submittedAt?.slice(0, 10) === segment);
    case 'writeups-by-section':
      return rows; // not used directly; handled at kind level
    default:
      return rows;
  }
}

// ─── Per-target columns ─────────────────────────────────────────────────────

export type DrillColumnKey =
  | 'studentName'
  | 'studentNumber'
  | 'sectionName'
  | 'level'
  | 'termNumber'
  | 'status'
  | 'draftCharCount'
  | 'submittedAt'
  | 'daysToSubmit'
  | 'adviserEmail'
  | 'submissionPct'
  | 'submitted'
  | 'draft'
  | 'missing'
  | 'total'
  | 'adviserName'
  | 'outstandingCount'
  | 'sections';

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  studentName: 'Student',
  studentNumber: 'Student ID',
  sectionName: 'Section',
  level: 'Level',
  termNumber: 'Term',
  status: 'Status',
  draftCharCount: 'Draft length',
  submittedAt: 'Submitted',
  daysToSubmit: 'Days to submit',
  adviserEmail: 'Adviser',
  submissionPct: 'Submission %',
  submitted: 'Submitted',
  draft: 'Draft',
  missing: 'Missing',
  total: 'Total',
  adviserName: 'Form adviser',
  outstandingCount: 'Outstanding',
  sections: 'Section(s)',
};

const WRITEUP_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'level',
  'termNumber',
  'status',
  'submittedAt',
  'daysToSubmit',
];
const SECTION_COLUMNS: DrillColumnKey[] = [
  'sectionName',
  'level',
  'termNumber',
  'submissionPct',
  'submitted',
  'draft',
  'missing',
  'total',
];
const OUTSTANDING_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'adviserName',
];
const ADVISER_BEHIND_COLUMNS: DrillColumnKey[] = [
  'adviserName',
  'outstandingCount',
  'sections',
];

export function allColumnsForKind(
  kind: EvaluationDrillRowKind
): DrillColumnKey[] {
  switch (kind) {
    case 'writeup':
      return WRITEUP_COLUMNS;
    case 'section-rollup':
      return SECTION_COLUMNS;
    case 'outstanding':
      return OUTSTANDING_COLUMNS;
    case 'adviser-behind':
      return ADVISER_BEHIND_COLUMNS;
  }
}

export function defaultColumnsForTarget(
  target: EvaluationDrillTarget
): DrillColumnKey[] {
  return allColumnsForKind(rowKindForTarget(target));
}

export function drillHeaderForTarget(
  target: EvaluationDrillTarget,
  segment: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'submission-status':
      return {
        eyebrow: 'Drill · Submission',
        title: 'Writeup submission status',
      };
    case 'submitted':
      return { eyebrow: 'Drill · Submitted', title: 'Submitted writeups' };
    case 'submission-velocity-day':
      return {
        eyebrow: 'Drill · Daily',
        title: segment ? `Submitted on ${segment}` : 'Submission velocity',
      };
    case 'writeups-by-section':
      return { eyebrow: 'Drill · By section', title: 'Writeups by section' };
    case 'outstanding-writeups':
      return {
        eyebrow: 'Drill · Outstanding',
        title: 'Outstanding write-ups (this term)',
      };
    case 'advisers-behind':
      return {
        eyebrow: 'Drill · Advisers behind',
        title: 'Form advisers behind (this term)',
      };
    default:
      return { eyebrow: 'Drill', title: 'Evaluation' };
  }
}
