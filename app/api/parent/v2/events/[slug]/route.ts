import { NextResponse } from 'next/server';

import { corsHeaders } from '@/lib/cors';
import { authenticateParent } from '@/lib/events/parent-auth';
import { loadParentEventDetail } from '@/lib/events/parent';
import { createServiceClient } from '@/lib/supabase/service';

// One event's form for the signed-in parent, with their family's answers so
// far. 404 when the event is unpublished or is not for any of their children.

const CORS_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);
  try {
    const auth = await authenticateParent(request, cors, {
      scope: 'parent-events',
      ipMax: 30,
      userMax: 20,
    });
    if (!auth.ok) return auth.response;

    const { slug } = await params;
    const detail = await loadParentEventDetail(createServiceClient(), {
      email: auth.email,
      filable: auth.students,
      slug,
      now: new Date(),
    });
    if (!detail) {
      return NextResponse.json(
        { error: 'event not found' },
        { status: 404, headers: cors }
      );
    }
    return NextResponse.json(detail, { headers: cors });
  } catch (err) {
    console.error('[parent-events] event load failed', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: cors }
    );
  }
}
