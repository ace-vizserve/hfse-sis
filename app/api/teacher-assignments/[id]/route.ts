import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import {
  buildAssignmentAuditContext,
  buildReliefAuditContext,
} from '@/lib/audit/assignment-context';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  AssignmentRemovalSchema,
  AssignmentReliefSchema,
} from '@/lib/schemas/teacher-assignment';
import { hasTermStarted } from '@/lib/sis/current-term';
import { sgToday } from '@/lib/dates';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mirror of the POST route's invalidator: a teacher-assignment change busts the
// markbook / evaluation / attendance cache tags for the section's AY so the next
// dashboard/drill read is fresh (not stale until the 60s TTL). Best-effort.
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

// Has the section's academic year begun? Once it has, taking a teacher off a
// class is a mid-year disruption to work that already exists (marks, attendance,
// write-ups), so it has to be explained. Before it has, it's just staffing.
// Same gate as the escalated Generate-index warning (KD #136).
async function sectionYearIsUnderway(
  service: SupabaseClient,
  sectionId: string
): Promise<boolean> {
  const { data: section } = await service
    .from('sections')
    .select('academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section?.academic_year_id) return false;

  const { data: terms } = await service
    .from('terms')
    .select('start_date')
    .eq('academic_year_id', section.academic_year_id);
  return hasTermStarted(terms ?? [], sgToday());
}

// PATCH /api/teacher-assignments/[id] — set or clear this class's relief teacher.
//
// Body: { relief_teacher_user_id: "<uuid>" } to put someone on cover, or
//       { relief_teacher_user_id: null }     to take them off.
//       Optionally relief_started_on / relief_ended_on (yyyy-MM-dd or null).
//
// Cover CARRIES A DATE WINDOW since migration 123, but there is still no
// history table: the window lives on the assignment row itself, and the audit
// log is where a finished cover stays readable.
//
// Both dates are optional and both nulls mean something — start null is "live
// from now", end null is "until she is back" — so the original one-step flow
// (pick a name, save) is unchanged and callers written before 123 keep working.
//
// ⚠ CLEARING THE TEACHER ENDS COVER IMMEDIATELY and wipes the window with it.
// It does not backdate an end date. Somebody will want to stop a cover today
// that was booked to run all week, and that must not leave a window behind on a
// class nobody is covering.
//
// Capability is `staff.manage_relief` — school admin and above, deliberately
// narrower than the `staff.edit_assignments` the DELETE below uses. Arranging
// cover changes who may act on a class; it should not be as widely held as
// editing the timetable.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('staff.manage_relief');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = AssignmentReliefSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      },
      { status: 400 }
    );
  }
  const reliefTeacherId = parsed.data.relief_teacher_user_id;
  // Ending cover clears the window too — the schema already rejects dates sent
  // alongside a null teacher, so this only normalises the omitted case.
  const startedOn = reliefTeacherId
    ? (parsed.data.relief_started_on ?? null)
    : null;
  const endedOn = reliefTeacherId
    ? (parsed.data.relief_ended_on ?? null)
    : null;

  const service = createServiceClient();

  const { data: existing } = await service
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      {
        error:
          'That class is no longer assigned to this teacher. Refresh the page and try again.',
      },
      { status: 404 }
    );
  }

  if (reliefTeacherId) {
    // Also a CHECK constraint since migration 117, but say it in words rather
    // than letting a constraint name reach the screen.
    if (reliefTeacherId === existing.teacher_user_id) {
      return NextResponse.json(
        { error: 'A teacher cannot cover their own class.' },
        { status: 400 }
      );
    }

    // The substitute must be an actual TEACHER account.
    //
    // `getTeacherList()`, not `getStaffDisplayNameById()`. The latter returns
    // every auth user with an email — which in this database means the ~1,000
    // parent portal accounts as well as staff. Validating against it would let
    // a parent's uuid be written here, and the RLS helpers in migration 117
    // would then hand that parent read on the class's students, grading sheets
    // and attendance. There is no FK across schemas, so this is the only place
    // the check can happen.
    //
    // DISABLED ACCOUNTS ARE EXCLUDED, deliberately disagreeing with the POST on
    // the parent route, which passes `excludeDisabled: false`. The two answer
    // different questions: there it is "whose class is this?" — the teacher of
    // record, who may be disabled while on long leave and is still the name on
    // the report card; here it is "who is actually taking the lesson?" — and a
    // disabled account cannot sign in to enter a mark or take the register.
    const { getTeacherList } = await import('@/lib/auth/staff-list');
    const teachers = await getTeacherList();
    if (!teachers.some((t) => t.id === reliefTeacherId)) {
      return NextResponse.json(
        {
          error:
            'Choose a teacher with an active account. Refresh the list and try again.',
        },
        { status: 400 }
      );
    }
  }

  const { error } = await service
    .from('teacher_assignments')
    .update({
      relief_teacher_user_id: reliefTeacherId,
      relief_started_on: startedOn,
      relief_ended_on: endedOn,
    })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: reliefTeacherId
      ? 'assignment.relief.start'
      : 'assignment.relief.end',
    entityType: 'teacher_assignment',
    entityId: id,
    // The dates ride in the audit context so a finished cover stays readable
    // with the window it actually ran for — the row itself keeps nothing once
    // the cover is cleared.
    context: await buildReliefAuditContext(service, existing, reliefTeacherId, {
      relief_started_on: startedOn,
      relief_ended_on: endedOn,
    }),
  });

  // Cover changes who may act on the section, so the three teaching modules'
  // drill caches would otherwise show the wrong person's sheets for up to their
  // 60s TTL. Best-effort — never fail the change because a tag could not be
  // worked out.
  await invalidateForSection(service, existing.section_id);

  return NextResponse.json({
    ok: true,
    relief_teacher_user_id: reliefTeacherId,
    relief_started_on: startedOn,
    relief_ended_on: endedOn,
  });
}

