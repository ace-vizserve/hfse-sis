import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  exchangeAuthCode,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { qboEnv } from '@/lib/qbo/env';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/quickbooks/callback?code&state&realmId — Intuit sends the
// superadmin back here after they approve.
export async function GET(request: NextRequest) {
  // Every redirect out of here clears the one-time state cookie, so a
  // cancelled, expired or failed attempt cannot leave a stale state behind.
  const back = (q: string) => {
    const res = NextResponse.redirect(
      new URL(`/sis/admin/quickbooks?${q}`, request.url)
    );
    res.cookies.delete({ name: 'qbo_oauth_state', path: '/api/quickbooks' });
    return res;
  };
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;

  const env = qboEnv();
  if (!env) {
    return back(
      `error=${encodeURIComponent("The QuickBooks app keys aren't set on this server.")}`
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const expected = request.cookies.get('qbo_oauth_state')?.value;
  if (url.searchParams.get('error')) {
    return back(
      `error=${encodeURIComponent('QuickBooks approval was cancelled.')}`
    );
  }
  if (!code || !realmId || !state || state !== expected) {
    return back(
      `error=${encodeURIComponent('That approval link had expired. Click Connect again.')}`
    );
  }

  const service = createServiceClient();
  try {
    const tokens = await exchangeAuthCode(code);
    const { error } = await service.from('qbo_connection').upsert({
      id: 1,
      realm_id: realmId,
      environment: env.environment,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000
      ).toISOString(),
      connected_by: auth.user.id,
      connected_by_email: auth.user.email,
      connected_at: new Date().toISOString(),
      last_cdc_at: new Date().toISOString(),
      company_name: null,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error('[qbo callback]', e);
    return back(`error=${encodeURIComponent(qboErrorMessage(e))}`);
  }

  // The connection is saved from here on, so the person is never told it
  // failed. A missing company name is cosmetic and is left null.
  let companyName: string | null = null;
  try {
    const info = await qboRequest<{ CompanyInfo?: { CompanyName?: string } }>(
      service,
      'GET',
      `/companyinfo/${realmId}`
    );
    companyName = info.CompanyInfo?.CompanyName ?? null;
    const { error } = await service
      .from('qbo_connection')
      .update({ company_name: companyName })
      .eq('id', 1);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('[qbo callback] could not read company name:', e);
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'qbo.connection.connect',
    entityType: 'qbo_connection',
    entityId: realmId,
    context: { company_name: companyName, environment: env.environment },
  });
  return back('connected=1');
}
