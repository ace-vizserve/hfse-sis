import { unstable_cache } from 'next/cache';

import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { createServiceClient } from '@/lib/supabase/service';

// Evaluation drill primitives — single row shape (WriteupRow). Simpler than
// Markbook/Attendance because the underlying table is uniform.

const CACHE_TTL_SECONDS = 60;

function tags(ayCode: string): string[] {
  return ['evaluation-drill', `evaluation-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

export type EvaluationDrillTarget =
  | 'submission-status'        // sections × submission %
  | 'submitted'                 // submitted writeups
  | 'time-to-submit'            // submitted with daysToSubmit
  | 'late'                      // submissions >14d
  | 'submission-velocity-day'   // writeups submitted on a specific day
  | 'writeups-by-section'       // section × counts
  | 'time-to-submit-bucket';    // bucket bars (0-3d/4-7d/8-14d/>14d)

export type DrillScope = 'range' | 'ay' | 'all';

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

export type TimeToSubmitBucket = {
  label: string;
  loDays: number;
  hiDays: number | null;
  count: number;
};

export type EvaluationDrillRow = WriteupRow | SectionWriteupRow | TimeToSubmitBucket;

export type EvaluationDrillRowKind = 'writeup' | 'section-rollup' | 'bucket';

export function rowKindForTarget(t: EvaluationDrillTarget): EvaluationDrillRowKind {
  switch (t) {
    case 'submission-status':
    case 'submitted':
    case 'time-to-submit':
    case 'late':
    case 'submission-velocity-day':
      return 'writeup';
    case 'writeups-by-section':
      return 'section-rollup';
    case 'time-to-submit-bucket':
      return 'bucket';
    default: {
      const _exhaustive: never = t;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
  /** When set, only include sections in this list (form-adviser scoping). */
  allowedSectionIds?: string[] | null;
};

// ─── Loaders ────────────────────────────────────────────────────────────────

type SectionLite = { id: string; name: string; level_id: string };
type StudentSectionLite = { id: string; section_id: string; student_id: string; enrollment_status: string };
type StudentLite = { id: string; first_name: string | null; middle_name: string | null; last_name: string | null; student_number: string };
type TermLite = { id: string; term_number: number };
type LevelLite = { id: string; code: string };

type WriteupRecord = {
  id: string;
  section_student_id: string;
  term_id: string;
  draft_text: string | null;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type EvalTermRecord = { term_id: string; opened_at: string | null };

type AdviserAssignment = { teacher_user_id: string; section_id: string; role: string };

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
    service.from('sections').select('id, name, level_id').eq('academic_year_id', ayId),
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
  for (const l of (levelsRes.data ?? []) as LevelLite[]) levels.set(l.id, l.code);

  const adviserBySection = new Map<string, string>();
  for (const a of (advisersRes.data ?? []) as AdviserAssignment[]) {
    if (!adviserBySection.has(a.section_id)) adviserBySection.set(a.section_id, a.teacher_user_id);
  }

  if (sectionIds.length === 0 || termIds.length === 0) return [];

  // Section students (active only)
  const { data: ssRows } = await service
    .from('section_students')
    .select('id, section_id, student_id, enrollment_status')
    .in('section_id', sectionIds)
    .eq('enrollment_status', 'active');
  const ss = (ssRows ?? []) as StudentSectionLite[];
  const ssById = new Map<string, StudentSectionLite>();
  for (const s of ss) ssById.set(s.id, s);

  const studentIds = Array.from(new Set(ss.map((s) => s.student_id)));
  const studentMap = new Map<string, StudentLite>();
  if (studentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 500) chunks.push(studentIds.slice(i, i + 500));
    for (const chunk of chunks) {
      const { data: studs } = await service
        .from('students')
        .select('id, first_name, middle_name, last_name, student_number')
        .in('id', chunk);
      for (const s of (studs ?? []) as StudentLite[]) studentMap.set(s.id, s);
    }
  }

  const { data: writeupsRows } = await service
    .from('evaluation_writeups')
    .select('id, section_student_id, term_id, draft_text, submitted, submitted_at, created_at, updated_at')
    .in('term_id', termIds);
  const writeups = (writeupsRows ?? []) as WriteupRecord[];
  const writeupKey = (ssId: string, termId: string) => `${ssId}|${termId}`;
  const writeupByKey = new Map<string, WriteupRecord>();
  for (const w of writeups) writeupByKey.set(writeupKey(w.section_student_id, w.term_id), w);

  const { data: evalTermRows } = await service
    .from('evaluation_terms')
    .select('term_id, opened_at')
    .in('term_id', termIds);
  const openedAtByTerm = new Map<string, string | null>();
  for (const r of (evalTermRows ?? []) as EvalTermRecord[]) openedAtByTerm.set(r.term_id, r.opened_at);

  const adviserUserIds = Array.from(new Set(Array.from(adviserBySection.values())));
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
      const w = writeupByKey.get(writeupKey(sectionStudent.id, term.id));
      const draftLen = (w?.draft_text ?? '').trim().length;
      let status: WriteupRow['status'] = 'missing';
      if (w?.submitted) status = 'submitted';
      else if (draftLen > 0) status = 'draft';

      let daysToSubmit: number | null = null;
      if (w?.submitted_at) {
        const openedAt = openedAtByTerm.get(term.id) ?? null;
        const start = openedAt ? Date.parse(openedAt) : Date.parse(w.created_at);
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
        adviserEmail: adviserId ? adviserEmailById.get(adviserId) ?? null : null,
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
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}

// ─── Aggregators ────────────────────────────────────────────────────────────

const TIME_BUCKETS = [
  { label: '0–3d', lo: 0, hi: 3 },
  { label: '4–7d', lo: 4, hi: 7 },
  { label: '8–14d', lo: 8, hi: 14 },
  { label: '>14d', lo: 15, hi: null as number | null },
] as const;

function rollupBuckets(rows: WriteupRow[]): TimeToSubmitBucket[] {
  const out: TimeToSubmitBucket[] = TIME_BUCKETS.map((b) => ({
    label: b.label, loDays: b.lo, hiDays: b.hi, count: 0,
  }));
  for (const r of rows) {
    if (r.daysToSubmit == null) continue;
    const idx = out.findIndex((b) => r.daysToSubmit! >= b.loDays && (b.hiDays == null || r.daysToSubmit! <= b.hiDays));
    if (idx >= 0) out[idx].count += 1;
  }
  return out;
}

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
        total: 0, submitted: 0, draft: 0, missing: 0,
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
      submissionPct: a.total > 0 ? Math.round((a.submitted / a.total) * 100) : 0,
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
  if (input.scope !== 'range' || !input.from || !input.to) return rows;
  return rows.filter((r) => {
    if (!r.submittedAt) return true; // include missing/drafts in range view
    const d = r.submittedAt.slice(0, 10);
    return d >= input.from! && d <= input.to!;
  });
}

function applyAllowedSections(rows: WriteupRow[], allowed: string[] | null | undefined): WriteupRow[] {
  if (!allowed) return rows;
  const set = new Set(allowed);
  return rows.filter((r) => set.has(r.sectionId));
}

export async function buildEvaluationDrillRows(
  input: BuildDrillRowsInput,
): Promise<EvaluationDrillRow[]> {
  const all = await loadWriteupRows(input.ayCode);
  const scoped = applyAllowedSections(applyScope(all, input), input.allowedSectionIds ?? null);

  const kind = rowKindForTarget(input.target);
  if (kind === 'writeup') {
    return applyTargetFilter(scoped, input.target, input.segment ?? null) as EvaluationDrillRow[];
  }
  if (kind === 'section-rollup') {
    return rollupBySection(scoped) as EvaluationDrillRow[];
  }
  // bucket
  return rollupBuckets(scoped) as EvaluationDrillRow[];
}

export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
  allowedSectionIds?: string[] | null;
}): Promise<{
  writeups: WriteupRow[];
  bySection: SectionWriteupRow[];
  buckets: TimeToSubmitBucket[];
}> {
  const all = await loadWriteupRows(input.ayCode);
  const scoped = applyAllowedSections(
    applyScope(all, { ayCode: input.ayCode, scope: input.scope, from: input.from, to: input.to }),
    input.allowedSectionIds ?? null,
  );
  return {
    writeups: scoped,
    bySection: rollupBySection(scoped),
    buckets: rollupBuckets(scoped),
  };
}

// ─── Target filter ──────────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: WriteupRow[],
  target: EvaluationDrillTarget,
  segment: string | null,
): WriteupRow[] {
  switch (target) {
    case 'submission-status':
      return rows;
    case 'submitted':
      return rows.filter((r) => r.status === 'submitted');
    case 'time-to-submit':
      return rows.filter((r) => r.daysToSubmit != null);
    case 'late':
      return rows.filter((r) => r.daysToSubmit != null && r.daysToSubmit > 14);
    case 'submission-velocity-day':
      if (!segment) return rows;
      return rows.filter((r) => r.submittedAt?.slice(0, 10) === segment);
    case 'time-to-submit-bucket': {
      if (!segment) return rows.filter((r) => r.daysToSubmit != null);
      const bucket = TIME_BUCKETS.find((b) => b.label === segment);
      if (!bucket) return rows;
      return rows.filter((r) => {
        if (r.daysToSubmit == null) return false;
        if (bucket.hi == null) return r.daysToSubmit >= bucket.lo;
        return r.daysToSubmit >= bucket.lo && r.daysToSubmit <= bucket.hi;
      });
    }
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
  | 'bucketLabel'
  | 'bucketCount';

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  studentName: 'Student',
  studentNumber: 'Student #',
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
  bucketLabel: 'Bucket',
  bucketCount: 'Count',
};

const WRITEUP_COLUMNS: DrillColumnKey[] = ['studentName', 'sectionName', 'level', 'termNumber', 'status', 'submittedAt', 'daysToSubmit'];
const SECTION_COLUMNS: DrillColumnKey[] = ['sectionName', 'level', 'termNumber', 'submissionPct', 'submitted', 'draft', 'missing', 'total'];
const BUCKET_COLUMNS: DrillColumnKey[] = ['bucketLabel', 'bucketCount'];

export function allColumnsForKind(kind: EvaluationDrillRowKind): DrillColumnKey[] {
  switch (kind) {
    case 'writeup': return WRITEUP_COLUMNS;
    case 'section-rollup': return SECTION_COLUMNS;
    case 'bucket': return BUCKET_COLUMNS;
  }
}

export function defaultColumnsForTarget(target: EvaluationDrillTarget): DrillColumnKey[] {
  return allColumnsForKind(rowKindForTarget(target));
}

export function drillHeaderForTarget(
  target: EvaluationDrillTarget,
  segment: string | null,
): { eyebrow: string; title: string } {
  switch (target) {
    case 'submission-status': return { eyebrow: 'Drill · Submission', title: 'Writeup submission status' };
    case 'submitted': return { eyebrow: 'Drill · Submitted', title: 'Submitted writeups' };
    case 'time-to-submit': return { eyebrow: 'Drill · Days to submit', title: 'Time-to-submit cohort' };
    case 'late': return { eyebrow: 'Drill · Late', title: 'Submissions over 14 days' };
    case 'submission-velocity-day': return { eyebrow: 'Drill · Daily', title: segment ? `Submitted on ${segment}` : 'Submission velocity' };
    case 'writeups-by-section': return { eyebrow: 'Drill · By section', title: 'Writeups by section' };
    case 'time-to-submit-bucket': return { eyebrow: 'Drill · Bucket', title: segment ? `Bucket: ${segment}` : 'Time-to-submit buckets' };
    default: return { eyebrow: 'Drill', title: 'Evaluation' };
  }
}
