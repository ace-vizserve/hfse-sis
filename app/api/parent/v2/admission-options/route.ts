import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { loadAdmissionOptions } from '@/lib/admissions/options-loader';
import {
  isServableAy,
  normalizeAyParam,
  toPublicOptions,
  type ServableAyCandidate,
} from '@/lib/admissions/options';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';

// GET /api/parent/v2/admission-options?ay=AY2027
//
// The level / class type / schedule combinations the parent enrolment forms
// may offer for one academic year (migration 174). OPEN rows only — a closed
// row must disappear from the form, so it never leaves the SIS. Schedules go
// out in the portal's own words ("Morning", "Afternoon", "Whole Day").
//
// ⚠ NO BEARER TOKEN, UNLIKE EVERY OTHER ROUTE UNDER /api/parent/v2. The
// portal's `/complete-enrolment/:token` page is public — the parent is not
// signed in — and it must build the same dropdowns. What this returns is not
// sensitive: it is the list of classes the school offers, the same text any
// visitor already sees on the form. No student, parent or count is in it.
// The gate that remains is on WHICH YEAR may be read: only the current year or
// one accepting applications, never a test year (`isServableAy`), so a past
// year's or an unopened year's configuration is not public.
//
// CORS and the IP rate limit mirror `app/api/parent/v2/levels/route.ts`
// (same `corsHeaders` allowlist reflection, same 'parent-v2' scope and IP
// budget). There is no per-user limit because there is no user.
//
// Deliberately no HTTP `Cache-Control`: the response reflects the request's
// Origin, and freshness is the server cache's job — `loadAdmissionOptions` is
// tagged `admission-options:<ay>` and every write busts it.
//
// Unauthenticated reachability: `proxy.ts` excludes every `/api` path from
// its matcher, so the session proxy never sees this route and cannot redirect
// it to the login page. The handler itself is the only gate.
//
// AY resolution uses the service client directly for the same reason the
// levels route gives: there is no session cookie on this request, so the
// cookie-scoped helpers in lib/academic-year.ts would read as `anon` and see
// no academic years at all.

type AyRow = ServableAyCandidate & { id: string };
const AY_COLUMNS = 'id, ay_code, is_current, accepting_applications';

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

  const rawAy = new URL(request.url).searchParams.get('ay');
  let ayCode: string | null = null;
  if (rawAy !== null) {
    ayCode = normalizeAyParam(rawAy);
    if (!ayCode) {
      return NextResponse.json(
        { error: 'ay must look like AY2027' },
        { status: 400, headers: cors }
      );
    }
  }

  const service = createServiceClient();

  let targetAy: AyRow | null;
  if (ayCode) {
    const { data, error } = await service
      .from('academic_years')
      .select(AY_COLUMNS)
      .eq('ay_code', ayCode)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: 'could not read academic years' },
        { status: 500, headers: cors }
      );
    }
    targetAy = data as AyRow | null;
  } else {
    // Same order as the levels route: the upcoming year (applications open,
    // not yet current, never a test year), else the current one.
    const { data: upcoming } = await service
      .from('academic_years')
      .select(AY_COLUMNS)
      .eq('accepting_applications', true)
      .eq('is_current', false)
      .not('ay_code', 'like', 'AY9%')
      .order('ay_code', { ascending: false })
      .limit(1)
      .maybeSingle();
    targetAy = upcoming as AyRow | null;
    if (!targetAy) {
      const { data: current } = await service
        .from('academic_years')
        .select(AY_COLUMNS)
        .eq('is_current', true)
        .maybeSingle();
      targetAy = current as AyRow | null;
    }
  }

  // One answer for "no such year" and "a year you may not read", so the
  // endpoint does not confirm which unopened years exist.
  if (!targetAy || !isServableAy(targetAy)) {
    return NextResponse.json(
      { error: 'no admission options for that academic year' },
      { status: 404, headers: cors }
    );
  }

  let rows;
  try {
    rows = await loadAdmissionOptions(service, targetAy.ay_code);
  } catch {
    return NextResponse.json(
      { error: 'could not load admission options' },
      { status: 500, headers: cors }
    );
  }

  return NextResponse.json(
    { ayCode: targetAy.ay_code, options: toPublicOptions(rows) },
    { headers: cors }
  );
}
