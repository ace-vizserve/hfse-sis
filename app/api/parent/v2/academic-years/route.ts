import { NextResponse } from 'next/server';

import { loadParentAcademicYears } from '@/lib/admissions/parent-academic-years-loader';
import { corsHeaders } from '@/lib/cors';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/parent/v2/academic-years
//
// The years a parent may apply for, and for which programme — what the
// portal's year picker (and its open-house buttons) is built from, instead of
// the cards it used to hardcode. A year is listed when HFSE
// (`accepting_applications`, KD #77/#118) or VizSchool
// (`vizschool_accepting_applications`, migration 176) is open for it; test
// years (`AY9…`) never are. Oldest first.
//
//   { years: [{ ayCode, isCurrent, hfseOpen, vizschoolOpen }] }
//
// ⚠ NO BEARER TOKEN, like `/api/parent/v2/admission-options` and for the same
// reason: the picker is shown before anyone signs in, and what it returns is
// not sensitive — which years the school is taking applications for, the same
// thing any visitor already sees on the portal. No student, parent or count.
//
// CORS and the IP rate limit mirror `admission-options` (same `corsHeaders`
// allowlist reflection, same 'parent-v2' scope and IP budget). No per-user
// limit because there is no user. No HTTP `Cache-Control`: the response
// reflects the request's Origin; freshness is the server cache's job
// (`parent-academic-years`, busted by every writer of either flag and by the
// switch of the current year).
//
// Unauthenticated reachability: `proxy.ts` excludes every `/api` path from its
// matcher, so the handler itself is the only gate.

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'));

  // IP-based limit — checked before any DB work.
  const ip = getClientIp(request);
  const ipRl = rateLimit({ ip, scope: 'parent-v2', ipMax: 30, windowSecs: 60 });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

  try {
    const years = await loadParentAcademicYears(createServiceClient());
    return NextResponse.json({ years }, { headers: cors });
  } catch {
    return NextResponse.json(
      { error: 'could not load academic years' },
      { status: 500, headers: cors }
    );
  }
}
