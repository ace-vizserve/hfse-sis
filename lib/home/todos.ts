import { unstable_cache } from 'next/cache';

import { can, type Capability } from '@/lib/auth/capabilities';
import type { Role } from '@/lib/auth/roles';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import {
  NO_TEACHING_PROFILE,
  type TeachingProfile,
} from '@/lib/sidebar/module-visibility';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
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

// The two teacher rows belong to DIFFERENT JOBS, so each is gated on the job
// that owns it — the same split the quick actions use, one panel up. Grading is
// subject-teacher work (an adviser cannot encode a score); write-ups are
// adviser work (`is_adviser_for_section`, migration 005).
//
// The query is skipped, not fetched-and-discarded: both loaders run on every
// home render for a teacher, and there is no point asking about work the viewer
// cannot do. Note the evaluation row USUALLY self-hid for a subject-only
// teacher because the count came back 0 — that was luck, not a guard, and it
// stopped being reliable the moment the count could be non-zero for any reason.
//
// The job check lives inside each loader rather than in the source table
// because it is not a capability: `teacher` is one RBAC role covering two jobs
// (KD #160/#170), and the answer comes from `teacher_assignments`, not from
// `role_permissions`.
async function markbookPriorityTodo({
  ayCode,
  userId,
  profile,
}: TodoContext): Promise<HomeTodoItem | null> {
  if (!profile.teachesSubject) return null;
  const { getMarkbookTeacherPriority } =
    await import('@/lib/markbook/dashboard');
  const payload = await getMarkbookTeacherPriority({
    ayCode,
    teacherUserId: userId,
  });
  return fromPriority('markbook-priority', 'Markbook', payload);
}

