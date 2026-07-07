import { describe, expect, it } from 'vitest';

import { resolveStatus } from '@/lib/p-files/document-config';

const PAST = '2020-01-01';
const FUTURE = '2099-01-01';

/** Local yyyy-mm-dd for "today" — same calendar day the function compares against. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('resolveStatus', () => {
  it('null rawStatus is always missing, even with a URL present', () => {
    expect(resolveStatus('https://x/doc.pdf', null, null, false)).toBe(
      'missing'
    );
    expect(resolveStatus(null, null, PAST, true)).toBe('missing');
  });

  it('rejected trumps everything, including a past expiry', () => {
    expect(resolveStatus(null, 'Rejected', PAST, true)).toBe('rejected');
  });

  it('to follow trumps expiry', () => {
    expect(resolveStatus(null, 'To follow', PAST, true)).toBe('to-follow');
  });

  // ── The H9 fix: stored 'Expired' status is authoritative ────────────────
  it("stored 'Expired' with no expiryDate resolves to expired (was missing)", () => {
    expect(resolveStatus(null, 'Expired', null, true)).toBe('expired');
  });

  it("stored 'Expired' on a non-expiring slot resolves to expired", () => {
    expect(resolveStatus(null, 'Expired', null, false)).toBe('expired');
    expect(resolveStatus(null, 'Expired', PAST, false)).toBe('expired');
  });

  it("stored 'Expired' on the expiry day itself resolves to expired (freshen writes at <=, derive fires at <)", () => {
    expect(resolveStatus(null, 'Expired', todayIso(), true)).toBe('expired');
  });

  it("stored 'Expired' with a future (corrected) expiryDate still resolves to expired", () => {
    expect(resolveStatus(null, 'Expired', FUTURE, true)).toBe('expired');
  });

  // ── Date backstop unchanged ──────────────────────────────────────────────
  it("stale 'Valid' with past expiry derives expired via the date backstop", () => {
    expect(resolveStatus(null, 'Valid', PAST, true)).toBe('expired');
  });

  it("'Valid' with future expiry stays valid", () => {
    expect(resolveStatus(null, 'Valid', FUTURE, true)).toBe('valid');
  });

  it("'Valid' with past expiry on a non-expiring slot stays valid", () => {
    expect(resolveStatus(null, 'Valid', PAST, false)).toBe('valid');
  });

  // ── Uploaded / pending synonym ───────────────────────────────────────────
  it("'Uploaded' and legacy 'Pending' both resolve to uploaded", () => {
    expect(resolveStatus(null, 'Uploaded', null, false)).toBe('uploaded');
    expect(resolveStatus(null, 'Pending', null, false)).toBe('uploaded');
  });

  it('unknown raw statuses fall through to missing', () => {
    expect(resolveStatus(null, 'Something else', null, false)).toBe('missing');
  });
});
