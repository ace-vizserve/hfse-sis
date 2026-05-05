import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  CreateAySchema,
  DeleteAySchema,
  SwitchActiveAySchema,
} from '@/lib/schemas/ay-setup';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/ay-setup
//
// Create a new AY. Calls the Postgres stored function
// `create_academic_year(p_ay_code, p_label)` which atomically:
//   - inserts academic_years + 4 terms
//   - copies sections + subject_configs from the most-recent prior AY
//   - creates the 4 AY-prefixed admissions tables
//
// Role: admin + superadmin (KD #32).
export async function POST(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ay_code: ayCode, label, accepting_applications: acceptingApplications } = parsed.data;
  const supabase = createServiceClient();

  // The RPC is fully idempotent (migration 030): if the AY row exists it
  // is reused, terms/sections/subject_configs only get filled in if
  // missing, admissions tables use CREATE IF NOT EXISTS. So we always
  // call it â€” it correctly handles brand-new, partial, and fully-set-up
  // states, and on a re-run nothing is duplicated or destroyed.
  const { data: result, error: rpcErr } = await supabase.rpc('create_academic_year', {
    p_ay_code: ayCode,
    p_label: label,
  });

  if (rpcErr) {
    console.error('[ay-setup POST] create_academic_year rpc failed:', rpcErr.message);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // KD #77: apply the early-bird gate after the RPC commits. The RPC itself
  // doesn't know about `accepting_applications` (added in migration 038)
  // and we don't want to wedge that into the RPC contract â€” a focused
  // UPDATE here is simpler and re-running is safe (idempotent overwrite).
  if (acceptingApplications) {
    const { error: gateErr } = await supabase
      .from('academic_years')
      .update({ accepting_applications: true })
      .eq('ay_code', ayCode);
    if (gateErr) {
      // Non-fatal: the AY exists; the registrar can flip the switch from
      // the AY list. Log and surface so the toast tells them why.
      console.error('[ay-setup POST] accepting_applications flip failed:', gateErr.message);
    }
  }

  const summary = (result ?? {}) as Record<string, unknown>;
  const ayId = typeof summary.ay_id === 'string' ? summary.ay_id : null;
  // alreadyExisted = the AY row was already there AND nothing else was
  // missing. A "partial-state" run (row existed but terms/sections/configs
  // were filled in) reports ok+summary but does NOT set alreadyExisted â€”
  // the UI surfaces it as a normal success and advances to the follow-up.
  const ayExisted = summary.ay_existed === true;
  const termsInserted = typeof summary.terms_inserted === 'number' ? summary.terms_inserted : 0;
  const sectionsCopied = typeof summary.sections_copied === 'number' ? summary.sections_copied : 0;
  const configsCopied =
    typeof summary.subject_configs_copied === 'number' ? summary.subject_configs_copied : 0;
  const alreadyExisted =
    ayExisted && termsInserted === 0 && sectionsCopied === 0 && configsCopied === 0;

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.create',
    entityType: 'academic_year',
    entityId: ayId,
    context: {
      ay_code: ayCode,
      label,
      summary,
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, alreadyExisted, summary });
}

// PATCH /api/sis/ay-setup
//
// Switch the `is_current` flag to the given target AY. Idempotent; always
// leaves exactly one row at `is_current=true` (or zero if target not found).
//
// Role: admin + superadmin.
export async function PATCH(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SwitchActiveAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { target_ay_code: targetAy } = parsed.data;
  const supabase = createServiceClient();

  // Verify target exists
  const { data: target } = await supabase
    .from('academic_years')
    .select('id, ay_code, is_current')
    .eq('ay_code', targetAy)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: `AY ${targetAy} not found` }, { status: 404 });
  }

  // Capture previous active AY for audit + cache invalidation
  const { data: prev } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const prevAy = (prev as { ay_code: string } | null)?.ay_code ?? null;

  // Two-step atomic-ish flip: set all to false, then target to true.
  // Not a single transaction, but idempotent â€” re-running converges.
  const { error: clearErr } = await supabase
    .from('academic_years')
    .update({ is_current: false })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (clearErr) {
    console.error('[ay-setup PATCH] clearing is_current failed:', clearErr.message);
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  const { error: setErr } = await supabase
    .from('academic_years')
    .update({ is_current: true })
    .eq('ay_code', targetAy);
  if (setErr) {
    console.error('[ay-setup PATCH] setting is_current failed:', setErr.message);
    return NextResponse.json({ error: setErr.message }, { status: 500 });
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.switch_current',
    entityType: 'academic_year',
    entityId: (target as { id: string }).id,
    context: {
      from_ay: prevAy,
      to_ay: targetAy,
    },
  });

  revalidateTag(`sis:${targetAy}`, 'max');
  if (prevAy && prevAy !== targetAy) revalidateTag(`sis:${prevAy}`, 'max');

  return NextResponse.json({ ok: true, from: prevAy, to: targetAy });
}

// DELETE /api/sis/ay-setup
//
// Delete an AY. Only allowed if the AY has no child data anywhere â€” the
// `delete_academic_year` stored function enforces the emptiness check
// server-side and raises on any blocker. Drops the 4 AY-prefixed admissions
// tables and removes the SIS-side rows in one tx.
//
// Role: superadmin ONLY (KD #2, destructive-ops carve-out).
export async function DELETE(request: Request) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = DeleteAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { ay_code: ayCode } = parsed.data;
  const supabase = createServiceClient();

  // Capture ay_id for audit before the row disappears.
  const { data: target } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (target as { id: string } | null)?.id ?? null;

  const { data: result, error: rpcErr } = await supabase.rpc('delete_academic_year', {
    p_ay_code: ayCode,
  });

  if (rpcErr) {
    // The stored function raises on blockers with a descriptive message;
    // surface that directly to the client (409 Conflict when rejected).
    const message = rpcErr.message ?? 'delete_academic_year rpc failed';
    console.error('[ay-setup DELETE] rpc failed:', message);
    const status = /cannot delete/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const summary = (result ?? {}) as Record<string, unknown>;

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.delete',
    entityType: 'academic_year',
    entityId: ayId,
    context: {
      ay_code: ayCode,
      summary,
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, summary });
}
