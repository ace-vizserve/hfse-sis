import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { submitSow } from '@/lib/sow/approval';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/[sowId]/submit — send a scheme of work for review. The role
// gate only keeps out people with no business here; `submitSow` decides who
// may (the scheme's own teachers, while it is a draft or returned).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  try {
    const result = await submitSow(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error(
      '[sow.submit] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not send it for review. Please try again.' },
      { status: 500 }
    );
  }
}
