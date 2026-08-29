import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
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
// Permission: academic_year.create (school_admin + superadmin today).
export async function POST(request: Request) {
  const auth = await requireCapability('academic_year.create');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ay_code: ayCode, label } = parsed.data;
  const supabase = createServiceClient();

  // The RPC is fully idempotent (migration 030): if the AY row exists it
  // is reused, terms/sections/subject_configs only get filled in if
  // missing, admissions tables use CREATE IF NOT EXISTS. So we always
  // call it â€” it correctly handles brand-new, partial, and fully-set-up
  // states, and on a re-run nothing is duplicated or destroyed.
  const { data: result, error: rpcErr } = await supabase.rpc(
    'create_academic_year',
    {
      p_ay_code: ayCode,
      p_label: label,
    }
  );

  if (rpcErr) {
    console.error(
      '[ay-setup POST] create_academic_year rpc failed:',
      rpcErr.message
    );
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const summary = (result ?? {}) as Record<string, unknown>;
  const ayId = typeof summary.ay_id === 'string' ? summary.ay_id : null;
  // alreadyExisted = the AY row was already there AND nothing else was
  // missing. A "partial-state" run (row existed but terms/sections/configs
  // were filled in) reports ok+summary but does NOT set alreadyExisted â€”
  // the UI surfaces it as a normal success and advances to the follow-up.
  const ayExisted = summary.ay_existed === true;
  const termsInserted =
    typeof summary.terms_inserted === 'number' ? summary.terms_inserted : 0;
  const sectionsSeeded =
    typeof summary.sections_seeded === 'number' ? summary.sections_seeded : 0;
  const configsSeeded =
    typeof summary.subject_configs_seeded === 'number'
      ? summary.subject_configs_seeded
      : 0;
  const alreadyExisted =
    ayExisted &&
    termsInserted === 0 &&
    sectionsSeeded === 0 &&
    configsSeeded === 0;

  // Skip the audit when the RPC did nothing at all. `alreadyExisted` is
  // exactly that condition and was already computed here for the response —
  // it just wasn't used to gate the log, so re-submitting the create form for
  // an existing AY wrote another `ay.create` row.
  //
  // Note this is deliberately NOT gated on `ayExisted` alone: a partial-state
  // run (the AY row existed but terms/sections/configs were filled in) IS a
  // real change and must still be audited.
  if (!alreadyExisted) {
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
  }

  revalidateTag(`sis:${ayCode}`, 'max');
  // `create_academic_year` writes this AY's term rows, which `loadTerms`
  // (lib/dashboard/windows.ts) caches globally.
  revalidateTag('dashboard-windows', 'max');

  return NextResponse.json({ ok: true, alreadyExisted, summary });
}

// PATCH /api/sis/ay-setup
//
// Switch the `is_current` flag to the given target AY. Idempotent; always
// leaves exactly one row at `is_current=true` (or zero if target not found).
//
// Permission: academic_year.edit (school_admin + superadmin today).
export async function PATCH(request: Request) {
  const auth = await requireCapability('academic_year.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SwitchActiveAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
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
    return NextResponse.json(
      { error: `AY ${targetAy} not found` },
      { status: 404 }
    );
  }

  // Capture previous active AY for audit + cache invalidation
  const { data: prev } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const prevAy = (prev as { ay_code: string } | null)?.ay_code ?? null;

  // One atomic switch (migration 095). This was previously two separate
  // updates — clear is_current everywhere, then set the target — plus two more
  // for the application windows, none of them transactional. A failure between
  // the first two left EVERY row is_current=false, which breaks sections,
  // grading, attendance and every dashboard school-wide, because they all do
  // `.eq('is_current', true).single()`.
  //
  // The RPC does the clear, the set, and both accepting_applications
  // follow-ups in one transaction, so that window no longer exists. The
  // window rules themselves are unchanged (KD #118): the new current AY opens,
  // the outgoing one closes — the close is a correctness requirement, since a
  // retired year left accepting would impersonate the early-bird upcoming AY.
  //
  // The old code treated the two window updates as best-effort and only
  // console.error'd them, so the route could return ok:true half-applied.
  // Inside the transaction they either all land or none do.
  const { data: switchResult, error: switchErr } = await supabase.rpc(
    'set_current_academic_year',
    { p_ay_code: targetAy }
  );
  if (switchErr) {
    console.error('[ay-setup PATCH] switch failed:', switchErr.message);
    return NextResponse.json({ error: switchErr.message }, { status: 500 });
  }
  const switched = (switchResult ?? {}) as {
    previous_ay?: string | null;
    accepting_closed?: string | null;
  };

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.switch_current',
    entityType: 'academic_year',
    entityId: (target as { id: string }).id,
    context: {
      // Prefer the values the RPC actually acted on over the pre-read — under
      // a concurrent switch the pre-read can already be stale, and the audit
      // should record what happened, not what we expected to happen.
      from_ay: switched.previous_ay ?? prevAy,
      to_ay: targetAy,
      accepting_opened: targetAy,
      accepting_closed: switched.accepting_closed ?? null,
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
// Permission: academic_year.delete — superadmin only today (KD #2,
// destructive-ops carve-out), and its own action precisely so that granting
// someone the right to CREATE or CONFIGURE a year never also grants deleting
// one.
export async function DELETE(request: Request) {
  const auth = await requireCapability('academic_year.delete');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = DeleteAySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
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

  const { data: result, error: rpcErr } = await supabase.rpc(
    'delete_academic_year',
    {
      p_ay_code: ayCode,
    }
  );

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
  // `delete_academic_year` removes this AY's term rows, which `loadTerms`
  // (lib/dashboard/windows.ts) caches globally.
  revalidateTag('dashboard-windows', 'max');

  return NextResponse.json({ ok: true, summary });
}
