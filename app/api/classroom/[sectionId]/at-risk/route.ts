import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import { loadSectionAtRisk } from '@/lib/classroom/at-risk-source';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadReportCard } from '@/lib/classroom/scope';

// GET /api/classroom/[sectionId]/at-risk?term_id=...
//
// Ms Koh's ask (2026-07-31, 55:10), the half a subject teacher's grading sheet
// cannot answer: which students in THIS class have slipped, across every
// subject the class takes, ranked by how far.
//
// ADVISER AND OVERSIGHT ONLY — `canReadReportCard`, not `canReadRoster`. A
// subject teacher already has this for their own subject on their own sheet
// (KD #179); handing them every other subject's marks for the whole class is a
// different thing entirely, and it is the same line the report card draws for
// the same reason. Koh named "the subject teacher OR the FCA" as the two people
// who would ring home, and each now has the view their own job needs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sectionId: string }> }
): Promise<NextResponse> {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth && auth.error) return auth.error;

  const { sectionId } = await params;
  const { user, role } = auth as { user: { id: string }; role: Role };

  const termId = new URL(request.url).searchParams.get('term_id');
  if (!termId) {
    return NextResponse.json({ error: 'term_id required' }, { status: 400 });
  }

  let step = 'capability';
  try {
    const { capability } = await loadClassroomAccess(role, user.id, sectionId);
    if (!canReadReportCard(capability)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'at-risk lookup';
    return NextResponse.json({
      students: await loadSectionAtRisk(sectionId, termId),
    });
  } catch (e) {
    console.error(
      `[classroom] at-risk failed at "${step}" for section ${sectionId} term ${termId}:`,
      e instanceof Error ? (e.stack ?? e.message) : e
    );
    return NextResponse.json(
      {
        error: 'lookup failed',
        step,
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { detail: e instanceof Error ? e.message : String(e) }),
      },
      { status: 500 }
    );
  }
}
