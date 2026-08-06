import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { buildAssignmentAuditContext } from '@/lib/audit/assignment-context';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { AssignmentRemovalSchema } from '@/lib/schemas/teacher-assignment';
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
