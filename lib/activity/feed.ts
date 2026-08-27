import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { loadAdvisedSectionIds } from '@/lib/approvals/resolve';
import { loadStaffDeclarations } from '@/lib/declarations/staff';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { sgToday } from '@/lib/dates';
import {
  buildDeclarationEvents,
  buildGradeChangeEvents,
  sortEventsNewestFirst,
  initialsFromName,
  markChangeFieldLabel,
  type ActivityEvent,
} from '@/lib/activity/events';

/**
 * The activity feed, assembled on read.
 *
 * ⚠ THIS RUNS ON THE SERVER AND MUST. `grade_change_requests` is readable by
 * ANY authenticated account holding a role (migration 009) — the narrowing to
 * "yours" has always lived in the API layer. A browser-direct feed would show
 * every teacher the whole school's mark changes. The `.or(...)` below is the
 * only thing standing between this feature and that leak; never move it into
 * JavaScript applied after the fetch.
 */

/** Well above anything this school produces; a guard, not a page size. */
export const SOURCE_CAP = 400;

export type ActivityTab = 'general' | 'grade_change' | 'student_declaration';

export type ActivityCursor = { at: string; id: string } | null;

export type ActivityWaitingItem = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string;
  href: string;
  initials: string;
};

export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: ActivityCursor;
  waiting: ActivityWaitingItem[];
  /** One of the two sources failed; the list is short, not empty. */
  partial: boolean;
  /** A source hit SOURCE_CAP, so the tail is not reachable. */
  truncated: boolean;
};

/**
 * Slice a fully-derived, newest-first list at a cursor.
 *
 * ⚠ The comparison is on `(at, id)` as a pair, not on `at` alone. Two events
 * can share a timestamp to the millisecond — the register write and its
 * approval very nearly do — and an `at`-only cursor either repeats them or
 * drops them at every page boundary.
 */
export function pageEvents(
  all: ActivityEvent[],
  cursor: ActivityCursor,
  limit: number
): { events: ActivityEvent[]; nextCursor: ActivityCursor } {
  const sorted = sortEventsNewestFirst(all);

  const start = cursor
    ? sorted.findIndex(
        (e) =>
          e.at.localeCompare(cursor.at) < 0 ||
          (e.at === cursor.at && e.id.localeCompare(cursor.id) > 0)
      )
    : 0;

  if (start < 0) return { events: [], nextCursor: null };

  const events = sorted.slice(start, start + limit);
  const more = sorted.length > start + limit;
  const last = events.at(-1);

  return {
    events,
    nextCursor: more && last ? { at: last.at, id: last.id } : null,
  };
}

export type ActivityScope = {
  userId: string;
  role: Role | null;
  tab: ActivityTab;
  cursor: ActivityCursor;
  limit: number;
  today?: string;
};

export async function loadActivityPage(
  service: SupabaseClient,
  scope: ActivityScope
): Promise<ActivityPage> {
  const nameById = new Map(await getStaffDisplayNameById());

  const wantDeclarations =
    scope.tab === 'general' || scope.tab === 'student_declaration';
  const wantMarkChanges =
    scope.tab === 'general' || scope.tab === 'grade_change';

  const [declarations, markChanges] = await Promise.allSettled([
    wantDeclarations
      ? loadDeclarationSide(service, scope, nameById)
      : Promise.resolve({ events: [], waiting: [], truncated: false }),
    wantMarkChanges
      ? loadMarkChangeSide(service, scope, nameById)
      : Promise.resolve({ events: [], waiting: [], truncated: false }),
  ]);

  const parts = [declarations, markChanges];
  const partial = parts.some((p) => p.status === 'rejected');
  for (const p of parts) {
    if (p.status === 'rejected') {
      console.error(
        '[activity] one source failed:',
        p.reason instanceof Error ? p.reason.message : String(p.reason)
      );
    }
  }

  const ok = parts.flatMap((p) => (p.status === 'fulfilled' ? [p.value] : []));
  const all = ok.flatMap((p) => p.events);
  const waiting = ok.flatMap((p) => p.waiting);
  const truncated = ok.some((p) => p.truncated);

  const { events, nextCursor } = pageEvents(all, scope.cursor, scope.limit);
  return { events, nextCursor, waiting, partial, truncated };
}

// ── Declarations ───────────────────────────────────────────────────────────

