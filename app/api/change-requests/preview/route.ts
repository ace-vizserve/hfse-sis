import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { getSidebarChangeRequestPreview } from '@/lib/change-requests/sidebar-counts';

// GET /api/change-requests/preview
// Backs the header notification bell's dropdown panel. Returns up to 5 rows
// scoped identically to the sidebar badge count
// (getSidebarChangeRequestCount) — see that function's doc comment for the
// per-role rules — so the panel's list can never disagree with the number
// shown on the bell.
export async function GET(_request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const rows = await getSidebarChangeRequestPreview(
    service,
    auth.role,
    auth.user.id,
    5
  );

  return NextResponse.json({ rows });
}
