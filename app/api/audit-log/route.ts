import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';

// GET /api/audit-log?sheet_id=&entry_id=
// Returns post-lock edit history. Registrar / admin / superadmin only.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const supabase = await createClient();
  const sheetId = request.nextUrl.searchParams.get('sheet_id');
  const entryId = request.nextUrl.searchParams.get('entry_id');

  let q = supabase
    .from('grade_audit_log')
    .select(
      `id, field_changed, old_value, new_value, approval_reference, changed_by, changed_at,
       grading_sheet_id, grade_entry_id`,
    )
    .order('changed_at', { ascending: false })
    .limit(500);
  if (sheetId) q = q.eq('grading_sheet_id', sheetId);
  if (entryId) q = q.eq('grade_entry_id', entryId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