async function loadDeclarationSide(
  service: SupabaseClient,
  scope: ActivityScope,
  nameById: ReadonlyMap<string, string>
) {
  const today = scope.today ?? sgToday();
  const advisedSectionIds = await loadAdvisedSectionIds(
    service,
    scope.userId,
    today
  );

  // ⚠ The same predicate migration 131 enforces: a step that names me, or a
  // class I advise TODAY (which includes a co-adviser and live relief cover).
  // Both arms are root columns, which is why the flow filter is separate.
  const arms = [`approver_pool.cs.{${scope.userId}}`];
  if (advisedSectionIds.length > 0) {
    arms.push(`section_id.in.(${advisedSectionIds.join(',')})`);
  }

  // ⚠ SOURCE_CAP HERE COUNTS STAGE ROWS, NOT FILINGS. This flow has two
  // steps, so 400 rows is ~200 filings, not 400.
  //
  // ⚠ ORDERED, NOT JUST LIMITED. An unordered `.limit()` returns an arbitrary
  // 400 rows from Postgres, and that arbitrary set is not stable between
  // requests — the same query re-run a page later can pick a different 400,
  // silently dropping or repeating declarations across pages. Ordered newest
  // filing first (so the cap drops the oldest, not a random slice), with
  // `request_id` as a tiebreak that cannot itself be ambiguous: two stage
  // rows can share their request's `created_at` to the tick (they belong to
  // the same filing), and `request_id` is a UUID, so the pair sorts the same
  // way every time this runs.
  const { data, error } = await service
    .from('approval_request_stages')
    .select('request_id, approval_requests!inner(flow, subject_id, created_at)')
    .eq('approval_requests.flow', DECLARATION_APPROVAL_FLOW)
    .or(arms.join(','))
    .order('created_at', {
      referencedTable: 'approval_requests',
      ascending: false,
    })
    .order('request_id', { ascending: false })
    .limit(SOURCE_CAP);
  if (error) throw new Error(error.message);

  type Row = {
    request_id: string;
    approval_requests:
      | { subject_id: string; created_at: string }
      | Array<{ subject_id: string; created_at: string }>;
  };

  const declarationIds = [
    ...new Set(
      ((data ?? []) as unknown as Row[]).map((r) => {
        const req = Array.isArray(r.approval_requests)
          ? r.approval_requests[0]
          : r.approval_requests;
        return req?.subject_id ?? '';
      })
    ),
  ].filter(Boolean);

  if (declarationIds.length === 0) {
    return { events: [], waiting: [], truncated: false };
  }

  // ⚠ NOT A SECOND FETCH. `loadStaffDeclarations` already calls
  // `loadLaddersBySubject` with this same flow, subject type and ids, and
  // hangs the result on `view.ladder` (lib/declarations/staff.ts). Calling it
  // again here would be two extra round-trips per page load for a ladder we
  // already have.
  const views = await loadStaffDeclarations(service, declarationIds);

  const events: ActivityEvent[] = [];
  const waiting: ActivityWaitingItem[] = [];
  const advised = new Set(advisedSectionIds);

  for (const view of views) {
    const ladder = view.ladder;
    if (!ladder) continue;

    const label = `${view.studentName}, ${
      view.declarationType === 'travel' ? 'travel' : 'absence'
    } ${formatDayRange(view.startDate, view.endDate)}`;

    events.push(
      ...buildDeclarationEvents({
        ladder,
        subjectLabel: label,
        nameById,
        registerWrittenAt: view.registerWrittenAt,
        registerDaysWritten: view.registerDaysWritten,
        registerWriteError: view.registerWriteError,
      })
    );

    const pending = ladder.stages.find((s) => s.status === 'pending');
    const mine =
      pending != null &&
      (pending.resolver === 'named'
        ? pending.approverPool.includes(scope.userId)
        : pending.sectionId != null && advised.has(pending.sectionId));

    if (mine && pending) {
      waiting.push({
        id: `student_declaration:${ladder.requestId}`,
        requestId: ladder.requestId,
        title: label,
        subtitle: `${pending.label} · ${view.className ?? 'their class'}`,
        href: `/attendance/declarations?req=${ladder.requestId}`,
        initials: initialsFromName(view.studentName),
      });
    }
  }

  return {
    events,
    waiting,
    truncated: (data ?? []).length >= SOURCE_CAP,
  };
}

// ── Mark changes ───────────────────────────────────────────────────────────

/**
 * The `.or()` predicate that scopes `grade_change_requests` to one person —
 * the leak guard the module header warns about.
 *
 * ⚠ THE FOURTH ARM IS GATED ON `role === 'school_admin'`, and that gate is
 * not an inconsistency to "clean up" by adding it for everyone. A row from
 * before migration 013 has BOTH approver columns null — nobody to match — so
 * an unconditional `and(primary_approver_id.is.null,secondary_approver_id.is.null)`
 * arm would let every teacher read every legacy pending mark change in the
 * school. `getSidebarChangeRequestPreview`
 * (`lib/change-requests/sidebar-counts.ts`) applies this exact arm only for
 * `school_admin`; mirrored here so the feed and the bell agree on who a
 * legacy row is visible to.
 */
function markChangeScopeArms(scope: ActivityScope): string[] {
  const arms = [
    `requested_by.eq.${scope.userId}`,
    `primary_approver_id.eq.${scope.userId}`,
    `secondary_approver_id.eq.${scope.userId}`,
  ];
  if (scope.role === 'school_admin') {
    arms.push('and(primary_approver_id.is.null,secondary_approver_id.is.null)');
  }
  return arms;
}

