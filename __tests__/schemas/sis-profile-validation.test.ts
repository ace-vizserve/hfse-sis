import { describe, expect, it } from 'vitest';
import { FatherUpdateSchema, ProfileUpdateSchema } from '@/lib/schemas/sis';

// Every field on these 4 schemas is nullable (only `category` is also
// optional), and the real edit-sheet UI always submits a full form object
// (components/sis/edit-profile-sheet.tsx's buildDefaults() defaults every
// missing key to null) — never a genuine partial patch. So a valid
// `.safeParse()` call here must supply every key; derive an all-null base
// from the schema's own shape and override only the field under test.
const baseProfile = Object.fromEntries(
  Object.keys(ProfileUpdateSchema.shape).map((k) => [k, null])
);
const baseFather = Object.fromEntries(
  Object.keys(FatherUpdateSchema.shape).map((k) => [k, null])
);

describe('ProfileUpdateSchema — NRIC', () => {
  it('accepts a well-formed NRIC', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, nric: 'S1234567A' })
        .success
    ).toBe(true);
  });

  it('rejects a malformed NRIC', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, nric: '1234567A' })
        .success
    ).toBe(false);
  });

  it('accepts blank (clears to null)', () => {
    const r = ProfileUpdateSchema.safeParse({ ...baseProfile, nric: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nric).toBeNull();
  });
});

describe('ProfileUpdateSchema — phone', () => {
  it('accepts digits with an optional leading +', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        homePhone: '+6591234567',
      }).success
    ).toBe(true);
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, homePhone: '91234567' })
        .success
    ).toBe(true);
  });

  it('rejects a phone number containing letters or spaces', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        homePhone: '9123 4567',
      }).success
    ).toBe(false);
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, homePhone: 'call-me' })
        .success
    ).toBe(false);
  });
});

describe('FatherUpdateSchema — email', () => {
  it('accepts a valid email', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherEmail: 'dad@example.com',
      }).success
    ).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherEmail: 'not-an-email',
      }).success
    ).toBe(false);
  });
});

describe('ProfileUpdateSchema — postal code', () => {
  it('accepts digits only', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, postalCode: '520123' })
        .success
    ).toBe(true);
  });

  it('rejects letters', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, postalCode: 'ABC123' })
        .success
    ).toBe(false);
  });
});

describe('ProfileUpdateSchema — nationality', () => {
  it('accepts a known country name', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        nationality: 'Philippines',
      }).success
    ).toBe(true);
  });

  it('rejects an arbitrary string that is not a country name', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        nationality: 'Filipino',
      }).success
    ).toBe(false);
  });

  it('accepts blank (clears to null)', () => {
    const r = ProfileUpdateSchema.safeParse({
      ...baseProfile,
      nationality: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nationality).toBeNull();
  });
});

describe('FatherUpdateSchema — nationality', () => {
  it('accepts a known country name', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherNationality: 'Singapore',
      }).success
    ).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(
      FatherUpdateSchema.safeParse({ ...baseFather, fatherNationality: 'xyz' })
        .success
    ).toBe(false);
  });
});
