import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// POST /api/grading-sheets/[id]/lock — registrar+ only.
// Locks a grading sheet. Teachers become read-only; registrar can still edit,
// but every post-lock edit requires an approval_reference and is audit-logged.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();
  const lockedBy = auth.user.email ?? auth.user.id;

  // No-op guard: re-POSTing on an already-locked sheet would re-stamp
  // locked_at/updated_at and write a duplicate sheet.lock audit row. Bail out
  // before any write when the sheet is already locked. (bulk-lock guards the
  // same way.)
  const { data: existing, error: existingErr } = await service
    .from('grading_sheets')
    .select('is_locked')
    .eq('id', id)
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (existing.is_locked) {
    return NextResponse.json({ ok: true, already_locked: true });
  }

  const { data, error } = await service
    .from('grading_sheets')
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: lockedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, is_locked, locked_at, locked_by')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'lock failed' },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.lock',
    entityType: 'grading_sheet',
    entityId: id,
    context: { locked_at: data.locked_at, locked_by: data.locked_by },
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ sheet: data });
}
