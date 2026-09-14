import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getSectionAttendanceSummary } from '@/lib/attendance/queries';

// GET /api/attendance/sections/[sectionId]/summary?term=<termId>
//
// The stat cards above the register, on their own so they can be refetched
// without re-rendering the page.
//
// WHY THIS EXISTS. Marking one cell used to await a full `router.refresh()` —
// 800ms to 3.3s — purely so these four numbers could catch up, because they
// arrived as server props and nothing on the client owned them. The mark itself
// now goes straight to Supabase (migration 149) and the grid invalidates this
// query instead, so a save costs one insert and one small read rather than a
// whole page render.
//
// ⚠ A ROUTE RATHER THAN A DIRECT supabase-js READ, DELIBERATELY. Every table
// this needs is readable from the browser under RLS, so a client-side version
// is possible — but the summary is not a table read. It combines the rollup,
// the calendar and the enrolment list, and prorates for late joiners
// (`lib/attendance/section-summary.ts`). Reimplementing that client-side would
// put a second copy of those rules in the app, which is how a card and the
// register start disagreeing. Calling the existing function over HTTP keeps one
// copy. If it ever needs to be a direct read, the move is to make it a Postgres
// function — not to rewrite the arithmetic in TypeScript twice.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ sectionId: string }> }
) {
  // Same role set the register page admits; the per-section narrowing is the
  // RLS policy's job on the reads underneath.
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

  const summary = await getSectionAttendanceSummary(sectionId, termId);
  return NextResponse.json(summary, {
    // Not cached: this is refetched precisely because a mark just changed it.
    headers: { 'Cache-Control': 'no-store' },
  });
}
