import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getSectionRoster } from '@/lib/evaluation/queries';

// GET /api/evaluation/sections/[sectionId]/roster?term=<termId>
//
// The write-up roster, so the client can hold it in TanStack Query rather than
// as a one-shot server prop — matching how the attendance register's stat cards
// work, so the two surfaces read the same way.
//
// ⚠ A ROUTE, NOT A DIRECT supabase-js READ, for the same reason as the
// attendance summary endpoint: this is a three-table join
// (section_students → students → evaluation_writeups) that also normalises the
// rich-text column and drops withdrawn students. Rebuilding that client-side
// would put a second copy of those rules in the app. Calling the existing
// loader keeps one.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ sectionId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { sectionId } = await ctx.params;
  const termId = new URL(req.url).searchParams.get('term');
  if (!termId) {
    return NextResponse.json({ error: 'term is required' }, { status: 400 });
  }

  const roster = await getSectionRoster(sectionId, termId);
  return NextResponse.json(roster, {
    // Refetched precisely because a save just changed it.
    headers: { 'Cache-Control': 'no-store' },
  });
}
