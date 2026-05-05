import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { searchStudentsAcrossAY } from '@/lib/sis/queries';

// GET /api/sis/search?q=... â€” cross-AY student lookup for the SIS sidebar
// search box. Service-role inside the helper, capped at 50 rows. Returns
// 401/403 for non-staff. 200 with empty array if q is too short.
export async function GET(request: Request) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await searchStudentsAcrossAY(q);
  return NextResponse.json({ matches });
}
