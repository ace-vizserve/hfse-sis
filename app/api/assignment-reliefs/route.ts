import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { requireCapability } from '@/lib/auth/require-capability';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { logAction } from '@/lib/audit/log-action';
import { buildReliefAuditContext } from '@/lib/audit/assignment-context';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  ReliefBulkCreateSchema,
  ReliefCreateSchema,
  type ReliefBulkCreate,
  type ReliefCreate,
} from '@/lib/schemas/assignment-relief';
import type { SupabaseClient } from '@supabase/supabase-js';

// Relief teachers — a substitute working a class while its regular teacher is
// away. See migration 112 for why this is a table of its own rather than a
// third `teacher_assignments.role`.
//
// The GET below sits on requireRole, not requireCapability, for the same reason
// the teacher-assignments GET does: a teacher must be able to read their own
// cover ("what am I covering?", "who is covering my class?"), and mapping it to
// a staff.* capability would shut them out. Row scoping is done below and is
// backed by the RLS policy in migration 112. The WRITES are capability-gated on
// `staff.manage_relief` — school admin and above, deliberately narrower than
// the `staff.edit_assignments` the surrounding assignment routes use.

// Arranging cover CHANGES WHO MAY ACT on the section, through
// `loadEffectiveAssignmentsForUser` in the app and the widened RLS helpers in
// migrations 114/115. All three teaching modules cache their drill reads, so a
// stale read would show the wrong person's sheets for up to the 60s TTL.
// Best-effort — never fail the mutation because a cache tag could not be worked
// out.
async function invalidateForSection(
  service: SupabaseClient,
  sectionId: string
): Promise<void> {
  const { data } = await service
    .from('sections')
    .select('academic_year:academic_years(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();

  const rel = (
    data as {
      academic_year: { ay_code: string } | { ay_code: string }[] | null;
    } | null
  )?.academic_year;
  const ayCode = (Array.isArray(rel) ? rel[0]?.ay_code : rel?.ay_code) ?? null;
  if (!ayCode) return;

  invalidateDrillTags('markbook', ayCode);
  invalidateDrillTags('evaluation', ayCode);
  invalidateDrillTags('attendance', ayCode);
}

// GET /api/assignment-reliefs
//   ?section_id=<uuid>  — cover on any assignment in that section
//   ?mine=1             — cover this user is working, or cover of their class
//   ?active=1           — only cover that has not ended (default: all)
export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const sectionId = request.nextUrl.searchParams.get('section_id');
  const activeOnly = request.nextUrl.searchParams.get('active') === '1';

  let query = supabase
    .from('assignment_reliefs')
    .select(
      `id, assignment_id, relief_teacher_user_id, started_on, ended_on,
       reason, notes, created_by, created_at, ended_by, ended_at,
       assignment:teacher_assignments!inner(
         id, teacher_user_id, section_id, subject_id, role
       )`
    )
    .order('started_on', { ascending: false });

  if (sectionId) query = query.eq('assignment.section_id', sectionId);
  if (activeOnly) query = query.is('ended_on', null);

  // Row scoping for a teacher — "cover I am working, or cover of my own class"
  // — is done by the RLS policy in migration 112, not here. `supabase` above is
  // the cookie-scoped client, so that policy applies.
  //
  // It is NOT restated as a filter on this query, which is what a first draft
  // did. PostgREST cannot `or` across a root column and an embedded table's
  // column (`relief_teacher_user_id` and `assignment.teacher_user_id`); it
  // sends the whole thing as a root-level `or=(...)` and errors. That failure
  // is invisible to an admin smoke test — managers took a different branch —
  // and 400s for exactly the two people this endpoint exists to serve.

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ reliefs: data ?? [] });
}

