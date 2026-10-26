import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { SaveReliefNoteSchema } from '@/lib/schemas/sow';
import { saveReliefNote } from '@/lib/sow/relief';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/relief-notes — a relief teacher's "What did you cover?"
// (boards 13–14). Saving again the same day replaces that day's note.
//
// The role gate is wide on purpose: anyone who can teach can be asked to
// cover. What decides it is the cover itself — live today, on that class for
// that subject — checked in `saveReliefNote`, with the same refusals as the
// lesson page.
const ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

export async function POST(request: Request) {
  const auth = await requireRole([...ROLES]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SaveReliefNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'That note could not be saved.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await saveReliefNote(
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
    return NextResponse.json({ ok: true, weekNumber: result.weekNumber });
  } catch (e) {
    console.error(
      '[sow.relief_note] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not save your note. Please try again.' },
      { status: 500 }
    );
  }
}