async function evaluationPriorityTodo({
  ayCode,
  userId,
  profile,
}: TodoContext): Promise<HomeTodoItem | null> {
  // advisesSubstantively, not advises. Write-ups stay with the regular adviser
  // while a substitute covers the class, so a cover-only teacher has no
  // write-ups to chase and this row would count someone else's work at them.
  if (!profile.advisesSubstantively) return null;
  const { getEvaluationTeacherPriority } =
    await import('@/lib/evaluation/dashboard');
  const payload = await getEvaluationTeacherPriority({
    ayCode,
    teacherUserId: userId,
  });
  return fromPriority('evaluation-priority', 'Evaluation', payload);
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
    /** Per (subject, academic year) — where the year's own name lives. */
    subject_config: { display_name: string | null } | null;
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
async function schoolAdminChangeRequestTodos({
  ayCode,
  userId,
}: TodoContext): Promise<HomeTodoItem[]> {
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
         subject_config:subject_configs(display_name),
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
    // The to-do names a subject to a person, so it uses what that sheet's
    // YEAR calls it (migration 137) — the config is on the sheet already.
    const sheet = row.grading_sheet;
    const subject = sheet?.subject
      ? subjectDisplayName(sheet.subject, sheet.subject_config)
      : 'Unknown subject';
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

async function docValidationTodo({
  ayCode,
}: TodoContext): Promise<HomeTodoItem | null> {
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

async function unsyncedStudentsTodo({
  ayCode,
}: TodoContext): Promise<HomeTodoItem | null> {
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

async function pFilesValidationTodo({
  ayCode,
}: TodoContext): Promise<HomeTodoItem | null> {
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

  const { cumulativeCommentGaps, loadActiveRoster } =
    await import('@/lib/markbook/comment-completeness');
  const allTerms = termRows.map((t) => ({
    id: t.id,
    term_number: t.term_number,
    end_date: t.end_date,
    virtue_theme: t.virtue_theme,
  }));

  // The roster is loaded here and passed in, rather than left for
  // `cumulativeCommentGaps` to fetch for itself. That second read discarded
  // its error, and a failure made the report-card comment gate pass vacuously
  // — see the note on `cumulativeCommentGaps`. `loadActiveRoster` throws now,
  // and the gather below is `allSettled`, so a broken section is reported
  // instead of quietly counting as "no gaps".
  const gapsPerSection = await mapInChunks(sectionRows, 5, async (s) => ({
    section: s,
    gaps: await cumulativeCommentGaps(
      service,
      s.id,
      allTerms,
      currentTerm.term_number,
      await loadActiveRoster(service, s.id)
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

/** Everything a to-do source is allowed to ask about the viewer. Passed whole
 *  so a new source can use a field the others don't without changing every
 *  loader's signature. */
type TodoContext = {
  ayCode: string;
  userId: string;
  /** Only consulted by the two teacher rows — see their loaders (KD #170). */
  profile: TeachingProfile;
};

type TodoSource = {
  id: string;
  /**
   * The page every row from this source links to — the guard that must pass.
   * A row whose destination bounces the viewer is worse than no row: the
   * panel promises work and the click lands them back where they started.
   * (The two teacher rows take their real href from the priority payload's
   * CTA; the value here is that CTA's destination.)
   */
  href: string;
  roles: Role[];
  /**
   * Checked against the viewer's live grants when set. Roles say who the row
   * is FOR; a capability says whether they may still open it — and since
   * grants are data a superadmin edits at /sis/admin/roles, a role list alone
   * can go stale the moment someone unticks a box.
   */
  requiresCapability?: Capability;
  load: (ctx: TodoContext) => Promise<HomeTodoItem[] | HomeTodoItem | null>;
};

// Exported for the drift test only, following QUICK_ACTIONS one panel up:
// `getHomeTodos` FILTERS, so a row that can never survive its own gates would
// vanish silently. The test reads the raw table.
//
// ORDER IS THE PANEL'S ORDER — the survivors are loaded in parallel and
// flattened in place, so moving a row here moves it on screen.
export const HOME_TODO_SOURCES: TodoSource[] = [
  {
    id: 'markbook-priority',
    href: '/markbook/grading',
    roles: ['teacher'],
    load: markbookPriorityTodo,
  },
  {
    id: 'evaluation-priority',
    href: '/evaluation/sections',
    roles: ['teacher'],
    load: evaluationPriorityTodo,
  },
  {
    id: 'markbook-change-requests',
    href: '/markbook/change-requests',
    // The only source that emits `kind: 'change-request'`, and school_admin is
    // the only role it fires for (KD #41, verified against
    // lib/change-requests/decide.ts, which 403s every other role attempting to
    // approve or reject).
    roles: ['school_admin'],
    load: schoolAdminChangeRequestTodos,
  },
  {
    id: 'admissions-doc-validation',
    href: '/admissions/document-validation',
    // TWO INDEPENDENT GATES ON THE SAME LOOP, DELIBERATELY (KD #173).
    //
    // The academic coordinator was offered this row and it dead-ended: the page
    // redirects anyone without `documents_pre_enrolment.read` to `/`, and
    // migration 106 took that capability off her when document validation moved
    // to the P-Files officer and school_admin — so the to-do sat ON the page she
    // was bounced to, and clicking it looped.
    //
    // Dropping her from `roles` fixes today. The capability fixes tomorrow: the
    // grant is DATA, editable by a superadmin at /sis/admin/roles, so any role
    // in the list can lose its access without a single line of code changing.
    // Belt and braces is the point — a hardcoded role list cannot see a data
    // edit coming, and a capability check alone would offer this to every role
    // that happens to hold the grant rather than the ones it is meant for.
    roles: ['school_admin'],
    requiresCapability: 'documents_pre_enrolment.read',
    load: docValidationTodo,
  },
  {
    id: 'p-files-validation',
    href: '/p-files/document-validation',
    // Same gate for the same reason, on the other side of enrolment. That page
    // redirects a viewer holding neither document read capability
    // (app/(p-files)/p-files/document-validation/page.tsx), and this row counts
    // documents awaiting verification for ENROLLED students — the post-enrolment
    // half — so post-enrolment read is the one that must hold.
    roles: ['superadmin'],
    requiresCapability: 'documents_post_enrolment.read',
    load: pFilesValidationTodo,
  },
  {
    id: 'records-unsynced',
    href: '/records/unsynced',
    roles: ['academic_coordinator', 'school_admin', 'superadmin'],
    load: unsyncedStudentsTodo,
  },
];

/**
 * Role-scoped to-do rows for the home page, filtered on two independent
 * grounds — whether the row is meant for this role, and whether the viewer
 * still holds the capability its destination demands (KD #173).
 *
 * `school_admin` is the only role that gets `kind: 'change-request'` rows
 * (KD #41) — every other role's rows are review-only links into the real page.
 *
 * ⚠ ONE ROLE PICKS THE ROWS AND CHECKS THEM. An earlier design threaded a
 * second "view" role that chose the rows (`source.roles`) while `capabilities`
 * still answered for the account's real role. Switching now rewrites the role
 * itself, so a teaching admin working as a teacher is shown a teacher's panel
 * AND checked as a teacher — the two cannot disagree.
 */
export async function getHomeTodos(
  role: Role,
  ayCode: string,
  userId: string,
  // Only consulted for `teacher`. Defaults to "holds neither job" so a caller
  // that forgets it shows a teacher nothing rather than showing them the wrong
  // work — the safe direction for a panel, unlike the quick-action row whose
  // failure path deliberately grants both (see resolveTeacherNavScope).
  profile: TeachingProfile = NO_TEACHING_PROFILE,
  // Same safe direction: a caller that forgets these drops the capability-gated
  // rows rather than offering a link that might bounce. Production callers pass
  // getCapabilitiesForRole(role) — see app/(dashboard)/page.tsx.
  capabilities: readonly Capability[] = []
): Promise<HomeTodoItem[]> {
  const ctx: TodoContext = { ayCode, userId, profile };

  const sources = HOME_TODO_SOURCES.filter(
    (source) =>
      source.roles.includes(role) &&
      (!source.requiresCapability ||
        can(capabilities, source.requiresCapability))
  );

  // allSettled, NOT all. Every loader here is a separate question — "are there
  // unsynced students", "is anything waiting for approval" — and one of them
  // failing is not a reason to show a blank home page for all of them. It IS a
  // reason to say so in the log: a source that throws contributes nothing,
  // which on this panel is indistinguishable from "nothing to do", and that
  // silence is the bug class this sweep exists for.
  const settled = await Promise.allSettled(
    sources.map((source) => source.load(ctx))
  );

  const results: Array<HomeTodoItem | HomeTodoItem[] | null> = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
      return;
    }
    console.error(
      `[home] to-do source "${sources[i].id}" failed; it will be absent from the panel:`,
      outcome.reason instanceof Error
        ? (outcome.reason.stack ?? outcome.reason.message)
        : outcome.reason
    );
  });

  return results
    .flatMap((result) => (Array.isArray(result) ? result : [result]))
    .filter((todo): todo is HomeTodoItem => todo !== null);
}

// Exported for Task 8's server component to avoid importing the whole
// module just for the report-card-gaps source, which is opt-in per caller
// due to its heavier per-section scan.
export { reportCardGapsTodo };
