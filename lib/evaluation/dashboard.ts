import { unstable_cache } from 'next/cache';

import { loadAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  computeDelta,
  daysInRange,
  parseLocalDate,
  toISODate,
  type RangeInput,
  type RangeResult,
} from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import { loadEvaluationChaseState } from '@/lib/evaluation/drill';
import {
  daysUntilPtc,
  findPtcForWriteupTerm,
  getPtcEventsForAy,
  sgToday,
} from '@/lib/evaluation/ptc-resolver';
import {
  FCA_EXCLUDED_TERM_NUMBER,
  WITHDRAWN_ENROLLMENT_STATUS,
  hasWriteupContent,
  isSubmittedWriteup,
} from '@/lib/evaluation/roster-rules';

// Evaluation dashboard aggregators — read-only view over
// `evaluation_writeups`. The Evaluation module is the sole writer
// (KD #49); we just summarise submission progress here.

const CACHE_TTL_SECONDS = 300;

function tag(ayCode: string): string[] {
  return ['evaluation-dashboard', `evaluation-dashboard:${ayCode}`];
}

// Schema: evaluation_writeups (migration 018) is keyed (term_id, student_id)
// — there is no `section_student_id` column. The earlier shape selected one,
// PostgREST 400'd, the helper silently returned an empty array, and every
// Evaluation KPI rendered as 0 / 0% across all AYs.
export type WriteupRow = {
  id: string;
  student_id: string;
  section_id: string;
  term_id: string;
  submitted: boolean;
  /** Derived at load time: the `writeup` text is non-empty after trim.
   *  The full text is deliberately NOT cached — only this boolean. */
  has_content: boolean;
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
  if (!ayId)
    return { writeups: [], termIdsByNumber: new Map(), totalStudents: 0 };

  // termRows and sectionRows both depend only on ayId, not on each other —
  // parallelized (§2 of 11-performance-patterns.md).
  const [{ data: termRows }, { data: sectionRows }] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', ayId)
      .neq('term_number', FCA_EXCLUDED_TERM_NUMBER),
    service.from('sections').select('id').eq('academic_year_id', ayId),
  ]);
  const termIds = (termRows ?? []).map((r) => r.id as string);
  const termIdsByNumber = new Map<number, string>();
  for (const row of (termRows ?? []) as Array<{
    id: string;
    term_number: number;
  }>) {
    termIdsByNumber.set(row.term_number, row.id);
  }
  if (termIds.length === 0)
    return { writeups: [], termIdsByNumber, totalStudents: 0 };

  const sectionIds = (sectionRows ?? []).map((r) => r.id as string);

  // Active roster (not withdrawn), fetched as rows (not a head count) so the
  // write-up set below can be restricted to students actually on the roster —
  // KD #120: a withdrawn student's write-up row must not count toward
  // "submitted" when the "expected" denominator only counts the active roster.
  // Paginated defensively (rows ≈ active students, but transfers/re-enrols
  // can push the table past PostgREST's 1000-row cap).
  const rosterRows =
    sectionIds.length > 0
      ? await fetchAllPages<{ student_id: string }>((from, to) =>
          service
            .from('section_students')
            .select('student_id')
            .in('section_id', sectionIds)
            .neq('enrollment_status', WITHDRAWN_ENROLLMENT_STATUS)
            .range(from, to)
        )
      : [];
  const activeStudentIds = new Set(rosterRows.map((r) => r.student_id));

  // Paginated around PostgREST's 1000-row cap — ~490 enrolled students ×
  // 3 terms (T1-T3, T4 excluded per KD #49) routinely exceeds it.
  // `writeup` is selected only to derive `has_content` (KD #120: "submitted"
  // requires non-empty content); the text is dropped before caching.
  type WriteupRawRow = Omit<WriteupRow, 'has_content'> & {
    writeup: string | null;
  };
  const rawRows = await fetchAllPages<WriteupRawRow>((from, to) =>
    service
      .from('evaluation_writeups')
      .select(
        'id, student_id, section_id, term_id, writeup, submitted, submitted_at, created_at, updated_at'
      )
      .in('term_id', termIds)
      .range(from, to)
  );

  // Restrict to the active roster (matches the drill row set in
  // lib/evaluation/drill.ts, which iterates the non-withdrawn roster — keeps
  // count == drill per KD #124).
  const rows: WriteupRow[] = rawRows
    .filter((r) => activeStudentIds.has(r.student_id))
    .map(({ writeup, ...rest }) => ({
      ...rest,
      has_content: hasWriteupContent(writeup),
    }));

  return {
    writeups: rows,
    termIdsByNumber,
    totalStudents: rosterRows.length,
  };
}

