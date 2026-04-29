import { createHmac, timingSafeEqual } from 'node:crypto';

// Parent session is a parallel auth scheme — independent of Supabase
// auth — so a staff user logged into SIS can also click a parent-portal
// SSO link and view a report card without their staff session being
// clobbered by setSession(). The cookie carries an HMAC-signed payload
// of { email, exp }; parent-area pages decode it server-side and use
// the email to look up children + publications via the service client.
//
// Threat model: anyone with this cookie can view "their" report cards.
// Mitigations: short TTL (2h), httpOnly + Secure + SameSite=Lax, signed
// with PARENT_HANDOFF_SECRET, scoped to the SIS domain only.

export const PARENT_SESSION_COOKIE = 'hfse_parent_session';
export const PARENT_SESSION_TTL_SECONDS = 2 * 60 * 60;

type ParentSessionPayload = { email: string; exp: number };

function getSecret(): string {
  const s = process.env.PARENT_HANDOFF_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'PARENT_HANDOFF_SECRET is not set or shorter than 32 chars. Generate one with `openssl rand -hex 32` and add it to .env.local + Vercel env vars.',
    );
  }
  return s;
}

export function signParentSession(email: string): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + PARENT_SESSION_TTL_SECONDS;
  const payload: ParentSessionPayload = { email, exp };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(b64).digest('hex');
  return { value: `${b64}.${sig}`, maxAge: PARENT_SESSION_TTL_SECONDS };
}

export function verifyParentSession(value: string | undefined): ParentSessionPayload | null {
  if (!value) return null;
  const idx = value.indexOf('.');
  if (idx <= 0) return null;
  const b64 = value.slice(0, idx);
  const sig = value.slice(idx + 1);

  const expected = createHmac('sha256', getSecret()).update(b64).digest('hex');
  if (sig.length !== expected.length) return null;
  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: ParentSessionPayload;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    payload = JSON.parse(json) as ParentSessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
