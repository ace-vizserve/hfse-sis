/**
 * A write schema must accept the type the database actually stores — not the
 * type the column's name implies.
 *
 * THE BUG THIS EXISTS FOR. Every mobile column on the admissions tables is
 * NUMERIC in production: `motherMobile` is a `number` on 498 of 498 AY2026
 * rows, and `fatherMobile`, `guardianMobile` and `contactPersonNumber`
 * likewise. Both SIS edit sheets submit the WHOLE form on every save
 * (`lib/schemas/sis.ts` says so in its own gated-field comment), so an
 * untouched phone field is always in the payload — carrying the number the
 * database handed it. Every branch of the phone validators was `z.string()`,
 * so the parse failed and the route 400'd the ENTIRE form: a registrar editing
 * a preferred name lost the edit because of a field they never touched.
 *
 * The field-level `onChange` handlers do coerce to strings, which is exactly
 * why this hid — it only bites the fields nobody touches.
 *
 * WHY THE TEST IS SHAPED THIS WAY. The gated builders exist so an untouched
 * legacy value round-trips regardless of format, so BOTH branches have to be
 * asserted: the strict one (the registrar edited this field) and the loose one
 * (they did not). The loose branch was the one that shipped broken.
 */

import { describe, expect, it } from 'vitest';

import {
  buildFatherUpdateSchema,
  buildGuardianUpdateSchema,
  buildMotherUpdateSchema,
  buildProfileUpdateSchema,
} from '@/lib/schemas/sis';

/** What production stores in these columns today. */
const NUMERIC_PHONE = 87796901;
const NUMERIC_POSTAL = 123456;

type Builder = (changed: ReadonlySet<string>) => {
  shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
};

/**
 * Both halves of a gated field: touched (strict validator) and untouched
 * (loose validator). A production value must survive both.
 */
function bothBranches(build: Builder, field: string) {
  return {
    touched: build(new Set([field])).shape[field],
    untouched: build(new Set(['someOtherField'])).shape[field],
  };
}

const PHONE_FIELDS: Array<[string, Builder, string]> = [
  [
    'profile · contactPersonNumber',
    buildProfileUpdateSchema,
    'contactPersonNumber',
  ],
  ['profile · homePhone', buildProfileUpdateSchema, 'homePhone'],
  ['profile · referrerMobile', buildProfileUpdateSchema, 'referrerMobile'],
  ['father · fatherMobile', buildFatherUpdateSchema, 'fatherMobile'],
  ['mother · motherMobile', buildMotherUpdateSchema, 'motherMobile'],
  ['guardian · guardianMobile', buildGuardianUpdateSchema, 'guardianMobile'],
];

describe('a numeric phone from the database survives a save', () => {
  it.each(PHONE_FIELDS)(
    '%s accepts the number production stores',
    (_label, build, field) => {
      const { touched, untouched } = bothBranches(build, field);
      // The untouched branch is the one that matters most: it is what an
      // unrelated edit sends, and it is where this broke.
      expect(untouched.safeParse(NUMERIC_PHONE).success).toBe(true);
      expect(touched.safeParse(NUMERIC_PHONE).success).toBe(true);
    }
  );

  it.each(PHONE_FIELDS)('%s still accepts a string', (_label, build, field) => {
    const { touched, untouched } = bothBranches(build, field);
    expect(untouched.safeParse('87796901').success).toBe(true);
    expect(touched.safeParse('+6587796901').success).toBe(true);
  });

  it('postal code accepts a number too', () => {
    const { touched, untouched } = bothBranches(
      buildProfileUpdateSchema,
      'postalCode'
    );
    expect(untouched.safeParse(NUMERIC_POSTAL).success).toBe(true);
    expect(touched.safeParse(NUMERIC_POSTAL).success).toBe(true);
  });
});

describe('coercion does not weaken the format rules a registrar sees', () => {
  it('still rejects letters in a phone the registrar just edited', () => {
    const { touched } = bothBranches(
      buildProfileUpdateSchema,
      'contactPersonNumber'
    );
    expect(touched.safeParse('not a phone').success).toBe(false);
  });

  it('still lets an untouched malformed legacy value round-trip', () => {
    // The whole point of the gated builders (KD-adjacent, see their comment):
    // a bad value already in the database must not block an unrelated edit.
    const { untouched } = bothBranches(
      buildProfileUpdateSchema,
      'contactPersonNumber'
    );
    expect(untouched.safeParse('ext. 4412').success).toBe(true);
  });

  it('an empty string still becomes null', () => {
    const { touched } = bothBranches(
      buildProfileUpdateSchema,
      'contactPersonNumber'
    );
    const parsed = touched.safeParse('') as {
      success: boolean;
      data?: unknown;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeNull();
  });
});
