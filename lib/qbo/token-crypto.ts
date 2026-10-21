import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// The QuickBooks keys (refresh + access token) are stored encrypted in
// `qbo_connection`: AES-256-GCM with a key from QBO_TOKEN_KEY (32 bytes,
// base64), written as `v1:<iv>:<tag>:<ciphertext>` (each base64). A stored
// value without the `v1:` prefix was saved before encryption existed and is
// read as-is; the next save writes it encrypted. Error messages never carry
// a token.

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class QboTokenKeyError extends Error {
  constructor(reason: string) {
    super(`QBO_TOKEN_KEY ${reason}`);
    this.name = 'QboTokenKeyError';
  }
}

function key(): Buffer {
  const raw = process.env.QBO_TOKEN_KEY;
  if (!raw) throw new QboTokenKeyError('is not set on this server');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32)
    throw new QboTokenKeyError('must be 32 bytes, written as base64');
  return k;
}

/**
 * Throws unless QBO_TOKEN_KEY is usable. Call it BEFORE asking Intuit for new
 * tokens: Intuit retires the old refresh token on refresh, so failing to
 * encrypt the new one afterwards would lose the connection.
 */
export function assertTokenKey(): void {
  key();
}

/** True when a stored value is in the encrypted format. */
export function isEncryptedToken(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`;
}

export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) return stored; // saved before encryption
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3)
    throw new Error('The stored QuickBooks key is not in a readable format');
  const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64'));
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new Error('The stored QuickBooks key is not in a readable format');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      'utf8'
    );
  } catch (e) {
    if (e instanceof QboTokenKeyError) throw e;
    throw new Error(
      "The stored QuickBooks key couldn't be decrypted (changed, or QBO_TOKEN_KEY differs from the one that saved it)"
    );
  }
}
