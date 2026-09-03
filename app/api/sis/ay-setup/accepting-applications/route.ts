import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { ToggleAcceptingApplicationsSchema } from '@/lib/schemas/ay-setup';
import { computeEarlyBirdClosures } from '@/lib/sis/early-bird';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/ay-setup/accepting-applications
//
// Open / close the early-bird application gate (KD #77) on an AY.
//
// Opening a non-current AY enforces the single-select invariant: at most one
// upcoming AY may accept applications at a time, so any other open upcoming AY
// is closed first. Closing, or flipping the current AY, is a plain single-row
// flip (the current AY is never part of the single-select pool).
//
// Role: school_admin + superadmin.
export async function PATCH(request: Request) {
  const auth = await requireCapability('academic_year.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ToggleAcceptingApplicationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ay_code: ayCode, accepting } = parsed.data;
  const supabase = createServiceClient();

  // Load every AY's flags once — needed for the target lookup and the
  // single-select closure computation.
  const { data: allRows, error: listErr } = await supabase
    .from('academic_years')
    .select('id, ay_code, is_current, accepting_applications');
  if (listErr) {
    console.error(
      '[ay-setup accepting-applications] list failed:',
      listErr.message
    );
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const all = (allRows ?? []) as Array<{
    id: string;
    ay_code: string;
    is_current: boolean;
    accepting_applications: boolean;
  }>;

  const target = all.find((a) => a.ay_code === ayCode);
  if (!target) {
    return NextResponse.json(
      { error: `AY ${ayCode} not found` },
      { status: 404 }
    );
  }

  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  // ── Close: plain single-row flip ──────────────────────────────────────────
  if (!accepting) {
    if (!target.accepting_applications) {
      return NextResponse.json({ ok: true, unchanged: true, accepting });
    }
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: false })
      .eq('ay_code', ayCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] close failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAction({
      service: supabase,
      actor,
      action: 'ay.accepting_applications.toggle',
      entityType: 'academic_year',
      entityId: target.id,
      context: { ay_code: ayCode, before: true, after: false },
    });
    revalidateTag(`sis:${ayCode}`, 'max');
    return NextResponse.json({ ok: true, accepting: false });
  }

  // ── Open: enforce single-select among non-current AYs ─────────────────────
  // The close-others + open-target updates below are sequential, not a single
  // transaction. If one fails mid-way the route returns 500; re-running is safe
  // because computeEarlyBirdClosures re-reads live DB state and converges.
  const toClose = computeEarlyBirdClosures(ayCode, all);
  // Idempotent no-op: already open and nothing else to close. Mirrors the
  // close path's early return so we don't write a before:true/after:true
  // audit row.
  if (target.accepting_applications && toClose.length === 0) {
    return NextResponse.json({ ok: true, unchanged: true, accepting: true });
  }
  for (const closeCode of toClose) {
    const closed = all.find((a) => a.ay_code === closeCode);
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: false })
      .eq('ay_code', closeCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] auto-close failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAction({
      service: supabase,
      actor,
      action: 'ay.accepting_applications.toggle',
      entityType: 'academic_year',
      entityId: closed?.id ?? null,
      context: {
        ay_code: closeCode,
        before: true,
        after: false,
        autoClosedBy: ayCode,
      },
    });
    revalidateTag(`sis:${closeCode}`, 'max');
  }

  if (!target.accepting_applications) {
    const { error } = await supabase
      .from('academic_years')
      .update({ accepting_applications: true })
      .eq('ay_code', ayCode);
    if (error) {
      console.error(
        '[ay-setup accepting-applications] open failed:',
        error.message
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await logAction({
    service: supabase,
    actor,
    action: 'ay.accepting_applications.toggle',
    entityType: 'academic_year',
    entityId: target.id,
    context: {
      ay_code: ayCode,
      before: target.accepting_applications,
      after: true,
      ...(toClose.length ? { autoClosedPrevious: toClose } : {}),
    },
  });
  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, accepting: true, autoClosed: toClose });
}
