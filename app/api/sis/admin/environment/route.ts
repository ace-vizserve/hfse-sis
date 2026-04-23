import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { EnvironmentSwitchSchema } from '@/lib/schemas/environment';
import {
  listEnvironmentAys,
  resetTestEnvironment,
  switchEnvironment,
} from '@/lib/sis/environment';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/environment
// Body: { target: 'production' | 'test' }
//
// Switches the active AY via the Environment abstraction:
//   - 'test'        → ensures AY9999 exists (creates via create_academic_year
//                     RPC if missing), flips is_current, auto-seeds students
//                     if the test AY has zero enrolments.
//   - 'production'  → finds the non-AY9* AY and flips is_current.
//
// Superadmin only. Every other role is routed here via 403.
export async function POST(request: Request) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = EnvironmentSwitchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { target } = parsed.data;
  const service = createServiceClient();

  try {
    const result = await switchEnvironment(service, target);

    // Resolve the destination AY id for audit.entity_id.
    const { current } = await listEnvironmentAys(service);

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'environment.switch',
      entityType: 'academic_year',
      entityId: current?.id ?? null,
      context: {
        from_ay: result.fromAyCode,
        to_ay: result.toAyCode,
        to_environment: result.toEnvironment,
        seeded: result.seed !== null,
      },
    });

    if (result.structure || result.seed || result.populated) {
      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: 'environment.seed',
        entityType: 'academic_year',
        entityId: current?.id ?? null,
        context: {
          ay_code: result.toAyCode,
          structure: result.structure,
          populated: result.populated,
          students_inserted: result.seed?.students_inserted ?? 0,
          section_count: result.seed?.section_count ?? 0,
        },
      });
    }

    // Flush every AY-keyed cache across every module. Broad brush but
    // correct — the active AY just changed, and any unstable_cache entry
    // tagged with the previous AY's code is now stale.
    revalidatePath('/', 'layout');

    return NextResponse.json({
      ok: true,
      from: result.fromAyCode,
      to: result.toAyCode,
      environment: result.toEnvironment,
      seed: result.seed,
      structure: result.structure,
      populated: result.populated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'environment switch failed';
    console.error('[environment POST] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/sis/admin/environment
//
// Destructive reset: wipes every child row hanging off the AY9* test AY
// (grade entries, attendance, evaluations, publications, teacher
// assignments, enrolments, seeded test students, p-file revisions,
// admissions rows) then calls the `delete_academic_year` RPC to drop the
// ay{YY}_* admissions tables + remove the SIS-side reference rows. Switches
// active to Production first if the test AY is currently active — you
// can't delete an AY that's is_current.
//
// Guarded three ways: superadmin role, test-AY pattern (`^AY9`) inside the
// helper, and the RPC's own guard. Safe to call against a populated test
// AY; refuses against a production AY.
export async function DELETE() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  try {
    const result = await resetTestEnvironment(service);

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'environment.switch',
      entityType: 'academic_year',
      entityId: null,
      context: {
        action: 'reset_test',
        ay_code: result.ayCode,
        switched_from_active: result.switchedFromActive,
        deleted: result.deleted,
      },
    });

    revalidatePath('/', 'layout');

    return NextResponse.json({
      ok: true,
      ayCode: result.ayCode,
      switchedFromActive: result.switchedFromActive,
      deleted: result.deleted,
      rpcSummary: result.rpcSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'test env reset failed';
    console.error('[environment DELETE] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
