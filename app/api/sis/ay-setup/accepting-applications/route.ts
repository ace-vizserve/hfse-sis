import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ToggleAcceptingApplicationsSchema } from '@/lib/schemas/ay-setup';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/ay-setup/accepting-applications
//
// Toggle the early-bird gate (KD #77) on a specific AY. Decoupled from
// `is_current` â€” admin can open the upcoming AY for early-bird while the
// current AY is still operationally active.
//
// Role: school_admin + admin + superadmin (matches AY creation gate).
export async function PATCH(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ToggleAcceptingApplicationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ay_code: ayCode, accepting } = parsed.data;
  const supabase = createServiceClient();

  const { data: target } = await supabase
    .from('academic_years')
    .select('id, accepting_applications')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: `AY ${ayCode} not found` }, { status: 404 });
  }

  const before = (target as { accepting_applications: boolean }).accepting_applications;
  if (before === accepting) {
    return NextResponse.json({ ok: true, unchanged: true, accepting });
  }

  const { error: updErr } = await supabase
    .from('academic_years')
    .update({ accepting_applications: accepting })
    .eq('ay_code', ayCode);
  if (updErr) {
    console.error('[ay-setup accepting-applications] update failed:', updErr.message);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.accepting_applications.toggle',
    entityType: 'academic_year',
    entityId: (target as { id: string }).id,
    context: { ay_code: ayCode, before, after: accepting },
  });

  // The Admissions sidebar's "Upcoming AY applications" entry derives from
  // this flag, so invalidate the SIS cache surface that drives it.
  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, accepting });
}
