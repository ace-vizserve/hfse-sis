import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { CreateSowSchema } from '@/lib/schemas/sow';
import { createSow } from '@/lib/sow/create';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow — start a scheme of work for a subject and level in a term,
// blank or copied from last year's approved one.
//
// Any role can be a teacher, so the gate admits them all and `createSow`
// decides: the caller must hold the subject (substantive subject or co-teacher
// assignment) on a ticked class. Holding no assignment is a 403 there.
export async function POST(request: Request) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateSowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Pick the classes and how to start.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await createSow(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      parsed.data
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, sowId: result.sowId });
  } catch (e) {
    console.error(
      '[sow.create] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not start the scheme of work. Please try again.' },
      { status: 500 }
    );
  }
}