// POST /api/assignment-reliefs — arrange cover for an absent teacher.
//
// Accepts one class or a whole teacher's worth. The bulk shape is the real
// flow: a school admin opens the teacher who called in sick, sees all five
// classes, and says who takes each. Single-class posts remain for the
// per-class "change who covers" action.
//
// The batch is written in ONE insert, which Postgres runs as one statement —
// so it is all-or-nothing. Looping would let three classes get covered and the
// fourth fail on its unique index, leaving a teacher half-covered with nothing
// on screen saying which half.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('staff.manage_relief');
  if ('error' in auth) return auth.error;

  const raw = await request.json().catch(() => null);

  const isBulk =
    raw !== null && typeof raw === 'object' && 'covers' in (raw as object);

  const parsed = isBulk
    ? ReliefBulkCreateSchema.safeParse(raw)
    : ReliefCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      },
      { status: 400 }
    );
  }

  // Normalise both shapes to one list plus the batch-wide fields.
  const shared = parsed.data as {
    reason: string;
    started_on?: string;
    notes?: string | null;
  };
  const covers = isBulk
    ? (parsed.data as ReliefBulkCreate).covers
    : [
        {
          assignment_id: (parsed.data as ReliefCreate).assignment_id,
          relief_teacher_user_id: (parsed.data as ReliefCreate)
            .relief_teacher_user_id,
        },
      ];

  const service = createServiceClient();

  const { data: assignmentRows, error: assignmentError } = await service
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .in(
      'id',
      covers.map((c) => c.assignment_id)
    );

  if (assignmentError) {
    return NextResponse.json(
      { error: assignmentError.message },
      { status: 400 }
    );
  }

  const assignmentById = new Map(
    (assignmentRows ?? []).map((a) => [a.id as string, a])
  );
  if (assignmentById.size !== covers.length) {
    return NextResponse.json(
      {
        error:
          'One of those classes no longer exists. Refresh the page and try again.',
      },
      { status: 404 }
    );
  }

  // Every class in a batch must belong to the same teacher. The flow is "this
  // person is away" — a batch spanning two teachers would be a bug in the
  // caller, and would produce an audit trail nobody could read back as a
  // single decision.
  const coveredTeacherIds = new Set(
    [...assignmentById.values()].map((a) => a.teacher_user_id as string)
  );
  if (coveredTeacherIds.size > 1) {
    return NextResponse.json(
      { error: 'Arrange cover for one teacher at a time.' },
      { status: 400 }
    );
  }

  // A teacher cannot cover their own class. Not expressible as a database
  // constraint — it compares across two tables — so it lives here, at the only
  // write path.
  for (const c of covers) {
    const assignment = assignmentById.get(c.assignment_id)!;
    if (assignment.teacher_user_id === c.relief_teacher_user_id) {
      return NextResponse.json(
        { error: 'A teacher cannot cover their own class.' },
        { status: 400 }
      );
    }
  }

  // Every substitute must be an actual TEACHER account.
  //
  // `getTeacherList()`, not `getStaffDisplayNameById()`. The latter returns
  // every auth user with an email — which in this database means the ~1,000
  // parent portal accounts as well as staff. Validating against it would let a
  // parent's uuid be recorded as cover, and migration 114 would then hand that
  // parent RLS read on the class's students, grading sheets and attendance.
  // Migration 112 declares no FK to auth.users, so this route is the only
  // place that check can happen.
  const { getTeacherList } = await import('@/lib/auth/staff-list');
  const teacherIds = new Set((await getTeacherList()).map((t) => t.id));
  if (covers.some((c) => !teacherIds.has(c.relief_teacher_user_id))) {
    return NextResponse.json(
      {
        error:
          'Choose a teacher with an active account. Refresh the list and try again.',
      },
      { status: 400 }
    );
  }

  // The start date is resolved HERE, never left to the column default.
  //
  // Two reasons, and the first one bit. PostgREST fills a missing key with
  // NULL on a multi-row insert rather than falling back to the column default
  // — so once this route started inserting an array, omitting `started_on`
  // stopped meaning "use today" and started meaning "insert null", which the
  // NOT NULL constraint then rejected. Leaving the field blank, the commonest
  // case, failed outright.
  //
  // Second, the default was `current_date`, which on a UTC server is still
  // yesterday until 08:00 Singapore time — so cover arranged first thing in
  // the morning would have been dated the day before and counted as already
  // running. sgToday() is the school's calendar day.
  const startedOn = shared.started_on ?? sgToday();

  const { data, error } = await service
    .from('assignment_reliefs')
    .insert(
      covers.map((c) => ({
        assignment_id: c.assignment_id,
        relief_teacher_user_id: c.relief_teacher_user_id,
        started_on: startedOn,
        reason: shared.reason,
        notes: shared.notes ?? null,
        created_by: auth.user.id,
      }))
    )
    .select(
      'id, assignment_id, relief_teacher_user_id, started_on, ended_on, reason, notes, created_at'
    );

  if (error) {
    const msg = error.message.includes(
      'assignment_reliefs_one_active_per_assignment'
    )
      ? covers.length > 1
        ? 'Someone is already covering one of those classes. End that cover first — nothing was changed.'
        : 'Someone is already covering this class. End that cover first.'
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const created = data ?? [];

  // One audit row per class, not one per batch. Each class's cover is ended
  // and changed on its own afterwards, so its start belongs on its own
  // timeline — a single batch row would leave the other four classes with a
  // history that begins mid-story.
  for (const relief of created) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'assignment.relief.start',
      entityType: 'assignment_relief',
      entityId: relief.id,
      context: await buildReliefAuditContext(service, relief, {
        reason: relief.reason,
        notes: relief.notes,
        started_on: relief.started_on,
      }),
    });
  }

  // Same section more than once in a batch is normal (a form class plus a
  // subject in it), so bust each section only once.
  for (const sectionId of new Set(
    created.map(
      (r) => assignmentById.get(r.assignment_id as string)!.section_id as string
    )
  )) {
    await invalidateForSection(service, sectionId);
  }

  return NextResponse.json({ reliefs: created, count: created.length });
}
