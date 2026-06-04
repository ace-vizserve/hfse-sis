import 'server-only';

import crypto from 'crypto';

// Signed, stateless action token for email one-click approve/reject.
//
// Shape: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payloadB64))
// keyed on CHANGE_REQUEST_ACTION_SECRET. There is deliberately NO expiry
// field — a change-request decision link stays valid until the request
// leaves the pending state; the workflow state machine (status guards in
// `decideChangeRequest`) is the real gate, not the token's age. The token
// only proves "this approver, this request, this action" was issued by us.
//
// Unset-secret behaviour (the chosen-cleaner half of the two options):
//   - signActionToken THROWS. Tokens are minted server-side at email-send
//     time; a missing secret is a deployment misconfiguration the caller
//     should surface, not silently paper over with an empty string. The
//     email-send caller is expected to try/catch and fall back to the plain
//     deep-link (no token) when this throws.
//   - verifyActionToken returns null (never throws). A verifier that can't
//     reconstruct the key simply can't trust any token — same outcome as a
//     bad signature.

export type ActionTokenPayload = {
  requestId: string;
  action: 'approve' | 'reject';
  approverId: string;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getSecret(): string | null {
  const secret = process.env.CHANGE_REQUEST_ACTION_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

/**
 * Mint a signed action token for the given payload.
 *
 * @throws Error when CHANGE_REQUEST_ACTION_SECRET is unset — the caller is
 *         expected to catch and fall back to the plain (token-less) link.
 */
export function signActionToken(payload: ActionTokenPayload): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error(
      'CHANGE_REQUEST_ACTION_SECRET is not set — cannot sign an action token.'
    );
  }
  const payloadB64 = b64url(JSON.stringify(payload));
  const sigB64 = b64url(hmac(secret, payloadB64));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a signed action token. Returns the parsed payload on a valid
 * signature + well-formed shape, or null on ANY problem (malformed token,
 * bad signature, missing secret, JSON garbage, wrong field types). Never
 * throws.
 */
export function verifyActionToken(token: string): ActionTokenPayload | null {
  try {
    const secret = getSecret();
    if (!secret) return null;
    if (typeof token !== 'string') return null;

    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);

    // Recompute the signature over the payload segment and constant-time
    // compare. Length mismatch short-circuits before timingSafeEqual (which
    // throws on differing buffer lengths).
    const expected = hmac(secret, payloadB64);
    const provided = Buffer.from(sigB64, 'base64url');
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as ActionTokenPayload).requestId !== 'string' ||
      typeof (parsed as ActionTokenPayload).approverId !== 'string' ||
      ((parsed as ActionTokenPayload).action !== 'approve' &&
        (parsed as ActionTokenPayload).action !== 'reject')
    ) {
      return null;
    }
    const p = parsed as ActionTokenPayload;
    return {
      requestId: p.requestId,
      action: p.action,
      approverId: p.approverId,
    };
  } catch {
    return null;
  }
}
