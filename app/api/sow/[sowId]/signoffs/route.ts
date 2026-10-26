import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { RecordSowSignoffSchema } from '@/lib/schemas/sow';
import { recordSignoff } from '@/lib/sow/oversight';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/[sowId]/signoffs — the subject head's "Sign Week N" or "Ask
// the teacher" on one class's week (board 11).
//
// The role gate is wide on purpose: being a subject head is data, not a role,
// so it is decided in `recordSignoff` (a head of THIS scheme's subject, for
// its half). Everyone else — the office included — gets "Only the subject
// head signs off weeks."
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
  const parsed = RecordSowSignoffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'That could not be saved.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await recordSignoff(
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
    return NextResponse.json({ ok: true, signoffId: result.signoffId });
  } catch (e) {
    console.error(
      '[sow.signoff] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save that. Please try again.' },
      { status: 500 }
    );
  }
}
