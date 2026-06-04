import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  signActionToken,
  verifyActionToken,
  type ActionTokenPayload,
} from '@/lib/change-requests/action-token';

const SECRET = 'test-secret-key-for-action-tokens-0123456789';

const PAYLOAD: ActionTokenPayload = {
  requestId: '11111111-1111-1111-1111-111111111111',
  action: 'approve',
  approverId: '22222222-2222-2222-2222-222222222222',
};

// Helper: re-pack a payload into the token's wire format so we can tamper
// with a single field while keeping a structurally-valid base64url token.
function b64url(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('action-token', () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.CHANGE_REQUEST_ACTION_SECRET;
    process.env.CHANGE_REQUEST_ACTION_SECRET = SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) {
      delete process.env.CHANGE_REQUEST_ACTION_SECRET;
    } else {
      process.env.CHANGE_REQUEST_ACTION_SECRET = prevSecret;
    }
  });

  it('round-trips a valid token', () => {
    const token = signActionToken(PAYLOAD);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');
    expect(verifyActionToken(token)).toEqual(PAYLOAD);
  });

  it('returns null when requestId is tampered', () => {
    const token = signActionToken(PAYLOAD);
    const tampered = b64url(
      JSON.stringify({ ...PAYLOAD, requestId: 'different-request' })
    );
    const sig = token.slice(token.indexOf('.') + 1);
    expect(verifyActionToken(`${tampered}.${sig}`)).toBeNull();
  });

  it('returns null when action is tampered', () => {
    const token = signActionToken(PAYLOAD);
    const tampered = b64url(JSON.stringify({ ...PAYLOAD, action: 'reject' }));
    const sig = token.slice(token.indexOf('.') + 1);
    expect(verifyActionToken(`${tampered}.${sig}`)).toBeNull();
  });

  it('returns null when approverId is tampered', () => {
    const token = signActionToken(PAYLOAD);
    const tampered = b64url(
      JSON.stringify({ ...PAYLOAD, approverId: 'someone-else' })
    );
    const sig = token.slice(token.indexOf('.') + 1);
    expect(verifyActionToken(`${tampered}.${sig}`)).toBeNull();
  });

  it('returns null when verified with the wrong secret', () => {
    const token = signActionToken(PAYLOAD);
    process.env.CHANGE_REQUEST_ACTION_SECRET = 'a-completely-different-secret';
    expect(verifyActionToken(token)).toBeNull();
  });

  it('returns null for garbage strings', () => {
    expect(verifyActionToken('')).toBeNull();
    expect(verifyActionToken('garbage')).toBeNull();
    expect(verifyActionToken('.')).toBeNull();
    expect(verifyActionToken('a.')).toBeNull();
    expect(verifyActionToken('.b')).toBeNull();
    expect(verifyActionToken('not.base64url!!!')).toBeNull();
    expect(
      verifyActionToken(`${b64url('not json')}.${b64url('sig')}`)
    ).toBeNull();
  });

  it('returns null when the secret is unset', () => {
    delete process.env.CHANGE_REQUEST_ACTION_SECRET;
    const fakeToken = `${b64url(JSON.stringify(PAYLOAD))}.${b64url('sig')}`;
    expect(verifyActionToken(fakeToken)).toBeNull();
  });

  it('throws on sign when the secret is unset', () => {
    delete process.env.CHANGE_REQUEST_ACTION_SECRET;
    expect(() => signActionToken(PAYLOAD)).toThrow();
  });

  it('produces different tokens for different approverIds', () => {
    const a = signActionToken(PAYLOAD);
    const b = signActionToken({ ...PAYLOAD, approverId: 'another-approver' });
    expect(a).not.toBe(b);
  });
});
