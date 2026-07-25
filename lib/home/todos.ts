import { unstable_cache } from 'next/cache';

import type { Role } from '@/lib/auth/roles';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sgToday } from '@/lib/dates';

export type HomeTodoItem = {
  id: string;
  module: string;
  text: string;
  href: string;
  kind: 'review' | 'change-request';
  aging?: { label: string; tone: 'success' | 'warning' | 'destructive' };
  requestId?: string;
  requestedBy?: string;
};

/**
 * Shared `academic_years.id` lookup by `ay_code` — used by every to-do
 * source in this module that needs to scope a service-client query to the
 * current AY. Returns `null` when the AY row doesn't exist; callers decide
 * their own empty-result shape (`[]` vs `null`).
 */
async function resolveAyId(
  service: SupabaseClient,
  ayCode: string
): Promise<string | null> {
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  return (ayRow as { id: string } | null)?.id ?? null;
}

/**
 * Runs `fn` over `items` in fixed-size concurrent batches (default 5) —
 * matches the bulk-publish dialog's per-section readiness fetch pattern
 * (KD #139/#145), so a large AY's section count doesn't fan out an
 * unbounded `Promise.all` in one shot.
 */
async function mapInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const batch = items.slice(i, i + chunkSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function fromPriority(
  id: string,
  module: string,
  payload: PriorityPayload
): HomeTodoItem | null {
  if (payload.headline.value <= 0) return null;
  return {
    id,
    module,
    text: `${payload.headline.value} ${payload.headline.label}`,
    href: payload.cta?.href ?? '#',
    kind: 'review',
  };
}

async function teacherTodos(
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  const { getMarkbookTeacherPriority } =
    await import('@/lib/markbook/dashboard');
  const { getEvaluationTeacherPriority } =
    await import('@/lib/evaluation/dashboard');
  const [markbook, evaluation] = await Promise.all([
    getMarkbookTeacherPriority({ ayCode, teacherUserId: userId }),
    getEvaluationTeacherPriority({ ayCode, teacherUserId: userId }),
  ]);
  return [
    fromPriority('markbook-priority', 'Markbook', markbook),
    fromPriority('evaluation-priority', 'Evaluation', evaluation),
  ].filter((t): t is HomeTodoItem => t !== null);
}

function agingFor(requestedAt: string): {
  label: string;
  tone: 'success' | 'warning' | 'destructive';
} {
  const days = Math.floor((Date.now() - Date.parse(requestedAt)) / 86_400_000);
  const label = days === 1 ? '1 day' : `${days} days`;
  const tone = days > 7 ? 'destructive' : days >= 3 ? 'warning' : 'success';
  return { label, tone };
}

type RawCrRow = {
  id: string;
  requested_at: string;
  requested_by_email: string | null;
  grading_sheet: {
    section: { academic_year_id: string } | null;
    subject: { name: string } | null;
    term: { label: string } | null;
  } | null;
};

/**
 * Grade change-requests assigned to this school_admin, exactly scoped like
 * app/(markbook)/markbook/change-requests/page.tsx:88-91 (assigned-to-me OR
 * legacy both-null broadcast). school_admin is the ONLY role this fires for
 * — verified against lib/change-requests/decide.ts, which 403s any other
 * role attempting to approve/reject regardless of what any page renders.
 */
async function schoolAdminChangeRequestTodos(
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return [];

  const { data, error } = await service
    .from('grade_change_requests')
    .select(
      `id, requested_at, requested_by_email,
       grading_sheet:grading_sheets!inner(
         section:sections!inner(academic_year_id),
         subject:subjects(name),
         term:terms(label)
       )`
    )
    .eq('status', 'pending')
    .eq('grading_sheet.section.academic_year_id', ayId)
    .or(
      `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
    )
    .order('requested_at', { ascending: true })
    .limit(5);

  if (error || !data) return [];

  return (data as unknown as RawCrRow[]).map((row) => {
    const subject = row.grading_sheet?.subject?.name ?? 'Unknown subject';
    const term = row.grading_sheet?.term?.label ?? '';
    return {
      id: `cr-${row.id}`,
      module: 'Markbook',
      text: `Grade change — ${term} ${subject}`.trim(),
      href: `/markbook/change-requests?req=${encodeURIComponent(row.id)}`,
      kind: 'change-request' as const,
      aging: agingFor(row.requested_at),
      requestId: row.id,
      requestedBy: row.requested_by_email ?? undefined,
    };
  });
}

async function docValidationTodo(ayCode: string): Promise<HomeTodoItem | null> {
  const { countPendingDocValidation } =
    await import('@/lib/admissions/document-validation');
  const count = await countPendingDocValidation(ayCode);
  if (count === 0) return null;
  return {
    id: 'admissions-doc-validation',
    module: 'Admissions',
    text: `${count} ${count === 1 ? 'document' : 'documents'} awaiting validation`,
    href: '/admissions/document-validation',
    kind: 'review',
  };
}

async function unsyncedStudentsTodo(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const { countUnsyncedEnrolledStudents } =
    await import('@/lib/sis/unsynced-students');
  const count = await countUnsyncedEnrolledStudents(ayCode);
  if (count === 0) return null;
  return {
    id: 'records-unsynced',
    module: 'Records',
    text: `${count} ${count === 1 ? 'student' : 'students'} unsynced`,
    href: '/records/unsynced',
    kind: 'review',
  };
}

async function pFilesValidationTodo(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const { countAwaitingVerification } =
    await import('@/lib/p-files/document-validation');
  const count = await countAwaitingVerification(ayCode);
  if (count === 0) return null;
  return {
    id: 'p-files-validation',
    module: 'P-Files',
    text: `${count} ${count === 1 ? 'document' : 'documents'} awaiting validation`,
    href: '/p-files/document-validation',
    kind: 'review',
  };
}

/**
 * Report-card comment-gate rollup for the current term — the one to-do
 * source that isn't a single existing count helper (flagged in the design
 * spec as the item most worth a second look). Scans every section in the
 * AY via the same per-section cumulativeCommentGaps call the bulk-publish
 * dialog already fans out client-side (KD #139), but throttled server-side
 * to batches of 5 concurrent sections (mapInChunks) rather than one
 * unbounded Promise.all — and cached 60s under the `sis:${ayCode}` tag
 * (KD #54 convention) since this runs on every page load for 3 of the 4
 * roles that reach `/`.
 */
async function loadReportCardGapsTodoUncached(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return null;

  const { data: terms } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current, virtue_theme')
    .eq('academic_year_id', ayId);
  const termRows = (terms ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
    virtue_theme: string | null;
  }>;
  const { resolveCurrentTermId } = await import('@/lib/sis/current-term');
  const currentTermId = resolveCurrentTermId(termRows, sgToday());
  const currentTerm = termRows.find((t) => t.id === currentTermId);
  if (!currentTerm || currentTerm.term_number >= 4) return null; // T4 has no comment gate (KD #49)

  const { data: sections } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId);
  const sectionRows = (sections ?? []) as Array<{ id: string; name: string }>;

  const { cumulativeCommentGaps } =
    await import('@/lib/markbook/comment-completeness');
  const allTerms = termRows.map((t) => ({
    id: t.id,
    term_number: t.term_number,
    end_date: t.end_date,
    virtue_theme: t.virtue_theme,
  }));

  const gapsPerSection = await mapInChunks(sectionRows, 5, async (s) => ({
    section: s,
    gaps: await cumulativeCommentGaps(
      service,
      s.id,
      allTerms,
      currentTerm.term_number
    ),
  }));
  const sectionsWithGaps = gapsPerSection.filter((r) =>
    r.gaps.some((g) => g.missing.length > 0 || g.virtueMissing)
  );
  if (sectionsWithGaps.length === 0) return null;

  const count = sectionsWithGaps.length;
  return {
    id: 'markbook-comment-gaps',
    module: 'Markbook',
    text: `T${currentTerm.term_number} report cards — comments incomplete for ${count} ${count === 1 ? 'section' : 'sections'}`,
    href: `/evaluation/sections/${sectionsWithGaps[0].section.id}`,
    kind: 'review',
  };
}

function reportCardGapsTodo(ayCode: string): Promise<HomeTodoItem | null> {
  return unstable_cache(
    loadReportCardGapsTodoUncached,
    ['home', 'report-card-gaps', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )(ayCode);
}

/**
 * Role-scoped to-do rows for the home page. `school_admin` is the only
 * role that gets `kind: 'change-request'` rows (KD #41, verified against
 * lib/change-requests/decide.ts) — every other role's rows are review-only
 * links into the real page.
 */
export async function getHomeTodos(
  role: Role,
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  if (role === 'teacher') {
    return teacherTodos(ayCode, userId);
  }

  if (role === 'academic_coordinator') {
    const [docs, unsynced] = await Promise.all([
      docValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [docs, unsynced].filter((t): t is HomeTodoItem => t !== null);
  }

  if (role === 'school_admin') {
    const [crs, docs, unsynced] = await Promise.all([
      schoolAdminChangeRequestTodos(ayCode, userId),
      docValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [...crs, docs, unsynced].filter(
      (t): t is HomeTodoItem => t !== null
    );
  }

  if (role === 'superadmin') {
    const [pFiles, unsynced] = await Promise.all([
      pFilesValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [pFiles, unsynced].filter((t): t is HomeTodoItem => t !== null);
  }

  return [];
}

// Exported for Task 8's server component to avoid importing the whole
// module just for the report-card-gaps source, which is opt-in per caller
// due to its heavier per-section scan.
export { reportCardGapsTodo };
