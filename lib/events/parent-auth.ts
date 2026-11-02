import { NextResponse } from 'next/server';

import {
  loadFilableStudents,
  type LinkedStudent,
} from '@/lib/declarations/parent';
import {
  getClientIp,
  rateLimit,
  tooManyRequests,
  userRateLimit,
} from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Bearer → verified parent → their filable children, for the parent events
 * routes. Copied step for step from `app/api/parent/v2/declarations/route.ts`
 * (KD #195). The email is lowercased: the submissions unique key is
 * case-sensitive.
 */
export async function authenticateParent(
  request: Request,
  cors: Record<string, string>,
  limits: { scope: string; ipMax: number; userMax: number }
): Promise<
  | { ok: true; email: string; userId: string; students: LinkedStudent[] }
  | { ok: false; response: NextResponse }
> {
  const ip = getClientIp(request);
  const ipRl = rateLimit({
    ip,
    scope: limits.scope,
    ipMax: limits.ipMax,
    windowSecs: 60,
  });
  if (ipRl.limited) {
    return { ok: false, response: tooManyRequests(ipRl.retryAfter, cors) };
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'missing Bearer token' },
        { status: 401, headers: cors }
      ),
    };
  }

  const service = createServiceClient();
  const { data: userData, error: authError } =
    await service.auth.getUser(token);
  if (authError || !userData.user?.email) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'invalid or expired token' },
        { status: 401, headers: cors }
      ),
    };
  }
  const email = userData.user.email.trim().toLowerCase();

  const userRl = userRateLimit({
    userId: userData.user.id,
    scope: limits.scope,
    userMax: limits.userMax,
    windowSecs: 60,
  });
  if (userRl.limited) {
    return { ok: false, response: tooManyRequests(userRl.retryAfter, cors) };
  }

  const students = await loadFilableStudents(service, email);
  return { ok: true, email, userId: userData.user.id, students };
}
