import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getLevelRows, getOfferedLevelIds } from '@/lib/sis/levels';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/cors';

// GET /api/parent/v2/levels
//
// Called by the admissions portal SPA. Returns the full level catalog (all
// grade levels, preschool through secondary) for the upcoming-or-current
// academic year, each with a `nextCode` progression pointer and an
// `offered` flag — lets the portal render "what level comes after this
// one" and which levels are actually open this year without hardcoding
// the ladder. Auth/CORS/rate-limit contract mirrors the students +
// report-card routes exactly (same Bearer verification via
// service.auth.getUser, same 'parent-v2' rate-limit scope + budget, same
// corsHeaders() allowlist reflection).
//
// AY resolution deliberately does NOT call
// getUpcomingAcademicYear()/getCurrentAcademicYear() from
// lib/academic-year.ts, even though the task interface names them: both
// wrap `createClient()` from lib/supabase/server.ts, a cookie-scoped
// client meant for an SIS staff request that already carries a live
// Supabase session cookie. This route is called cross-origin by the
// external portal SPA with only an `Authorization: Bearer` header — there
// is no session cookie on the request, so that client would authenticate
// as `anon`, and the `academic_years` RLS policy ("to authenticated using
// (true)", migration 001) would silently return zero rows — both helpers
// would always resolve to null here, and the endpoint would 500 on every
// call. Instead this route re-implements their exact filter/order
// semantics (accepting_applications=true AND is_current=false, newest
// ay_code wins; else is_current=true) directly against the already-
// verified `service` client used for every other query on this route.

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  // IP-based limit — checked before any DB work.
  const ip = getClientIp(request);
  const ipRl = rateLimit({ ip, scope: 'parent-v2', ipMax: 30, windowSecs: 60 });
  if (ipRl.limited) return tooManyRequests(ipRl.retryAfter, cors);

  // 1. Verify Bearer token.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return NextResponse.json(
      { error: 'missing Bearer token' },
      { status: 401, headers: cors }
    );
  }

  const service = createServiceClient();
  const { data: userData, error: authError } =
    await service.auth.getUser(token);
  if (authError || !userData.user?.email) {
    return NextResponse.json(
      { error: 'invalid or expired token' },
      { status: 401, headers: cors }
    );
  }

  // Per-user limit — checked after token is confirmed valid.
  const userRl = rateLimit({
    ip,
    userId: userData.user.id,
    scope: 'parent-v2',
    ipMax: 30,
    userMax: 20,
    windowSecs: 60,
  });
  if (userRl.limited) return tooManyRequests(userRl.retryAfter, cors);

  // 2. Resolve the target AY — upcoming (early-bird window open, KD #118)
  //    if one exists, else the current AY. See file-header note above for
  //    why this queries `academic_years` directly instead of going through
  //    lib/academic-year.ts.
  type AyRow = { id: string; ay_code: string };
  const { data: upcomingAy } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('accepting_applications', true)
    .eq('is_current', false)
    .order('ay_code', { ascending: false })
    .limit(1)
    .maybeSingle();
  let targetAy = upcomingAy as AyRow | null;
  if (!targetAy) {
    const { data: currentAy } = await service
      .from('academic_years')
      .select('id, ay_code')
      .eq('is_current', true)
      .maybeSingle();
    targetAy = currentAy as AyRow | null;
  }
  if (!targetAy) {
    return NextResponse.json(
      { error: 'no academic year configured' },
      { status: 500, headers: cors }
    );
  }

  // 3. Load the level catalog + this AY's offered-level set.
  const [rows, offeredIds] = await Promise.all([
    getLevelRows(service),
    getOfferedLevelIds(service, targetAy.id),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 4. Shape the response — ordered by sortOrder (getLevelRows already
  //    orders this way), nextCode resolved by mapping nextLevelId through
  //    the same rows array.
  const levels = rows.map((r) => ({
    code: r.code,
    label: r.label,
    type: r.levelType,
    sortOrder: r.sortOrder,
    nextCode: r.nextLevelId ? (byId.get(r.nextLevelId)?.code ?? null) : null,
    offered: offeredIds.has(r.id),
  }));

  return NextResponse.json(
    { ayCode: targetAy.ay_code, levels },
    { headers: cors }
  );
}
