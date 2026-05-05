import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { getDocumentRevisions } from '@/lib/p-files/queries';

// GET /api/p-files/[enroleeNumber]/revisions?slotKey=...
// Returns the archived revisions for one document slot, newest first.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole(['p-file', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const slotKey = request.nextUrl.searchParams.get('slotKey');

  if (!slotKey) {
    return NextResponse.json({ error: 'slotKey is required' }, { status: 400 });
  }
  if (!DOCUMENT_SLOTS.some((s) => s.key === slotKey)) {
    return NextResponse.json({ error: `invalid slotKey: ${slotKey}` }, { status: 400 });
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);
  const revisions = await getDocumentRevisions(ayCode, enroleeNumber, slotKey);

  return NextResponse.json({ revisions });
}
