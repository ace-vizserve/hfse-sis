import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getEnrolmentPosition } from '@/lib/sis/terms';

// No `export const dynamic = 'force-dynamic'` — Cache Components rejects the
// route segment config outright, and it was redundant here anyway: this
// handler reads cookies (via requireRole) and `req.nextUrl.searchParams`, and
// either one already makes it dynamic. This was the only such export in the
// whole of `app/`.
export async function GET(req: NextRequest) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
    'admissions',
    'teacher',
  ]);
  if (auth instanceof NextResponse) return auth;

  const ayCode = req.nextUrl.searchParams.get('ay');
  if (!ayCode)
    return NextResponse.json({ error: 'ay required' }, { status: 400 });

  const position = await getEnrolmentPosition(ayCode);
  return NextResponse.json({ position });
}
