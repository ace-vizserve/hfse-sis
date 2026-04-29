import { NextResponse } from 'next/server';

import {
  PARENT_SESSION_COOKIE,
  signParentSession,
} from '@/lib/parent/cookie';
import { createServiceClient } from '@/lib/supabase/service';

// Parent-portal → SIS handoff endpoint. The parent-portal's "View report
// card" button POSTs the parent's current Supabase access_token here.
// We verify the token via the service client's auth.getUser(jwt) — that
// returns the user record if the JWT is valid and unexpired — extract
// the email, and set our own HMAC-signed parent_session cookie. We do
// NOT call setSession() on a Supabase client; that would clobber any
// staff Supabase session living in the same browser (which is exactly
// the bug this design fixes).

function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '/parent';
  if (raw === '/parent' || raw.startsWith('/parent/')) return raw;
  return '/parent';
}

export async function POST(request: Request) {
  let body: { access_token?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  if (!accessToken) {
    return NextResponse.json({ error: 'missing access_token' }, { status: 400 });
  }
  const next = safeNext(body.next);

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user || !data.user.email) {
    return NextResponse.json({ error: 'invalid or expired token' }, { status: 401 });
  }
  const email = data.user.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'token has no email' }, { status: 401 });
  }

  const { value, maxAge } = signParentSession(email);
  const res = NextResponse.json({ redirect_to: next });
  res.cookies.set(PARENT_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return res;
}
