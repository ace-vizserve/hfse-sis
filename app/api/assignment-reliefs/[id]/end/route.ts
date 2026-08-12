import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { buildReliefAuditContext } from '@/lib/audit/assignment-context';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { ReliefEndSchema } from '@/lib/schemas/assignment-relief';
import { sgToday } from '@/lib/dates';
import type { SupabaseClient } from '@supabase/supabase-js';

// PATCH /api/assignment-reliefs/[id]/end — the regular teacher is back.
//
// WHY PATCH TO A NAMED ENDPOINT RATHER THAN DELETE. Ending cover is a fact
// worth keeping: it is the record of who held a class, and for how long, while
// its teacher was away. Deleting the row would erase exactly the history this
// feature exists to capture, and would silently take the substitute's access
// away with no trace of why. So the row stays and gains an end date; `ended_on`
// going non-null is what removes access.
//
// Access really does stop: `loadEffectiveAssignmentsForUser` and
// `has_active_relief_for_assignment` (migration 115) both treat cover as active
// only within its date window, so a dated-off cover drops out of both on the
// next read. `ended_on` is the LAST day, so the substitute keeps access through
// the day it ends rather than losing it that morning mid-register.

async function invalidateForAssignment(
  service: SupabaseClient,
  assignmentId: string
): Promise<void> {
  const { data } = await service
    .from('teacher_assignments')
    .select('section:sections(academic_year:academic_years(ay_code))')
    .eq('id', assignmentId)
    .maybeSingle();

  const sectionRel = (
    data as {
      section:
        | { academic_year: { ay_code: string } | { ay_code: string }[] | null }
        | Array<{
            academic_year: { ay_code: string } | { ay_code: string }[] | null;
          }>
        | null;
    } | null
  )?.section;
  const section = Array.isArray(sectionRel) ? sectionRel[0] : sectionRel;
  const ayRel = section?.academic_year;
  const ayCode =
    (Array.isArray(ayRel) ? ayRel[0]?.ay_code : ayRel?.ay_code) ?? null;
  if (!ayCode) return;

  invalidateDrillTags('markbook', ayCode);
  invalidateDrillTags('evaluation', ayCode);
  invalidateDrillTags('attendance', ayCode);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('staff.manage_relief');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Tolerate an empty body — "they're back today" is the common case and
  // should not require the caller to send anything.
  const raw = await request.json().catch(() => ({}));
  const parsed = ReliefEndSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Check the date and try again.',
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: existing, error: loadError } = await service
    .from('assignment_reliefs')
    .select('id, assignment_id, relief_teacher_user_id, started_on, ended_on')
    .eq('id', id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: 'That cover no longer exists.' },
      { status: 404 }
    );
  }

  // Already ended — succeed without writing a second audit row. Same
  // already-gone short-circuit the assignment DELETE route uses, and for the
  // same reason: a double-click must not read as an error, and must not double
  // up the trail.
  if (existing.ended_on) {
    return NextResponse.json({ ok: true, changed: false, relief: existing });
  }

  // sgToday(), never a UTC-derived date string. This is a date-only calendar
  // column and the school is UTC+8: ending cover at 07:30 Singapore time would
  // record yesterday, and if the cover had started today that would
  // immediately fail the check below with "Cover cannot end before it
  // started" — an error the admin cannot act on. lib/dates.ts exists for this.
  const endedOn = parsed.data.ended_on ?? sgToday();
  if (endedOn < existing.started_on) {
    return NextResponse.json(
      { error: 'Cover cannot end before it started.' },
      { status: 400 }
    );
  }

  const { data, error } = await service
    .from('assignment_reliefs')
    .update({
      ended_on: endedOn,
      ended_by: auth.user.id,
      ended_at: new Date().toISOString(),
    })
    .eq('id', id)
    // Only end cover that is still running. Without this, two admins clicking
    // at once would both write, and the second would overwrite the first's end
    // date and name.
    .is('ended_on', null)
    .select(
      'id, assignment_id, relief_teacher_user_id, started_on, ended_on, reason, notes, ended_at'
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    // Lost the race — someone else ended it between the read and the write.
    return NextResponse.json({ ok: true, changed: false });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'assignment.relief.end',
    entityType: 'assignment_relief',
    entityId: data.id,
    context: await buildReliefAuditContext(service, data, {
      started_on: data.started_on,
      ended_on: data.ended_on,
    }),
  });

  await invalidateForAssignment(service, data.assignment_id);

  return NextResponse.json({ ok: true, changed: true, relief: data });
}
