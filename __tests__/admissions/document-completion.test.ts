import { describe, expect, it, vi } from 'vitest';

// `lib/admissions/dashboard.ts` imports `next/cache`'s `unstable_cache` at
// module scope (used by other exports in the same file). Stub it to a plain
// passthrough — mirrors __tests__/admissions/staleness.test.ts — so this
// file can import the module directly without a real Next.js request
// context. `countPresentDocs` itself does no I/O and needs no other mocks.
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

import { countPresentDocs } from '@/lib/admissions/dashboard';
import { resolveStatus } from '@/lib/p-files/document-config';

// ──────────────────────────────────────────────────────────────────────────
// Regression coverage for the honesty fix: the "Documents collected by
// level" chart's `countPresentDocs` used to count a doc as "present"
// whenever its raw status string was anything other than empty or
// literally 'missing' — so 'Rejected' / 'Expired' / 'Uploaded' (parent
// uploaded, not yet validated) / 'To follow' / 'Pending' all counted toward
// "present," and an applicant with an active chase item could still show
// "5/5 Complete". It's rewritten to require `resolveStatus(...) === 'valid'`
// per slot — the same strict definition
// `loadAdmissionsCompletenessForChaseUncached` already uses for the chase
// queue, so the two can no longer disagree about the same applicant.
// ──────────────────────────────────────────────────────────────────────────

describe('countPresentDocs', () => {
  it('counts all 5 as present when every core status is Valid', () => {
    const row = {
      enroleeNumber: 'E-1',
      medicalStatus: 'Valid',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(5);
  });

  it('does not count a Rejected doc as present (was miscounted before the fix)', () => {
    const row = {
      enroleeNumber: 'E-2',
      medicalStatus: 'Valid',
      passportStatus: 'Valid',
      birthCertStatus: 'Rejected',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not count an Expired doc as present', () => {
    const row = {
      enroleeNumber: 'E-3',
      medicalStatus: 'Expired',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not count an Uploaded (awaiting validation) doc as present', () => {
    const row = {
      enroleeNumber: 'E-4',
      medicalStatus: 'Uploaded',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not count a Pending doc as present (non-canonical Uploaded synonym)', () => {
    const row = {
      enroleeNumber: 'E-4b',
      medicalStatus: 'Pending',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not count a To follow doc as present', () => {
    const row = {
      enroleeNumber: 'E-5',
      medicalStatus: 'To follow',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2099-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not count a stored-Valid passport whose expiry date has passed (expiry backstop)', () => {
    // This is the case a naive string-only fix would miss: the raw status
    // column still literally says "Valid" but `passportExpiry` is in the
    // past — resolveStatus's date backstop must still catch it.
    const row = {
      enroleeNumber: 'E-6',
      medicalStatus: 'Valid',
      passportStatus: 'Valid',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2020-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('does not apply the expiry backstop to non-expiring slots even if a stray expiry-like value existed', () => {
    // medical/birthCert/educCert/idPicture are non-expiring — an expired
    // passport must only zero out the passport slot, not the others, even
    // though the same row's passportExpiry is in the past.
    const row = {
      enroleeNumber: 'E-7',
      medicalStatus: 'Valid',
      passportStatus: 'Expired',
      birthCertStatus: 'Valid',
      educCertStatus: 'Valid',
      idPictureStatus: 'Valid',
      passportExpiry: '2020-01-01',
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(4);
  });

  it('counts 0 present when all 5 are missing (null status)', () => {
    const row = {
      enroleeNumber: 'E-8',
      medicalStatus: null,
      passportStatus: null,
      birthCertStatus: null,
      educCertStatus: null,
      idPictureStatus: null,
      passportExpiry: null,
    };
    expect(countPresentDocs(row, resolveStatus)).toBe(0);
  });

  it('returns 0 for an undefined row (no doc record for this applicant)', () => {
    expect(countPresentDocs(undefined, resolveStatus)).toBe(0);
  });
});
