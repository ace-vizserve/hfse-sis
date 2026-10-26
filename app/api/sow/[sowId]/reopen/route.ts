import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { ReopenSowSchema } from '@/lib/schemas/sow';
import { reopenSow } from '@/lib/sow/approval';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/[sowId]/reopen — put an approved scheme of work back to draft.
// The office only; a teacher asks the office to reopen it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = ReopenSowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Say why it is being reopened.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await reopenSow(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId,
      parsed.data.note
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      '[sow.reopen] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not reopen it. Please try again.' },
      { status: 500 }
    );
  }
}
