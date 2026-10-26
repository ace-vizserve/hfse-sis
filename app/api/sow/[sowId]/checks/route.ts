import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { RecordSowCheckSchema } from '@/lib/schemas/sow';
import { recordCheck } from '@/lib/sow/checks';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/[sowId]/checks — one class's weekly check (board 7). The page
// sends one request per class, so each class saves or refuses on its own.
//
// The role gate is wide on purpose: what decides it is the assignment (a
// subject or co-teacher on that class), checked in `recordCheck`, so an
// office user who also teaches the class can check it and one who does not
// is refused there.
const ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = RecordSowCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'That check could not be saved.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await recordCheck(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      { sowId, ...parsed.data }
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, checkId: result.checkId });
  } catch (e) {
    console.error(
      '[sow.check] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save the check. Please try again.' },
      { status: 500 }
    );
  }
}
