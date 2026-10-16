import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { qboApiBase, qboEnv, type QboEnv } from '@/lib/qbo/env';

// The one door to the QuickBooks API. Reads the stored connection, refreshes
// the access token when it is about to expire, saves the refresh token Intuit
// hands back EVERY time (it rotates), and retries a call once on a 401.
//
// CONCURRENT REFRESHES. Intuit rotates the refresh token on every refresh, so
// two requests refreshing at once (say, the webhook sync and a staff click)
// would each spend the same token. The save is a compare-and-swap: the update
// only lands while the stored refresh token is still the one we refreshed
// with. If it lands nothing, another request already rotated it; we adopt that
// request's tokens instead of overwriting them. If Intuit refuses the refresh
// with invalid_grant and the stored token has since changed, we retry once
// with the stored one before giving up.

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
    cache: 'no-store',
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
  const res = await fetch(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) throw new QboError(res.status, null, 'revoke refused');
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

/**
 * The QuickBooks company connected now, or null when none is. Customer and
 * invoice rows carry the company they came from, and are only read back
 * against this one.
 */
export async function connectedRealmId(
  service: SupabaseClient
): Promise<string | null> {
  const { data, error } = await service
    .from('qbo_connection')
    .select('realm_id')
    .eq('id', 1)
    .maybeSingle();
  if (error)
    throw new Error(`QuickBooks connection lookup failed: ${error.message}`);
  return (data as { realm_id: string } | null)?.realm_id ?? null;
}

function isFresh(row: ConnectionRow): boolean {
  const expires = row.access_token_expires_at
    ? Date.parse(row.access_token_expires_at)
    : 0;
  return !!row.access_token && expires - Date.now() > 60_000;
}

function adopt(conn: ConnectionRow, from: ConnectionRow): void {
  conn.access_token = from.access_token;
  conn.refresh_token = from.refresh_token;
  conn.access_token_expires_at = from.access_token_expires_at;
}

async function accessToken(
  service: SupabaseClient,
  conn: ConnectionRow,
  force: boolean
): Promise<string> {
  if (!force && isFresh(conn)) return conn.access_token as string;

  let usedRefresh = conn.refresh_token;
  let t: TokenSet;
  try {
    t = await tokenCall({
      grant_type: 'refresh_token',
      refresh_token: usedRefresh,
    });
  } catch (e) {
    if (!(e instanceof QboError && e.code === 'invalid_grant')) throw e;
    // Refused. If another request rotated the token meanwhile, our copy is
    // simply out of date: retry once with the stored one.
    const latest = await loadConnection(service);
    if (latest.refresh_token === usedRefresh) throw e;
    adopt(conn, latest);
    usedRefresh = latest.refresh_token;
    t = await tokenCall({
      grant_type: 'refresh_token',
      refresh_token: usedRefresh,
    });
  }

  const expiresAt = new Date(Date.now() + t.expires_in * 1000).toISOString();
  const { data, error } = await service
    .from('qbo_connection')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      access_token_expires_at: expiresAt,
    })
    .eq('id', 1)
    .eq('refresh_token', usedRefresh)
    .select('id');
  if (error)
    throw new Error(`Saving the QuickBooks key failed: ${error.message}`);

  if (!data || data.length === 0) {
    // Compare-and-swap lost: another request rotated the token first. Take its
    // result if it is usable; never write our own copy over it.
    const latest = await loadConnection(service);
    const stale = force && latest.access_token === conn.access_token;
    if (isFresh(latest) && !stale) {
      adopt(conn, latest);
      return latest.access_token as string;
    }
    throw new QboError(401, null, 'QuickBooks refused the saved key');
  }

  conn.access_token = t.access_token;
  conn.refresh_token = t.refresh_token;
  conn.access_token_expires_at = expiresAt;
  return t.access_token;
}

export async function qboRequest<T>(
  service: SupabaseClient,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts?: { contentType?: string; requestId?: string }
): Promise<T> {
  const conn = await loadConnection(service);
  const base = `${qboApiBase(conn.environment)}/v3/company/${conn.realm_id}`;
  const sep = path.includes('?') ? '&' : '?';
  // QuickBooks returns the original response for a repeated requestid, so a
  // retry of the same write never records twice (max 50 characters).
  const tail = opts?.requestId
    ? `${MINOR_VERSION}&requestid=${encodeURIComponent(opts.requestId)}`
    : MINOR_VERSION;

  let throttled = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(service, conn, attempt > 0);
    const res = await fetch(`${base}${path}${sep}${tail}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body
          ? { 'Content-Type': 'application/json' }
          : opts?.contentType
            ? { 'Content-Type': opts.contentType }
            : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 429 && throttled < 3) {
      // Throttled: wait Retry-After (else 2s, 4s, 8s) and try again.
      const asked = Number(res.headers?.get?.('Retry-After'));
      const waitMs = asked > 0 ? asked * 1000 : 2000 * 2 ** throttled;
      throttled++;
      await new Promise((r) => setTimeout(r, waitMs));
      attempt--; // a throttle retry does not use up the 401 retry
      continue;
    }
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

/** Every row, paged 1000 at a time (QuickBooks' query cap). */
export async function qboQueryAll<T>(
  service: SupabaseClient,
  entity: string,
  where = ''
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 1; ; start += 1000) {
    const page = await qboQuery<T>(
      service,
      entity,
      where,
      `startposition ${start} maxresults 1000`
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** The sentence a person sees when a QuickBooks call fails. */
export function qboErrorMessage(e: unknown): string {
  if (e instanceof QboNotConnectedError) {
    return NOT_CONNECTED;
  }
  if (e instanceof QboError && e.code === 'invalid_grant') {
    return RECONNECT;
  }
  if (e instanceof QboError)
    return `QuickBooks didn't accept this: ${e.detail}`;
  return "QuickBooks couldn't be reached. Nothing was saved — try again in a minute.";
}

const NOT_CONNECTED =
  'QuickBooks is not connected. Ask a superadmin to connect it in Billing → Settings.';
const RECONNECT =
  'QuickBooks needs to be connected again. Ask a superadmin to reconnect it in Billing → Settings.';

/**
 * Why a QuickBooks call failed, with no claim about what was saved — for use
 * once QuickBooks has already accepted an earlier write in the same action,
 * where "Nothing was saved" would be untrue.
 */
export function qboReasonOnly(e: unknown): string {
  if (e instanceof QboNotConnectedError) return NOT_CONNECTED;
  if (e instanceof QboError && e.code === 'invalid_grant') return RECONNECT;
  if (e instanceof QboError) return e.detail;
  return "QuickBooks couldn't be reached";
}
