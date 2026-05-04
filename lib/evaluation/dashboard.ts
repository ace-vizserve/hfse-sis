import { unstable_cache } from 'next/cache';

import { loadAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import { createServiceClient } from '@/lib/supabase/service';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';

// Evaluation dashboard aggregators — read-only view over
// `evaluation_writeups`. The Evaluation module is the sole writer
// (KD #49); we just summarise submission progress here.

const CACHE_TTL_SECONDS = 300;

function tag(ayCode: string): string[] {
  return ['evaluation-dashboard', `evaluation-dashboard:${ayCode}`];
}

type WriteupRow = {
  id: string;
  section_student_id: string;
  term_id: string;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

async function loadWriteupsUncached(ayCode: string): Promise<{
  writeups: WriteupRow[];
  termIdsByNumber: Map<number, string>;
  totalStudents: number;
}> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = ayRow?.id as string | undefined;
  if (!ayId) return { writeups: [], termIdsByNumber: new Map(), totalStudents: 0 };

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', ayId)
    .neq('term_number', 4);
  const termIds = (termRows ?? []).map((r) => r.id as string);
  const termIdsByNumber = new Map<number, string>();
  for (const row of (termRows ?? []) as Array<{ id: string; term_number: number }>) {
    termIdsByNumber.set(row.term_number, row.id);
  }
  if (termIds.length === 0) return { writeups: [], termIdsByNumber, totalStudents: 0 };

  const { data: sectionRows } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = (sectionRows ?? []).map((r) => r.id as string);

  const { count: studentCount } =
    sectionIds.length > 0
      ? await service
          .from('section_students')
          .select('id', { count: 'exact', head: true })
          .in('section_id', sectionIds)
          .eq('enrollment_status', 'active')
      : { count: 0 };

  const { data: rows } = await service
    .from('evaluation_writeups')
    .select('id, section_student_id, term_id, submitted, submitted_at, created_at, updated_at')
    .in('term_id', termIds);

  return {
    writeups: (rows ?? []) as WriteupRow[],
    termIdsByNumber,
    totalStudents: studentCount ?? 0,
  };
}

function loadWriteups(ayCode: string) {
  return unstable_cache(
    () => loadWriteupsUncached(ayCode),
    ['evaluation', 'writeups-raw', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs: submission %, advisers complete (inferred as submissions within term),
// avg time-to-submit, late submissions.
// ──────────────────────────────────────────────────────────────────────────

export type EvaluationKpis = {
  submissionPct: number;
  submitted: number;
  expected: number; // total students × T1-T3 terms
  medianTimeToSubmitDays: number | null;
  lateSubmissions: number;
};

function medianDays(samples: number[]): number | null {
  if (!samples.length) return null;
  const s = samples.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

function kpisFrom(
  writeups: WriteupRow[],
  from: string,
  to: string,
  totalStudents: number,
  termCount: number,
): EvaluationKpis {
  const inRange = writeups.filter((w) => {
    const ref = w.submitted_at ?? w.updated_at ?? w.created_at;
    const day = ref.slice(0, 10);
    return day >= from && day <= to;
  });

  const submitted = inRange.filter((w) => w.submitted).length;
  const expected = totalStudents * termCount;
  const submissionPct = expected > 0 ? (submitted / expected) * 100 : 0;

  const samples: number[] = [];
  let late = 0;
  for (const w of inRange) {
    if (!w.submitted || !w.submitted_at) continue;
    const start = Date.parse(w.created_at);
    const end = Date.parse(w.submitted_at);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    const days = Math.round((end - start) / 86_400_000);
    samples.push(days);
    if (days > 14) late += 1;
  }

  return {
    submissionPct,
    submitted,
    expected,
    medianTimeToSubmitDays: medianDays(samples),
    lateSubmissions: late,
  };
}

async function loadEvaluationKpisRangeUncached(
  input: RangeInput,
): Promise<RangeResult<EvaluationKpis>> {
  const { writeups, termIdsByNumber, totalStudents } = await loadWriteups(input.ayCode);
  const termCount = termIdsByNumber.size || 3;
  const current = kpisFrom(writeups, input.from, input.to, totalStudents, termCount);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = kpisFrom(writeups, input.cmpFrom, input.cmpTo, totalStudents, termCount);
  return {
    current,
    comparison,
    delta: computeDelta(current.submissionPct, comparison.submissionPct),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getEvaluationKpisRange(
  input: RangeInput,
): Promise<RangeResult<EvaluationKpis>> {
  return unstable_cache(
    loadEvaluationKpisRangeUncached,
    ['evaluation', 'kpis-range', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
  )(input);
}

// Submission velocity — daily counts of new submissions.

export type VelocityPoint = { x: string; y: number };

function bucketByDay(dates: (string | null)[], from: string, to: string): VelocityPoint[] {
  const fromDate = parseLocalDate(from);
  if (!fromDate) return [];
  const length = daysInRange({ from, to });
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    labels.push(toISODate(d));
  }
  const buckets = new Array(length).fill(0) as number[];
  for (const iso of dates) {
    if (!iso) continue;
    const day = iso.slice(0, 10);
    const idx = labels.indexOf(day);
    if (idx >= 0) buckets[idx] += 1;
  }
  return labels.map((x, i) => ({ x, y: buckets[i] }));
}

async function loadSubmissionVelocityRangeUncached(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  const { writeups } = await loadWriteups(input.ayCode);
  const submittedAtDates = writeups.filter((w) => w.submitted).map((w) => w.submitted_at);
  const current = bucketByDay(submittedAtDates, input.from, input.to);
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = bucketByDay(submittedAtDates, input.cmpFrom, input.cmpTo);
  const currentTotal = current.reduce((s, p) => s + p.y, 0);
  const comparisonTotal = comparison.reduce((s, p) => s + p.y, 0);
  return {
    current,
    comparison,
    delta: computeDelta(currentTotal, comparisonTotal),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getSubmissionVelocityRange(
  input: RangeInput,
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadSubmissionVelocityRangeUncached,
    ['evaluation', 'velocity', input.ayCode, input.from, input.to, input.cmpFrom ?? '', input.cmpTo ?? ''],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) },
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Role-aware PriorityPanel loaders (Bite 6).
//
// Teacher path: count NOT-YET-SUBMITTED writeups across the teacher's
// form_adviser sections in the current open T1-T3 term. Headline = total
// pending; chips = top 4 sections by pending count.
//
// Registrar path: same logic but school-wide (every section in the AY).
// Both collapse to a "no active window" state when the term's
// evaluation_terms.is_open flag is false (or no current term exists).
// ──────────────────────────────────────────────────────────────────────────

export type EvaluationTeacherPriorityInput = {
  ayCode: string;
  teacherUserId: string;
};

async function loadEvaluationTeacherPriorityUncached(
  input: EvaluationTeacherPriorityInput,
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // 1. Resolve teacher's form_adviser sections.
  const assignments = await loadAssignmentsForUser(service, input.teacherUserId);
  const adviserSectionIds = Array.from(
    new Set(assignments.filter((a) => a.role === 'form_adviser').map((a) => a.section_id)),
  );

  if (adviserSectionIds.length === 0) {
    return {
      eyebrow: 'Priority · this term',
      title: 'No advisory sections assigned',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'pen',
    };
  }

  // 2. Find the current open term in this AY (T1-T3 only).
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, label, academic_years!inner(ay_code)')
    .eq('academic_years.ay_code', input.ayCode)
    .neq('term_number', 4)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle();

  const currentTerm = termRows as { id: string; term_number: number; label: string } | null;
  if (!currentTerm) {
    return {
      eyebrow: 'Priority · this term',
      title: 'No active term',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'pen',
    };
  }

  // 3. Confirm the evaluation window for this term is open.
  const { data: evalTermRow } = await service
    .from('evaluation_terms')
    .select('is_open')
    .eq('term_id', currentTerm.id)
    .maybeSingle();

  if (!(evalTermRow as { is_open: boolean } | null)?.is_open) {
    return {
      eyebrow: 'Priority · this term',
      title: 'Evaluation window closed for this term',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'pen',
    };
  }

  // 4. For each adviser section, count active students MINUS submitted writeups
  //    for the current term. evaluation_writeups uses `submitted boolean`
  //    (migration 018) — there is no `status` column.
  const perSection = await Promise.all(
    adviserSectionIds.map(async (sectionId) => {
      const [enrolledRes, writeupsRes, sectionRes] = await Promise.all([
        service
          .from('section_students')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', sectionId)
          .eq('enrollment_status', 'active'),
        service
          .from('evaluation_writeups')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', sectionId)
          .eq('term_id', currentTerm.id)
          .eq('submitted', true),
        service.from('sections').select('name').eq('id', sectionId).maybeSingle(),
      ]);
      const expected = enrolledRes.count ?? 0;
      const submitted = writeupsRes.count ?? 0;
      const pending = Math.max(0, expected - submitted);
      const sectionName = (sectionRes.data as { name: string } | null)?.name ?? 'Section';
      return { sectionId, sectionName, pending };
    }),
  );

  const totalPending = perSection.reduce((sum, s) => sum + s.pending, 0);

  const chips = perSection
    .filter((s) => s.pending > 0)
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 4)
    .map((s) => ({
      label: s.sectionName,
      count: s.pending,
      href: `/evaluation/sections/${s.sectionId}`,
      severity: 'warn' as const,
    }));

  return {
    eyebrow: `Priority · ${currentTerm.label}`,
    title: totalPending === 0 ? 'All writeups submitted' : 'Writeups still need your input',
    headline: {
      value: totalPending,
      label: totalPending === 0 ? 'caught up' : 'writeups pending across your advisories',
      severity: totalPending === 0 ? 'good' : totalPending <= 5 ? 'warn' : 'bad',
    },
    chips,
    cta:
      totalPending > 0
        ? { label: 'Open my sections', href: '/evaluation/sections' }
        : undefined,
    iconKey: 'pen',
  };
}

export function getEvaluationTeacherPriority(
  input: EvaluationTeacherPriorityInput,
): Promise<PriorityPayload> {
  return unstable_cache(
    loadEvaluationTeacherPriorityUncached,
    ['evaluation', 'teacher-priority', input.ayCode, input.teacherUserId],
    { tags: tag(input.ayCode), revalidate: 60 },
  )(input);
}

export type EvaluationRegistrarPriorityInput = { ayCode: string };

async function loadEvaluationRegistrarPriorityUncached(
  input: EvaluationRegistrarPriorityInput,
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // Current open term in current AY (T1-T3).
  const { data: termRow } = await service
    .from('terms')
    .select('id, term_number, label, academic_years!inner(ay_code)')
    .eq('academic_years.ay_code', input.ayCode)
    .neq('term_number', 4)
    .eq('is_current', true)
    .maybeSingle();

  const currentTerm = termRow as { id: string; term_number: number; label: string } | null;
  if (!currentTerm) {
    return {
      eyebrow: 'Priority · today',
      title: 'No active evaluation term',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'clipboard',
    };
  }

  // Confirm window is open.
  const { data: evalTermRow } = await service
    .from('evaluation_terms')
    .select('is_open')
    .eq('term_id', currentTerm.id)
    .maybeSingle();

  if (!(evalTermRow as { is_open: boolean } | null)?.is_open) {
    return {
      eyebrow: 'Priority · today',
      title: 'Evaluation window closed',
      headline: { value: 0, label: 'no writeups expected', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'clipboard',
    };
  }

  // All sections in current AY → expected vs submitted writeups.
  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, academic_years!inner(ay_code)')
    .eq('academic_years.ay_code', input.ayCode);
  const sections = (sectionRows ?? []) as Array<{ id: string; name: string }>;

  const perSection = await Promise.all(
    sections.map(async (s) => {
      const [enrolledRes, submittedRes] = await Promise.all([
        service
          .from('section_students')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', s.id)
          .eq('enrollment_status', 'active'),
        service
          .from('evaluation_writeups')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', s.id)
          .eq('term_id', currentTerm.id)
          .eq('submitted', true),
      ]);
      const expected = enrolledRes.count ?? 0;
      const submitted = submittedRes.count ?? 0;
      return { sectionId: s.id, sectionName: s.name, pending: Math.max(0, expected - submitted) };
    }),
  );

  const totalPending = perSection.reduce((sum, s) => sum + s.pending, 0);

  const chips = perSection
    .filter((s) => s.pending > 0)
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 4)
    .map((s) => ({
      label: s.sectionName,
      count: s.pending,
      href: `/evaluation/sections/${s.sectionId}`,
      severity: 'warn' as const,
    }));

  return {
    eyebrow: `Priority · ${currentTerm.label}`,
    title: totalPending === 0 ? 'All writeups submitted' : 'Writeups still pending school-wide',
    headline: {
      value: totalPending,
      label: totalPending === 0 ? 'all sections complete' : 'writeups still due across all sections',
      severity: totalPending === 0 ? 'good' : 'warn',
    },
    chips,
    cta:
      totalPending > 0
        ? { label: 'Open writeups roster', href: '/evaluation/sections' }
        : undefined,
    iconKey: 'clipboard',
  };
}

export function getEvaluationRegistrarPriority(
  input: EvaluationRegistrarPriorityInput,
): Promise<PriorityPayload> {
  return unstable_cache(
    loadEvaluationRegistrarPriorityUncached,
    ['evaluation', 'registrar-priority', input.ayCode],
    { tags: tag(input.ayCode), revalidate: 60 },
  )(input);
}