async function loadMarkChangeSide(
  service: SupabaseClient,
  scope: ActivityScope,
  nameById: ReadonlyMap<string, string>
) {
  // ⚠ THE LEAK GUARD. See this module's header comment before touching it.
  //
  // ⚠ THE JOIN IS NOT `grade_entries.student` — grade_entries has no such
  // column. It holds `section_student_id`, which points at `section_students`,
  // which holds `student_id`. This mirrors the exact path
  // `lib/change-requests/labels.ts`'s `fetchLabels` already uses to resolve a
  // student label for the same table; a shorter guessed join fails silently
  // (an empty embed, not an error) rather than loudly.
  const arms = markChangeScopeArms(scope);

  const { data, error } = await service
    .from('grade_change_requests')
    .select(
      `id, field_changed, slot_index, current_value, proposed_value, status,
       requested_by, requested_by_email, requested_at,
       primary_approver_id, secondary_approver_id,
       reviewed_by, reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at,
       grade_entry:grade_entries!inner(
         section_student:section_students!inner(
           student:students!inner(first_name, last_name, student_number)
         )
       )`
    )
    .or(arms.join(','))
    .order('requested_at', { ascending: false })
    .limit(SOURCE_CAP);
  if (error) throw new Error(error.message);

  type Student = {
    first_name: string;
    last_name: string;
    student_number: string;
  };
  type SectionStudent = { student: Student | Student[] };
  type Row = {
    id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    status: string;
    requested_by: string | null;
    requested_by_email: string;
    requested_at: string;
    primary_approver_id: string | null;
    secondary_approver_id: string | null;
    reviewed_by: string | null;
    reviewed_by_email: string | null;
    reviewed_at: string | null;
    decision_note: string | null;
    applied_by: string | null;
    applied_at: string | null;
    grade_entry:
      | { section_student: SectionStudent | SectionStudent[] }
      | Array<{ section_student: SectionStudent | SectionStudent[] }>;
  };

  const events: ActivityEvent[] = [];
  const waiting: ActivityWaitingItem[] = [];

  for (const row of (data ?? []) as unknown as Row[]) {
    const entry = Array.isArray(row.grade_entry)
      ? row.grade_entry[0]
      : row.grade_entry;
    const sectionStudent = Array.isArray(entry?.section_student)
      ? entry?.section_student[0]
      : entry?.section_student;
    const student = Array.isArray(sectionStudent?.student)
      ? sectionStudent?.student[0]
      : sectionStudent?.student;
    const studentLabel = student
      ? `${student.first_name} ${student.last_name}`
      : 'a student';

    // Teachers land on "My Requests"; everybody else deep-links into the queue,
    // which is what the existing bell already does for the same reason.
    const href =
      scope.role === 'teacher'
        ? '/markbook/grading/requests'
        : `/markbook/change-requests?req=${row.id}`;

    events.push(
      ...buildGradeChangeEvents({
        id: row.id,
        fieldChanged: row.field_changed,
        slotIndex: row.slot_index,
        currentValue: row.current_value,
        proposedValue: row.proposed_value,
        studentLabel,
        requestedById: row.requested_by,
        requestedByEmail: row.requested_by_email,
        requestedAt: row.requested_at,
        status: row.status,
        reviewedById: row.reviewed_by,
        reviewedByEmail: row.reviewed_by_email,
        reviewedAt: row.reviewed_at,
        decisionNote: row.decision_note,
        // This feed doesn't select secondary_reviewed_* at all (pre-existing;
        // out of scope for fix round 1's F4, which is the two mark-change
        // tables, not the activity panel) — nulls here reproduce exactly the
        // no-co-sign-event behaviour this feed already had.
        secondaryReviewedById: null,
        secondaryReviewedByEmail: null,
        secondaryReviewedAt: null,
        appliedById: row.applied_by,
        appliedAt: row.applied_at,
        viewerId: scope.userId,
        nameById,
        href,
      })
    );

    const mine =
      row.status === 'pending' &&
      (row.primary_approver_id === scope.userId ||
        row.secondary_approver_id === scope.userId);

    if (mine) {
      waiting.push({
        id: `grade_change:${row.id}`,
        requestId: row.id,
        title: `${studentLabel} — ${markChangeFieldLabel(row.field_changed, row.slot_index)}`,
        subtitle: 'Mark change',
        href,
        initials: initialsFromName(studentLabel),
      });
    }
  }

  return {
    events,
    waiting,
    truncated: (data ?? []).length >= SOURCE_CAP,
  };
}

// ── Small shared helpers ───────────────────────────────────────────────────

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "3 Sep" for one day, "24–26 Aug" for a run.
 *
 * ⚠ Parsed as parts, never `new Date(iso)`. These are plain yyyy-MM-dd school
 * days with no time zone; letting Date interpret them shifts a Singapore
 * morning back a day for any reader west of it.
 */
function formatDayRange(start: string, end: string): string {
  const part = (iso: string, withMonth: boolean) => {
    const [, m, d] = iso.split('-');
    const month = MONTHS[Number(m) - 1];
    if (!month || !d) return '';
    return withMonth ? `${Number(d)} ${month}` : `${Number(d)}`;
  };
  if (start === end) return part(start, true);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${part(start, !sameMonth)}–${part(end, true)}`;
}
