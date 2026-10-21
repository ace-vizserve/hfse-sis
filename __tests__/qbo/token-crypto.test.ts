import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertTokenKey,
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from '@/lib/qbo/token-crypto';

describe('QuickBooks token encryption', () => {
  beforeEach(() => {
    vi.stubEnv('QBO_TOKEN_KEY', randomBytes(32).toString('base64'));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips, in the v1 format, with a fresh IV each time', () => {
    const a = encryptToken('RT-secret-123');
    const b = encryptToken('RT-secret-123');
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toContain('RT-secret-123');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('RT-secret-123');
    expect(decryptToken(b)).toBe('RT-secret-123');
    expect(isEncryptedToken(a)).toBe(true);
  });

  it('refuses a tampered value without echoing it', () => {
    const enc = encryptToken('RT-secret-123');
    const [v, iv, tag, body] = enc.split(':');
    const flipped = Buffer.from(body, 'base64');
    flipped[0] ^= 1;
    const tampered = [v, iv, tag, flipped.toString('base64')].join(':');
    expect(() => decryptToken(tampered)).toThrow(/couldn't be decrypted/);
    expect(() => decryptToken('v1:abc')).toThrow(/readable format/);
    try {
      decryptToken(tampered);
    } catch (e) {
      expect((e as Error).message).not.toContain(body);
    }
  });

  it('refuses a value saved under a different key', () => {
    const enc = encryptToken('RT-secret-123');
    vi.stubEnv('QBO_TOKEN_KEY', randomBytes(32).toString('base64'));
    expect(() => decryptToken(enc)).toThrow(/couldn't be decrypted/);
  });

  it('passes through a value stored before encryption', () => {
    expect(decryptToken('AB11plain-refresh-token')).toBe(
      'AB11plain-refresh-token'
    );
    expect(isEncryptedToken('AB11plain-refresh-token')).toBe(false);
    vi.stubEnv('QBO_TOKEN_KEY', '');
    expect(decryptToken('AB11plain-refresh-token')).toBe(
      'AB11plain-refresh-token'
    );
  });

  it('names QBO_TOKEN_KEY when it is missing or the wrong size', () => {
    const enc = encryptToken('x');
    vi.stubEnv('QBO_TOKEN_KEY', '');
    expect(() => encryptToken('x')).toThrow(/QBO_TOKEN_KEY/);
    expect(() => decryptToken(enc)).toThrow(/QBO_TOKEN_KEY is not set/);
    expect(() => assertTokenKey()).toThrow(/QBO_TOKEN_KEY is not set/);
    vi.stubEnv('QBO_TOKEN_KEY', randomBytes(16).toString('base64'));
    expect(() => assertTokenKey()).toThrow(/QBO_TOKEN_KEY must be 32 bytes/);
  });
});
