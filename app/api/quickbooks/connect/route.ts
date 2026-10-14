import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { qboEnv } from '@/lib/qbo/env';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';

// GET /api/quickbooks/connect — superadmin. Sends them to Intuit to approve
// the SIS for the school's QuickBooks company. The `state` cookie is checked
// on the way back (callback) so nobody can hand us someone else's approval.
export async function GET() {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const env = qboEnv();
  if (!env) {
    return NextResponse.json(
      { error: 'QuickBooks keys are not set on this server.' },
      { status: 500 }
    );
  }
  const state = randomBytes(24).toString('hex');
  const url = new URL('https://appcenter.intuit.com/connect/oauth2');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', state);
  const res = NextResponse.redirect(url);
  res.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/quickbooks',
    maxAge: 600,
  });
  return res;
}