function loadWriteups(ayCode: string) {
  return unstable_cache(
    () => loadWriteupsUncached(ayCode),
    ['evaluation', 'writeups-raw', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) }
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// KPIs: submission %, submitted count, expected count (roster-based).
// ──────────────────────────────────────────────────────────────────────────

export type EvaluationKpis = {
  submissionPct: number;
  submitted: number;
  expected: number; // total students × T1-T3 terms
};

// Exported for unit tests (pure — no I/O). The "submitted" numerator applies
// KD #120's rule: submitted=true AND non-empty content (an emptied-but-still-
// submitted write-up doesn't count), over write-ups already restricted to the
// active roster by `loadWriteupsUncached`. Same predicate as the drill's
// status === 'submitted' (lib/evaluation/drill.ts) so count == drill (KD #124).
export function kpisFrom(
  writeups: WriteupRow[],
  from: string,
  to: string,
  totalStudents: number,
  termCount: number
): EvaluationKpis {
  const inRange = writeups.filter((w) => {
    const ref = w.submitted_at ?? w.updated_at ?? w.created_at;
    const day = ref.slice(0, 10);
    return day >= from && day <= to;
  });

  const submitted = inRange.filter((w) =>
    isSubmittedWriteup({ submitted: w.submitted, hasContent: w.has_content })
  ).length;
  const expected = totalStudents * termCount;
  const submissionPct = expected > 0 ? (submitted / expected) * 100 : 0;

  return {
    submissionPct,
    submitted,
    expected,
  };
}

async function loadEvaluationKpisRangeUncached(
  input: RangeInput
): Promise<RangeResult<EvaluationKpis>> {
  const { writeups, termIdsByNumber, totalStudents } = await loadWriteups(
    input.ayCode
  );
  const termCount = termIdsByNumber.size || 3;
  const current = kpisFrom(
    writeups,
    input.from,
    input.to,
    totalStudents,
    termCount
  );
  if (input.cmpFrom == null || input.cmpTo == null) {
    return {
      current,
      comparison: null,
      delta: null,
      range: { from: input.from, to: input.to },
      comparisonRange: null,
    };
  }
  const comparison = kpisFrom(
    writeups,
    input.cmpFrom,
    input.cmpTo,
    totalStudents,
    termCount
  );
  return {
    current,
    comparison,
    delta: computeDelta(current.submissionPct, comparison.submissionPct),
    range: { from: input.from, to: input.to },
    comparisonRange: { from: input.cmpFrom, to: input.cmpTo },
  };
}

export function getEvaluationKpisRange(
  input: RangeInput
): Promise<RangeResult<EvaluationKpis>> {
  return unstable_cache(
    loadEvaluationKpisRangeUncached,
    [
      'evaluation',
      'kpis-range',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// Submission velocity — daily counts of new submissions.

function bucketByDay(
  dates: (string | null)[],
  from: string,
  to: string
): VelocityPoint[] {
  const fromDate = parseLocalDate(from);
  if (!fromDate) return [];
  const length = daysInRange({ from, to });
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(
      fromDate.getFullYear(),
      fromDate.getMonth(),
      fromDate.getDate() + i
    );
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
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  const { writeups } = await loadWriteups(input.ayCode);
  const submittedAtDates = writeups
    .filter((w) => w.submitted)
    .map((w) => w.submitted_at);
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
  input: RangeInput
): Promise<RangeResult<VelocityPoint[]>> {
  return unstable_cache(
    loadSubmissionVelocityRangeUncached,
    [
      'evaluation',
      'velocity',
      input.ayCode,
      input.from,
      input.to,
      input.cmpFrom ?? '',
      input.cmpTo ?? '',
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(input.ayCode) }
  )(input);
}

// ──────────────────────────────────────────────────────────────────────────
// Chase KPIs — live-state, current-term-scoped (KD #124). NOT date-windowed,
// so the count matches its drill exactly (count == drill). Registrar/oversight
// only. T4 → null (no FCA write-up, KD #49) → the dashboard renders "—".
//
// Delegates to `loadEvaluationChaseState` (lib/evaluation/drill.ts) so the
// card count and the drill row set come from one source of truth.
// ──────────────────────────────────────────────────────────────────────────

export type EvaluationChaseKpis = {
  /** True when there is a current T1–T3 term (false on T4 / no term). */
  available: boolean;
  outstandingWriteups: number;
  advisersBehind: number;
  hasUnassignedSection: boolean;
};

export async function getEvaluationChaseKpis(
  ayCode: string
): Promise<EvaluationChaseKpis> {
  const chase = await loadEvaluationChaseState(ayCode);
  if (!chase) {
    return {
      available: false,
      outstandingWriteups: 0,
      advisersBehind: 0,
      hasUnassignedSection: false,
    };
  }
  return {
    available: true,
    outstandingWriteups: chase.outstanding.length,
    advisersBehind: chase.advisersBehind.length,
    hasUnassignedSection: chase.hasUnassignedSection,
  };
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

// ── Active writeup term resolver ──────────────────────────────────────────
// Matches the markbook + grade-distribution fallback pattern (Sprint 38):
// prefer the `is_current=true` flag, but fall back to a date-based pick so a
// missing flag doesn't black out the priority panel. T4 is excluded
// structurally — no FCA writeup ever lives there (KD #49).
type ActiveTerm = { id: string; term_number: number; label: string };

async function resolveActiveWriteupTerm(
  service: ReturnType<typeof createServiceClient>,
  ayCode: string
): Promise<ActiveTerm | null> {
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id ?? null;
  if (!ayId) return null;

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, label, is_current, start_date, end_date')
    .eq('academic_year_id', ayId)
    .neq('term_number', FCA_EXCLUDED_TERM_NUMBER)
    .order('term_number', { ascending: true });
  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    is_current: boolean | null;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termRows ?? []) as TermRow[];
  if (terms.length === 0) return null;

  const today = sgToday();
  const current = terms.find((t) => t.is_current === true);
  const containingToday = terms.find(
    (t) =>
      t.start_date && t.end_date && t.start_date <= today && t.end_date >= today
  );
  const lastFinished = [...terms]
    .filter((t) => t.end_date && t.end_date < today)
    .sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0];
  const picked = current ?? containingToday ?? lastFinished ?? terms[0];
  if (!picked) return null;
  return {
    id: picked.id,
    term_number: picked.term_number,
    label: picked.label,
  };
}

// Format a PTC date range as a plain-English label.
// Single day → "8 Apr". Same-month span → "8–9 Apr". Cross-month → "29 Apr – 2 May".
function formatPtcRangeLabel(startIso: string, endIso: string): string {
  try {
    const start = new Date(`${startIso}T00:00:00+08:00`);
    const end = new Date(`${endIso}T00:00:00+08:00`);
    const sameDay = startIso === endIso;
    if (sameDay) {
      return start.toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
      });
    }
    const sameMonth =
      start.getUTCMonth() === end.getUTCMonth() &&
      start.getUTCFullYear() === end.getUTCFullYear();
    if (sameMonth) {
      return `${start.toLocaleDateString('en-SG', { day: 'numeric' })}–${end.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`;
    }
    return `${start.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`;
  } catch {
    return startIso;
  }
}

// "in 5 days" / "today" / "tomorrow" / "5 days ago".
function formatPtcDaysLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 0) return `in ${days} days`;
  if (days === -1) return 'yesterday';
  return `${Math.abs(days)} days ago`;
}

