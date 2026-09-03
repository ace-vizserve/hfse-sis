import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/generate-index
//
// Calls the `generate_section_index_numbers(p_section_id)` RPC (migration 071)
// which assigns sequential index numbers to the section's roster. Returns
// { rows_renumbered } so the caller can surface the count in a toast.
//
// Auth: registrar | school_admin | superadmin (same gate as bulk-lock and
//       realphabetize — a structural roster operation).
//
// Cache: invalidates all operational drills for the AY because index numbers
//        appear across rosters in multiple modules.
//
// Audit: `section.index.generate` with sectionName + ayCode + before/after map
//        for the audit-log page (KD #9 / KD #121).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('sections.edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing section id' }, { status: 400 });
  }

  const service = createServiceClient();

  // Resolve the section → AY so we can invalidate caches and stamp the audit.
  const { data: sectionRow, error: sectionError } = await service
    .from('sections')
    .select('name, academic_year_id, academic_years!inner(ay_code)')
    .eq('id', id)
    .single();

  if (sectionError || !sectionRow) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  // `academic_years!inner(ay_code)` comes back as a joined object.
  const ayJoin = sectionRow.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;
  if (!ayCode) {
    return NextResponse.json(
      { error: 'Could not resolve academic year for section' },
      { status: 500 }
    );
  }

  const sectionName: string = sectionRow.name ?? id;

  // Call the RPC (migration 071).
  const { data, error: rpcError } = await service.rpc(
    'generate_section_index_numbers',
    { p_section_id: id }
  );

  if (rpcError) {
    console.error('[generate-index] RPC error', rpcError.message);
    return NextResponse.json(
      { error: rpcError.message ?? 'Failed to generate class index' },
      { status: 500 }
    );
  }

  // RPC returns jsonb: { rows_renumbered, before, after }
  const result = data as {
    rows_renumbered: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };

  // Skip the audit when the RPC renumbered nothing — an empty section, or a
  // re-run where every row already holds its target index. The RPC is
  // deterministic, so a second click is genuinely a no-op; logging it anyway
  // implied the roster had been renumbered twice, which is precisely the
  // question this action's audit rows exist to answer.
  if (result.rows_renumbered === 0) {
    return NextResponse.json({ ok: true, changed: false, rows_renumbered: 0 });
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'section.index.generate',
    entityType: 'section',
    entityId: id,
    context: {
      sectionName,
      ayCode,
      rows_renumbered: result.rows_renumbered,
      before: result.before,
      after: result.after,
    },
  });

  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({ rows_renumbered: result.rows_renumbered });
}
