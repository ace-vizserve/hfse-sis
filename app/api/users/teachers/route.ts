import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { getTeacherList } from '@/lib/auth/staff-list';

// GET /api/users/teachers — list Supabase auth users whose app_metadata.role
// is 'teacher'. Used by the assignments UI to populate the teacher picker.
// Registrar+ only.
export async function GET() {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const list = await getTeacherList();
  const teachers = list.map((u) => ({
    id: u.id,
    email: u.email,
    display_name: u.name,
  }));

  return NextResponse.json({ teachers });
}
