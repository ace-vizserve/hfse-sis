import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { getAssignableStaffList } from '@/lib/auth/staff-list';

// GET /api/users/teachers — the people who may be recorded as teaching a
// class. Used by the section Teachers tab to refresh its picker after a write
// (components/sis/section-teachers-tab.tsx). Registrar+ only.
//
// ⚠ ANY STAFF ROLE, not just `teacher`, and the path name is now a little
// behind the meaning. It has to match what POST /api/teacher-assignments will
// actually accept — a picker narrower than its route offers no way to fix the
// six school_admin accounts that already hold classes, and a picker WIDER than
// its route would just serve 400s. The security property is unchanged and
// lives in `getAssignableStaffList`: parents share this Supabase project
// (KD #1) and carry no role, so they are excluded exactly as before.
export async function GET() {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const list = await getAssignableStaffList();
  const teachers = list.map((u) => ({
    id: u.id,
    email: u.email,
    display_name: u.name,
  }));

  return NextResponse.json({ teachers });
}
