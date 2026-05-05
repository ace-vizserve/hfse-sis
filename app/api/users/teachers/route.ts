import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/users/teachers â€” list Supabase auth users whose app_metadata.role
// is 'teacher'. Used by the assignments UI to populate the teacher picker.
// Registrar+ only.
export async function GET() {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  // listUsers is paged; 1000 is plenty for a single school.
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const teachers = data.users
    .filter(u => (u.app_metadata as Record<string, unknown>)?.role === 'teacher')
    .map(u => ({
      id: u.id,
      email: u.email ?? null,
      display_name:
        ((u.user_metadata as Record<string, unknown> | null)?.full_name as string | undefined) ??
        u.email ??
        u.id,
    }));

  return NextResponse.json({ teachers });
}
