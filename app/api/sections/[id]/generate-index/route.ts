import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// The RPC's return shape (migration 147). `rows_renumbered` is the count of
// non-withdrawn rows — it has always been the whole class, not the rows that
// moved — and `rows_changed` is how many actually move. Each `after` row
// carries its own `old_index`, so a caller can diff without joining `before`.
type IndexRunResult = {
  rows_renumbered: number;
  rows_changed: number;
  dry_run: boolean;
  before: Array<{
    id: string;
    student_number: string | null;
    name: string;
    old_index: number | null;
    enrollment_status: string;
  }>;
  after: Array<{
    id: string;
    student_number: string | null;
    name: string;
    old_index: number | null;
    new_index: number;
    enrollment_status: string;
  }>;
};

// GET /api/sections/[id]/generate-index
//
// Previews what POST would do, writing nothing — `p_dry_run = true` on the same
// RPC, so the preview and the write are produced by one implementation and
// cannot disagree. Feeds the before→after table in the confirm dialog.
//
// This exists because Generate is a DERIVATION, not an edit: it recomputes the
// roster from names, enrollment_date and the burned set, and is deterministic.
// A wrong result used to be discovered only after it was written, and clicking
// Generate again just reproduced it. Now it is visible first.
//
// Same capability as the POST — seeing the numbers is strictly less than
// setting them, and nobody without `sections.edit` has a reason to be here.
export async function GET(
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
  const { data, error } = await service.rpc('generate_section_index_numbers', {
    p_section_id: id,
    p_dry_run: true,
  });

  if (error) {
    console.error('[generate-index:preview] RPC error', error.message);
    return NextResponse.json(
      { error: error.message ?? 'Could not preview the class index' },
      { status: 500 }
    );
  }

  const result = data as IndexRunResult;
  return NextResponse.json({
    rows_renumbered: result.rows_renumbered,
    rows_changed: result.rows_changed,
    before: result.before,
    after: result.after,
  });
}

// POST /api/sections/[id]/generate-index
//
// Calls `generate_section_index_numbers(p_section_id, p_dry_run)` (migration
// 147, superseding 071/072) which assigns sequential index numbers to the
// section's roster. Returns { rows_renumbered, rows_changed } — the toast
// reports rows_changed, which is the students who actually moved, not the size
// of the class. GET above is the same call with p_dry_run, for the preview.
//
// Auth: the `sections.edit` capability — a structural roster operation, the
//       same gate as bulk-lock and the swap route.
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

  const result = data as IndexRunResult;

  // Skip the audit when nothing actually moved — an empty section, or a re-run
  // where every row already holds its target index. The RPC is deterministic,
  // so a second click is genuinely a no-op; logging it anyway implied the
  // roster had been renumbered twice, which is precisely the question this
  // action's audit rows exist to answer.
  //
  // This used to test `rows_renumbered === 0`, which is the count of
  // non-withdrawn rows and so only ever fired on an empty section — the
  // no-op re-run it describes was logged every time. `rows_changed` (migration
  // 147) is the honest number and makes the guard do what it always said.
  if (result.rows_changed === 0) {
    return NextResponse.json({
      ok: true,
      changed: false,
      rows_renumbered: result.rows_renumbered,
      rows_changed: 0,
    });
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
      rows_changed: result.rows_changed,
      before: result.before,
      after: result.after,
    },
  });

  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({
    ok: true,
    changed: true,
    rows_renumbered: result.rows_renumbered,
    rows_changed: result.rows_changed,
  });
}
