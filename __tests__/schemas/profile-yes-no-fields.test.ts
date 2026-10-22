/**
 * School bus / Student care / Uniform are stored as the TEXT 'Yes' / 'No'.
 *
 * The edit sheet drew them with the true/false control, so picking Yes sent
 * `true` and the save failed with "expected one of Yes|No". The parent portal
 * also writes '' for a skipped question, and the sheet submits it back
 * untouched — that must read as "not set", not fail the whole save.
 */
import { describe, expect, it } from 'vitest';

import { buildProfileUpdateSchema } from '@/lib/schemas/sis';

// What the profile PATCH route validates with.
const ProfileUpdateSchema = buildProfileUpdateSchema(new Set());

const FIELDS = ['availSchoolBus', 'availStudentCare', 'availUniform'] as const;

describe('Yes / No profile fields', () => {
  it.each(FIELDS)('%s takes Yes, No and not set', (field) => {
    for (const v of ['Yes', 'No', null]) {
      const r = ProfileUpdateSchema.safeParse({ [field]: v });
      expect(r.success, String(v)).toBe(true);
    }
  });

  it.each(FIELDS)("%s reads the portal's '' as not set", (field) => {
    const r = ProfileUpdateSchema.safeParse({ [field]: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[field]).toBeNull();
  });

  it.each(FIELDS)('%s refuses true / false', (field) => {
    expect(ProfileUpdateSchema.safeParse({ [field]: true }).success).toBe(
      false
    );
  });

  it('leaves an absent field absent', () => {
    const r = ProfileUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('availSchoolBus');
  });
});
