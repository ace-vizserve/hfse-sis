import { NextResponse } from 'next/server';

import { PARENT_SESSION_COOKIE } from '@/lib/parent/cookie';

// Clears the parent_session cookie. Called from the sidebar profile's
// "Done viewing" button AND from the parent layout's pagehide handler
// via navigator.sendBeacon — closing the tab or navigating to another
// origin actively wipes the cookie rather than waiting for the 2h TTL.

async function clearCookie() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PARENT_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function POST() {
  return clearCookie();
}
