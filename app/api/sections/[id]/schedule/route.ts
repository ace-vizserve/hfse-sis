import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { SectionScheduleAssignSchema } from '@/lib/schemas/section';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sections/[id]/schedule
// Body: { schedule: 'morning' | 'afternoon' | 'whole_day' | null }
//
// Sets a section's daily schedule. Until now nothing in the app could write
// this column: `create_academic_year` (migration 090) stamps it from the fixed
// static catalog at AY rollover, and `POST /api/sections` deliberately drops
// the field — so every hand-created section carried `schedule = null` forever,
// with no way to correct it. This route is that missing path.
//
// Deliberately NOT folded into PATCH /api/sections/[id] (rename): that route's
// schema documents why `schedule` is kept off the create/rename surface, and
// a separate route keeps the audit action, the role gate, and the reasoning
// all in one place — same shape as the sibling `track` route.
//
// `null` clears the value; it is a legitimate state ("unspecified"), not a
// missing field, so the schema accepts it explicitly rather than treating an
// absent key as a clear.
//
// academic_coordinator / school_admin / superadmin only — same gate as every
// other section-mutation route. (Older comments in this codebase call that set
// "registrar+"; the role was renamed in KD #155 and historical prose was left
// alone, but new text should use the real name.)
//
// Scope note: `schedule` is display-only today. The KD #144 follow-up that
// would make it functional — pointing `lib/sis/class-assignment.ts`'s
// auto-enrollment matcher at this column instead of its current fuzzy
// section-name grep — is still outstanding. Writing a correct value here is a
// prerequisite for that work, and does not change enrollment behaviour on its
// own. No drill-tag invalidation for the same reason: no dashboard aggregate
// reads this column.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SectionScheduleAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { schedule } = parsed.data;

  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select('id, name, schedule')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  const before = (section.schedule ?? null) as string | null;
  // No-op guard: re-saving the same value shouldn't append an audit row that
  // implies a change happened.
  if (before === schedule) {
    return NextResponse.json({ ok: true, schedule, changed: false });
  }

  const { error: updateErr } = await service
    .from('sections')
    .update({ schedule })
    .eq('id', sectionId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.schedule.update',
    entityType: 'section',
    entityId: sectionId,
    context: {
      sectionName: section.name,
      before,
      after: schedule,
    },
  });

  return NextResponse.json({ ok: true, schedule, changed: true });
}