type SectionPendingRow = {
  sectionId: string;
  sectionName: string;
  pending: number;
};

/**
 * Batches the "active roster minus submitted writeups" computation across
 * many sections into 2 queries TOTAL, not 2 per section (§8 N+1 avoidance —
 * this fed the registrar/teacher priority panels via a per-section
 * `Promise.all(sections.map(async s => { ...2 queries... }))` loop that
 * scaled with school-wide section count).
 *
 * Roster is counted by the section's CURRENT active roster (student_id), not
 * evaluation_writeups.section_id — a writeup's section_id is a seed-time tag
 * that does NOT follow a mid-year transfer (KD #67), so counting by
 * section_id over-reports "pending" in the destination section. Per-roster
 * counting stays correct after any transfer. Each active student belongs to
 * exactly one section, so bucketing submittedStudentIds by roster membership
 * is equivalent to a per-section submitted count.
 */
async function loadSectionWriteupPending(
  service: ReturnType<typeof createServiceClient>,
  sections: Array<{ id: string; name: string }>,
  termId: string
): Promise<SectionPendingRow[]> {
  if (sections.length === 0) return [];
  const sectionIds = sections.map((s) => s.id);

  const { data: rosterRows } = await service
    .from('section_students')
    .select('section_id, student_id')
    .in('section_id', sectionIds)
    .neq('enrollment_status', WITHDRAWN_ENROLLMENT_STATUS);

  const studentIdsBySection = new Map<string, string[]>();
  const allStudentIds: string[] = [];
  for (const row of (rosterRows ?? []) as Array<{
    section_id: string;
    student_id: string;
  }>) {
    const list = studentIdsBySection.get(row.section_id) ?? [];
    list.push(row.student_id);
    studentIdsBySection.set(row.section_id, list);
    allStudentIds.push(row.student_id);
  }

  // KD #120: "submitted" requires non-empty content — an emptied-but-
  // still-submitted write-up must not count (mirrors getWriteupProgressByTerm,
  // publish-readiness, and the chase loader). The DB filter handles
  // submitted=true; the JS filter enforces non-empty.
  const submittedStudentIds = new Set<string>();
  if (allStudentIds.length > 0) {
    const { data: subRows } = await service
      .from('evaluation_writeups')
      .select('student_id, writeup, submitted')
      .eq('term_id', termId)
      .eq('submitted', true)
      .in('student_id', allStudentIds);
    for (const w of (subRows ?? []) as Array<{
      student_id: string;
      writeup: string | null;
      submitted: boolean;
    }>) {
      if (
        isSubmittedWriteup({
          submitted: w.submitted,
          hasContent: hasWriteupContent(w.writeup),
        })
      ) {
        submittedStudentIds.add(w.student_id);
      }
    }
  }

  return sections.map((s) => {
    const studentIds = studentIdsBySection.get(s.id) ?? [];
    const expected = studentIds.length;
    const submitted = studentIds.filter((id) =>
      submittedStudentIds.has(id)
    ).length;
    return {
      sectionId: s.id,
      sectionName: s.name,
      pending: Math.max(0, expected - submitted),
    };
  });
}

