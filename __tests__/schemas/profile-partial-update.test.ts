/**
 * A profile PATCH carries only the fields the edit sheet renders — and only
 * those get written.
 *
 * THE BUG. `components/sis/edit-profile-sheet.tsx` draws about 60 of this
 * schema's ~85 fields. The medical block (`allergies`, `asthma`,
 * `allergyDetails`, …) is deliberately never drawn: parents supply it on the
 * application form and it is not the school's to edit. So the sheet submits
 * only what it renders.
 *
 * Every key was required. `allergies` is `z.boolean().nullable()`, which
 * rejects `undefined`, so every save failed validation on ~24 fields nobody
 * could see or fix. React Hook Form's `handleSubmit(onSubmit)` with no invalid
 * handler is silent, so the button simply did nothing — reported that way by
 * Mr Ace on 2026-08-14, and true since the sheet was written.
 *
 * ⚠ THE SECOND HALF, WHICH IS WHY THIS FILE EXISTS RATHER THAN A ONE-LINE FIX.
 * The repair that suggests itself — default the missing fields to null so the
 * shape is complete — is worse than the bug. `parsed.data` of a non-partial
 * schema carries EVERY key, and `app/api/sis/students/[enroleeNumber]/profile/
 * route.ts` passes it straight to `.update()`. The first successful save would
 * have written null over every medical field on that student. The validation
 * failure was the only thing standing between a name change and silent data
 * loss.
 *
 * So the schema is partial, and the second test below is the one that matters:
 * absent keys must stay absent through parsing, never reappear as nulls.
 */
import { describe, expect, it } from 'vitest';

import {
  buildProfileUpdateSchema,
  ProfileUpdateSchema,
} from '@/lib/schemas/sis';

/** Fields the sheet never renders — the ones that used to block every save. */
const NEVER_RENDERED = [
  'allergies',
  'allergyDetails',
  'asthma',
  'epilepsy',
  'diabetes',
] as const;

/** A realistic submit: the sheet changed one name and sent what it draws. */
const SHEET_SUBMIT = {
  firstName: 'Testing Seven',
  middleName: null,
  lastName: 'Testing Seven',
  preferredName: 'Testing Seven',
  nric: 'M0430142T',
  birthDay: '2018-02-14',
  gender: 'Male',
  nationality: 'Angola',
  homePhone: '123123',
  postalCode: '123123',
};

describe('profile PATCH schema', () => {
  it('accepts a submit that omits the fields the sheet does not render', () => {
    const result = buildProfileUpdateSchema(new Set()).safeParse(SHEET_SUBMIT);

    expect(result.success).toBe(true);
  });

  it('does not invent nulls for the omitted fields', () => {
    // The data-loss guard. If these come back as `null`, the route writes null
    // over a student's real medical record on the next name change.
    const result = buildProfileUpdateSchema(new Set()).safeParse(SHEET_SUBMIT);
    if (!result.success) throw new Error('expected the submit to validate');

    for (const field of NEVER_RENDERED) {
      expect(field in result.data).toBe(false);
    }
  });

  it('still rejects a value that is present and wrong', () => {
    // Partial must not become permissive: a field the user DID touch is
    // validated exactly as before.
    const result = buildProfileUpdateSchema(new Set(['nric'])).safeParse({
      ...SHEET_SUBMIT,
      nric: 'nonsense',
    });

    expect(result.success).toBe(false);
  });

  it('still accepts a complete object, so the API contract has not narrowed', () => {
    const everything = Object.fromEntries(
      Object.keys(ProfileUpdateSchema.shape).map((k) => [k, null])
    );
    const result = buildProfileUpdateSchema(new Set()).safeParse(everything);

    expect(result.success).toBe(true);
  });

  it('keeps the medical fields in the schema — they are readable, just not edited here', () => {
    // If one of these disappears from the schema the route's `allowedCols`
    // filter would start dropping it, which is a different bug wearing the
    // same clothes.
    for (const field of NEVER_RENDERED) {
      expect(Object.keys(ProfileUpdateSchema.shape)).toContain(field);
    }
  });
});
