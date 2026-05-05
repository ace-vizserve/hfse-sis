import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';

// POST /api/grading-sheets/[id]/unlock — registrar+ only.
// Unlocking restores teacher edit access. The audit log is NEVER purged;
// unlocking simply gates future edits off the approval_reference check.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const { data, error } = await service
    .from('grading_sheets')
    .update({
      is_locked: false,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, is_locked, locked_at, locked_by')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'unlock failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.unlock',
    entityType: 'grading_sheet',
    entityId: id,
    context: {},
  });

  return NextResponse.json({ sheet: data });
}