// DELETE /api/teacher-assignments/[id] — registrar+ only.
// Optional body: { change_reason, change_notes } — REQUIRED once the section's
// academic year is underway (see sectionYearIsUnderway). This is the only code
// path that deletes a teacher_assignments row, so it is the single choke point
// for every removal surface.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('staff.edit_assignments');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  // Tolerate a missing body: callers that remove before the year starts send
  // nothing, and neither does the FCA retry path described below.
  const rawBody = await request.json().catch(() => ({}));
  const parsedBody = AssignmentRemovalSchema.safeParse(rawBody ?? {});
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues[0]?.message ?? 'Invalid reason.' },
      { status: 400 }
    );
  }
  const { change_reason = null, change_notes = null } = parsedBody.data;

  // Load the row before deleting so we can log its shape.
  const { data: existing } = await service
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .eq('id', id)
    .maybeSingle();

  // Nothing to delete — the row is already gone. Deleting a nonexistent row is
  // NOT an error in PostgREST (0 rows, no error), so this used to fall through
  // and write an `assignment.delete` audit row with an empty context, claiming
  // a deletion that never happened.
  //
  // That is reachable two ways, both ordinary: a double-clicked "remove", and
  // the FCA-change flow in components/sis/staff-assignment-sheet.tsx, which
  // does DELETE-then-POST and leaves stale local state if the POST fails — so
  // the natural retry re-deletes an id that is already gone.
  if (!existing) {
    return NextResponse.json({ ok: true, changed: false });
  }

  // Reason gate — checked AFTER the already-gone short-circuit above, so a
  // double-clicked remove or an FCA retry never demands an explanation for a
  // deletion that isn't happening.
  if (
    !change_reason &&
    (await sectionYearIsUnderway(service, existing.section_id))
  ) {
    return NextResponse.json(
      { error: 'Tell us why this teacher is being removed.' },
      { status: 400 }
    );
  }

  const { error } = await service
    .from('teacher_assignments')
    .delete()
    .eq('id', id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'assignment.delete',
    entityType: 'teacher_assignment',
    entityId: id,
    context: await buildAssignmentAuditContext(service, existing, {
      change_reason,
      change_notes,
    }),
  });

  if (existing?.section_id) {
    await invalidateForSection(service, existing.section_id);
  }

  return NextResponse.json({ ok: true });
}
