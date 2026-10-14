import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { qboApiBase, qboEnv, type QboEnv } from '@/lib/qbo/env';

// The one door to the QuickBooks API. Reads the stored connection, refreshes
// the access token when it is about to expire, saves the refresh token Intuit
// hands back EVERY time (it rotates), and retries a call once on a 401.

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = 'minorversion=75';

export class QboError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    public detail: string
  ) {
    super(`QuickBooks ${status}${code ? ` (${code})` : ''}: ${detail}`);
  }
}

export class QboNotConnectedError extends Error {
  constructor() {
    super('QuickBooks is not connected');
  }
}

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function requireEnv(): QboEnv {
  const env = qboEnv();
  if (!env) throw new QboNotConnectedError();
  return env;
}

async function tokenCall(params: Record<string, string>): Promise<TokenSet> {
  const env = requireEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new QboError(
      res.status,
      body?.error ?? null,
      body?.error_description ?? 'token request refused'
    );
  }
  return body as TokenSet;
}

export function exchangeAuthCode(code: string): Promise<TokenSet> {
  return tokenCall({
    grant_type: 'authorization_code',
    code,
    redirect_uri: requireEnv().redirectUri,
  });
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const env = requireEnv();
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
  });
}

type ConnectionRow = {
  realm_id: string;
  environment: 'sandbox' | 'production';
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

async function loadConnection(service: SupabaseClient): Promise<ConnectionRow> {
  const { data, error } = await service
    .from('qbo_connection')
    .select(
      'realm_id, environment, refresh_token, access_token, access_token_expires_at'
    )
    .eq('id', 1)
    .maybeSingle();
  if (error)
    throw new Error(`QuickBooks connection lookup failed: ${error.message}`);
  if (!data) throw new QboNotConnectedError();
  return data as ConnectionRow;
}

async function accessToken(
  service: SupabaseClient,
  conn: ConnectionRow,
  force: boolean
): Promise<string> {
  const expires = conn.access_token_expires_at
    ? Date.parse(conn.access_token_expires_at)
    : 0;
  if (!force && conn.access_token && expires - Date.now() > 60_000) {
    return conn.access_token;
  }
  const t = await tokenCall({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  });
  const expiresAt = new Date(Date.now() + t.expires_in * 1000).toISOString();
  const { error } = await service
    .from('qbo_connection')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_token_expires_at: expiresAt,
    })
    .eq('id', 1);
  if (error)
    throw new Error(`Saving the QuickBooks key failed: ${error.message}`);
  conn.access_token = t.access_token;
  conn.refresh_token = t.refresh_token;
  conn.access_token_expires_at = expiresAt;
  return t.access_token;
}

export async function qboRequest<T>(
  service: SupabaseClient,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const conn = await loadConnection(service);
  const base = `${qboApiBase(conn.environment)}/v3/company/${conn.realm_id}`;
  const sep = path.includes('?') ? '&' : '?';

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(service, conn, attempt > 0);
    const res = await fetch(`${base}${path}${sep}${MINOR_VERSION}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 401 && attempt === 0) continue;
    const json = await res.json().catch(() => null);
    const fault = json?.Fault?.Error?.[0];
    if (!res.ok || fault) {
      throw new QboError(
        res.status,
        fault?.code ? String(fault.code) : null,
        fault?.Detail ?? fault?.Message ?? res.statusText ?? 'request refused'
      );
    }
    return json as T;
  }
  throw new QboError(401, null, 'QuickBooks refused the saved key');
}

export function qbEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function qboQuery<T>(
  service: SupabaseClient,
  entity: string,
  where = '',
  tail = 'maxresults 1000'
): Promise<T[]> {
  const sql = `select * from ${entity}${where ? ` where ${where}` : ''} ${tail}`;
  const json = await qboRequest<{ QueryResponse?: Record<string, T[]> }>(
    service,
    'GET',
    `/query?query=${encodeURIComponent(sql)}`
  );
  return json.QueryResponse?.[entity] ?? [];
}

/** The sentence a person sees when a QuickBooks call fails. */
export function qboErrorMessage(e: unknown): string {
  if (e instanceof QboNotConnectedError) {
    return 'QuickBooks is not connected. Ask a superadmin to connect it in SIS Admin.';
  }
  if (e instanceof QboError)
    return `QuickBooks didn't accept this: ${e.detail}`;
  return "QuickBooks couldn't be reached. Nothing was saved — try again in a minute.";
}
