import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { resolveRequestAyCode } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { getDocumentRevisions } from '@/lib/p-files/queries';

// GET /api/p-files/[enroleeNumber]/revisions?slotKey=...
// Returns the archived revisions for one document slot, newest first.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole(['admissions', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const slotKey = request.nextUrl.searchParams.get('slotKey');

  if (!slotKey) {
    return NextResponse.json({ error: 'slotKey is required' }, { status: 400 });
  }
  if (!DOCUMENT_SLOTS.some((s) => s.key === slotKey)) {
    return NextResponse.json(
      { error: `invalid slotKey: ${slotKey}` },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  // ⚠ `?ay`, NOT the current year. This one was the worst of the five: a READ
  // that resolved the wrong year returned that year's revision history with a
  // 200, so it read as data rather than as an error.
  const ayResolved = await resolveRequestAyCode(service, request);
  if ('error' in ayResolved) {
    return NextResponse.json({ error: ayResolved.error }, { status: 400 });
  }
  const { ayCode } = ayResolved;
  const revisions = await getDocumentRevisions(ayCode, enroleeNumber, slotKey);

  return NextResponse.json({ revisions });
}
