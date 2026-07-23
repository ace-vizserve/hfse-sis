import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { computePublishReadiness } from '@/lib/markbook/publish-readiness';

// GET /api/sections/[id]/publish-readiness?term_id=...
// Returns checklist data for the pre-publish completeness check.
// Registrar+ only. The full computation lives in the shared evaluator
// `lib/markbook/publish-readiness.ts` (also consumed by the publish mutation so
// the checklist and the hard-block can never drift). The returned detail shape
// (grading_sheets / evaluations / attendance / t4_readiness / comment_gate) is
// unchanged for existing consumers; it now ALSO carries the verdict fields
// hardBlockers / softGaps / canPublish.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const termId = request.nextUrl.searchParams.get('term_id');
  if (!termId) {
    return NextResponse.json({ error: 'term_id is required' }, { status: 400 });
  }

  const service = createServiceClient();
  const readiness = await computePublishReadiness(service, sectionId, termId);
  if ('error' in readiness) {
    return NextResponse.json(
      { error: readiness.error },
      { status: readiness.status }
    );
  }

  return NextResponse.json(readiness);
}
