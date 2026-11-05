import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/auth/event
//
// Sign-ins and sign-outs happen between the browser and Supabase, so the SIS's
// server never sees them. The login page and the sidebar report them here.
//
// `signed_in` and `signed_out` are only logged for the session this request
// carries, so nobody can record one for someone else. `sign_in_failed` has no
// session by nature, which is why this route is public and limited per address.
// A failed attempt made straight against Supabase, without this page, never
// arrives here; Supabase's own auth logs are the record of those.
const EventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('signed_in') }),
  z.object({ event: z.literal('signed_out') }),
  z.object({
    event: z.literal('sign_in_failed'),
    email: z.string().email().max(200),
    reason: z.string().max(200).optional(),
  }),
]);

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit({ ip, scope: 'auth-event', ipMax: 20, windowSecs: 60 });
  if (rl.limited) return tooManyRequests(rl.retryAfter);

  const parsed = EventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 });
  const body = parsed.data;
  const service = createServiceClient();

  if (body.event === 'sign_in_failed') {
    await logAction({
      service,
      actor: { id: null, email: body.email, role: null },
      action: 'user.login_failed',
      entityType: 'user_account',
      entityId: null,
      context: { reason: body.reason ?? null, ip },
    });
    return NextResponse.json({ ok: true });
  }

  const session = await getSessionUser();
  if (!session)
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  await logAction({
    service,
    actor: { id: session.id, email: session.email, role: session.role },
    action: body.event === 'signed_in' ? 'user.login' : 'user.logout',
    entityType: 'user_account',
    entityId: session.id,
    context: { provider: 'password', ip },
  });
  return NextResponse.json({ ok: true });
}
