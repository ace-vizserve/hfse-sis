import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getEnrolmentPosition } from '@/lib/sis/terms';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole([
    'registrar',
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
