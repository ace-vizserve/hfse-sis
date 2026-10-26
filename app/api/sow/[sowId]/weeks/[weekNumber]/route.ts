import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { PatchSowWeekSchema } from '@/lib/schemas/sow';
import { deleteWeek, updateWeek } from '@/lib/sow/edit';
import { createServiceClient } from '@/lib/supabase/service';

const ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

type Ctx = { params: Promise<{ sowId: string; weekNumber: string }> };

function parseWeek(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// PATCH /api/sow/[sowId]/weeks/[weekNumber] — save one week's fields.
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;
  const { sowId, weekNumber: rawWeek } = await params;
  const weekNumber = parseWeek(rawWeek);
  if (weekNumber === null) {
    return NextResponse.json(
      { error: 'That week could not be found.' },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchSowWeekSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'That week could not be saved.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await updateWeek(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId,
      weekNumber,
      parsed.data.fields,
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
      '[sow.edit] week failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save. Please try again.' },
      { status: 500 }
    );
  }
}

// DELETE /api/sow/[sowId]/weeks/[weekNumber] — remove a week the term no
// longer reaches. A term week is refused (clear its fields instead).
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;
  const { sowId, weekNumber: rawWeek } = await params;
  const weekNumber = parseWeek(rawWeek);
  if (weekNumber === null) {
    return NextResponse.json(
      { error: 'That week could not be found.' },
      { status: 404 }
    );
  }

  try {
    const result = await deleteWeek(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId,
      weekNumber
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
      '[sow.edit] delete week failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not delete the week. Please try again.' },
      { status: 500 }
    );
  }
}
