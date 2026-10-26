import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { PatchSowModuleSchema } from '@/lib/schemas/sow';
import { updateModule } from '@/lib/sow/edit';
import { loadSowView } from '@/lib/sow/read';
import { createServiceClient } from '@/lib/supabase/service';

const ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

// GET /api/sow/[sowId] — the scheme as the page reads it. A scheme the caller
// cannot read is a 404, so its existence is not confirmed.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  try {
    const view = await loadSowView(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId
    );
    if (!view) {
      return NextResponse.json(
        { error: 'That scheme of work could not be found.' },
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (e) {
    console.error(
      '[sow.read] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not open the scheme of work. Please try again.' },
      { status: 500 }
    );
  }
}

// PATCH /api/sow/[sowId] — save the module details. `updateModule` decides who
// may and refuses a stale save.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = PatchSowModuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Those details could not be saved.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await updateModule(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId,
      parsed.data.module,
      parsed.data.expectedUpdatedAt
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
  } catch (e) {
    console.error(
      '[sow.edit] module failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save. Please try again.' },
      { status: 500 }
    );
  }
}
