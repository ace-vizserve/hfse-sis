import { NextResponse } from 'next/server';

import { corsHeaders } from '@/lib/cors';
import { authenticateParent } from '@/lib/events/parent-auth';
import { loadParentEventList } from '@/lib/events/parent';
import { createServiceClient } from '@/lib/supabase/service';

// Events a parent can answer, and the ones their family already has. Called by
// the admissions portal with the parent's Bearer token (KD #195).

const CORS_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), CORS_METHODS),
  });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'), CORS_METHODS);
  try {
    const auth = await authenticateParent(request, cors, {
      scope: 'parent-events',
      ipMax: 30,
      userMax: 20,
    });
    if (!auth.ok) return auth.response;

    const ay = new URL(request.url).searchParams.get('ay');
    if (ay !== null && !/^AY\d{4}$/.test(ay)) {
      return NextResponse.json(
        { error: 'bad query' },
        { status: 400, headers: cors }
      );
    }

    const result = await loadParentEventList(createServiceClient(), {
      email: auth.email,
      filable: auth.students,
      ayCode: ay,
      now: new Date(),
    });
    return NextResponse.json(result, { headers: cors });
  } catch (err) {
    console.error('[parent-events] list load failed', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: cors }
    );
  }
}