export type EvaluationTeacherPriorityInput = {
  ayCode: string;
  teacherUserId: string;
};

async function loadEvaluationTeacherPriorityUncached(
  input: EvaluationTeacherPriorityInput
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // 1. Resolve teacher's form_adviser sections.
  const assignments = await loadAssignmentsForUser(
    service,
    input.teacherUserId
  );
  const adviserSectionIds = Array.from(
    new Set(
      assignments
        .filter((a) => a.role === 'form_adviser')
        .map((a) => a.section_id)
    )
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

  // 2. Find the current writeup term — `is_current` first, with a date-based
  //    fallback so a missing flag doesn't black out the panel (Sprint 38
  //    fallback pattern, matches getGradeDistribution + markbook currentTerm).
  const currentTerm = await resolveActiveWriteupTerm(service, input.ayCode);
  if (!currentTerm) {
    return {
      eyebrow: 'Priority · this term',
      title: 'No writeup term configured',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'pen',
    };
  }

  // 3. Pull PTC awareness for the active term — audience-unfiltered here
  //    (the full section page handles audience scoping; the priority panel
  //    just surfaces the nearest event as a deadline signal).
  const ptcEvents = await getPtcEventsForAy(input.ayCode);
  const ptcForTerm = findPtcForWriteupTerm(currentTerm.id, ptcEvents);
  const ptcDays = ptcForTerm ? daysUntilPtc(ptcForTerm.startDate) : null;
  // Tentative PTC dates render in the label but never escalate severity —
  // the registrar hasn't confirmed the date, so we shouldn't push the
  // adviser to "urgent" mode against a date that might still move.
  const ptcIsTentative = ptcForTerm?.tentative === true;
  const ptcLabel = ptcForTerm
    ? `${currentTerm.label} PTC ${formatPtcRangeLabel(ptcForTerm.startDate, ptcForTerm.endDate)} (${formatPtcDaysLabel(ptcDays ?? 0)}${ptcIsTentative ? ', tentative' : ''})`
    : null;

  // 4. For each adviser section, count active students MINUS submitted writeups
  //    for the current term. evaluation_writeups uses `submitted boolean`
  //    (migration 018) — there is no `status` column. Batched via
  //    loadSectionWriteupPending — 3 queries total (section names + roster +
  //    writeups), not up to 3 per section.
  const { data: adviserSectionRows } = await service
    .from('sections')
    .select('id, name')
    .in('id', adviserSectionIds);
  const adviserSectionNameById = new Map(
    ((adviserSectionRows ?? []) as Array<{ id: string; name: string }>).map(
      (s) => [s.id, s.name]
    )
  );
  const adviserSections = adviserSectionIds.map((id) => ({
    id,
    name: adviserSectionNameById.get(id) ?? 'Section',
  }));
  const perSection = await loadSectionWriteupPending(
    service,
    adviserSections,
    currentTerm.id
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

  // PTC deadline pressure — bump severity / decorate the title when the
  // discussion meeting is within 30 days and writeups still aren't done.
  // Tentative dates skip the escalation; they show in the label but don't
  // change panel severity.
  const ptcUrgent =
    !ptcIsTentative && ptcDays != null && ptcDays >= 0 && ptcDays <= 30;
  const ptcOverdue = !ptcIsTentative && ptcDays != null && ptcDays < 0;
  const baseTitle =
    totalPending === 0
      ? 'All writeups submitted'
      : 'Writeups still need your input';
  const title =
    ptcUrgent && totalPending > 0
      ? `${ptcLabel} — finalise writeups`
      : ptcOverdue && totalPending > 0
        ? `${ptcLabel} · ${totalPending} writeups still unsubmitted`
        : baseTitle;
  const headlineLabel =
    totalPending === 0
      ? ptcLabel
        ? `caught up · ${ptcLabel}`
        : 'caught up'
      : ptcLabel
        ? `writeups pending · ${ptcLabel}`
        : 'writeups pending across your advisories';
  const headlineSeverity =
    totalPending === 0
      ? 'good'
      : ptcOverdue || (ptcUrgent && totalPending > 0) || totalPending > 5
        ? 'bad'
        : 'warn';

  return {
    eyebrow: `Priority · ${currentTerm.label}`,
    title,
    headline: {
      value: totalPending,
      label: headlineLabel,
      severity: headlineSeverity,
    },
    chips,
    cta:
      totalPending > 0
        ? { label: 'Open my sections', href: '/evaluation/sections' }
        : undefined,
    iconKey: ptcUrgent || ptcOverdue ? 'warning' : 'pen',
  };
}

export function getEvaluationTeacherPriority(
  input: EvaluationTeacherPriorityInput
): Promise<PriorityPayload> {
  return unstable_cache(
    loadEvaluationTeacherPriorityUncached,
    ['evaluation', 'teacher-priority', input.ayCode, input.teacherUserId],
    { tags: tag(input.ayCode), revalidate: 60 }
  )(input);
}

export type EvaluationRegistrarPriorityInput = { ayCode: string };

async function loadEvaluationRegistrarPriorityUncached(
  input: EvaluationRegistrarPriorityInput
): Promise<PriorityPayload> {
  const service = createServiceClient();

  // Same fallback ladder as the teacher loader — is_current → containing
  // today → most-recently-finished T1-T3. Without it the panel blanked out
  // whenever nobody flipped the is_current flag (AY9999 default state).
  const currentTerm = await resolveActiveWriteupTerm(service, input.ayCode);
  if (!currentTerm) {
    return {
      eyebrow: 'Priority · today',
      title: 'No writeup term configured',
      headline: { value: 0, label: 'writeups pending', severity: 'good' },
      chips: [],
      cta: undefined,
      iconKey: 'clipboard',
    };
  }

  const ptcEvents = await getPtcEventsForAy(input.ayCode);
  const ptcForTerm = findPtcForWriteupTerm(currentTerm.id, ptcEvents);
  const ptcDays = ptcForTerm ? daysUntilPtc(ptcForTerm.startDate) : null;
  const ptcIsTentative = ptcForTerm?.tentative === true;
  const ptcLabel = ptcForTerm
    ? `${currentTerm.label} PTC ${formatPtcRangeLabel(ptcForTerm.startDate, ptcForTerm.endDate)} (${formatPtcDaysLabel(ptcDays ?? 0)}${ptcIsTentative ? ', tentative' : ''})`
    : null;
  // Tentative dates: registrar sees the line in the label so they remember
  // it's coming, but the panel doesn't escalate to "bad" severity until the
  // date is locked in.
  const ptcUrgent =
    !ptcIsTentative && ptcDays != null && ptcDays >= 0 && ptcDays <= 30;
  const ptcOverdue = !ptcIsTentative && ptcDays != null && ptcDays < 0;

  // All sections in current AY → expected vs submitted writeups.
  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, academic_years!inner(ay_code)')
    .eq('academic_years.ay_code', input.ayCode);
  const sections = (sectionRows ?? []) as Array<{ id: string; name: string }>;

  // Batched via loadSectionWriteupPending — 2 queries total across every
  // section in the AY, not 2 per section (§8 N+1 avoidance; this scaled with
  // school-wide section count before the fix).
  const perSection = await loadSectionWriteupPending(
    service,
    sections,
    currentTerm.id
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

  const baseRegTitle =
    totalPending === 0
      ? 'All writeups submitted'
      : 'Writeups still pending school-wide';
  const regTitle =
    ptcUrgent && totalPending > 0
      ? `${ptcLabel} — chase pending writeups`
      : ptcOverdue && totalPending > 0
        ? `${ptcLabel} · ${totalPending} writeups still unsubmitted`
        : baseRegTitle;
  const regHeadlineLabel =
    totalPending === 0
      ? ptcLabel
        ? `all sections complete · ${ptcLabel}`
        : 'all sections complete'
      : ptcLabel
        ? `writeups due · ${ptcLabel}`
        : 'writeups still due across all sections';
  const regSeverity =
    totalPending === 0
      ? 'good'
      : ptcOverdue || (ptcUrgent && totalPending > 0)
        ? 'bad'
        : 'warn';

  return {
    eyebrow: `Priority · ${currentTerm.label}`,
    title: regTitle,
    headline: {
      value: totalPending,
      label: regHeadlineLabel,
      severity: regSeverity,
    },
    chips,
    cta:
      totalPending > 0
        ? { label: 'Open writeups roster', href: '/evaluation/sections' }
        : undefined,
    iconKey: ptcUrgent || ptcOverdue ? 'warning' : 'clipboard',
  };
}

export function getEvaluationRegistrarPriority(
  input: EvaluationRegistrarPriorityInput
): Promise<PriorityPayload> {
  return unstable_cache(
    loadEvaluationRegistrarPriorityUncached,
    ['evaluation', 'registrar-priority', input.ayCode],
    { tags: tag(input.ayCode), revalidate: 60 }
  )(input);
}
