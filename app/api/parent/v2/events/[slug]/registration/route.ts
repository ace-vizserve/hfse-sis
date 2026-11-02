import { NextResponse } from 'next/server';

import { corsHeaders } from '@/lib/cors';
import { authenticateParent } from '@/lib/events/parent-auth';
import { saveRegistration } from '@/lib/events/parent';
import { createServiceClient } from '@/lib/supabase/service';

// A parent saves their family's answers for one event; they can come back and
// save again until registration closes. Called by the admissions portal with
// the parent's Bearer token (KD #195).

const CORS_METHODS = 'PUT, OPTIONS';

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);
  try {
    const auth = await authenticateParent(request, cors, {
      scope: 'parent-events-write',
      ipMax: 20,
      userMax: 10,
    });
    if (!auth.ok) return auth.response;

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Please check your details and try again.' },
        { status: 400, headers: cors }
      );
    }

    const { slug } = await params;
    const result = await saveRegistration(createServiceClient(), {
      email: auth.email,
      userId: auth.userId,
      filable: auth.students,
      slug,
      now: new Date(),
      body,
    });
    return NextResponse.json(result.body, {
      status: result.status,
      headers: cors,
    });
  } catch (err) {
    console.error('[parent-events] registration save failed', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: cors }
    );
  }
}
