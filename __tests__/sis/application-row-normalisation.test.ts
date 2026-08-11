/**
 * `ApplicationRow` types the phone/postal columns as `string | null`. The
 * parent portal stores them as NUMBERS. Something has to make the row match
 * the type that describes it, and this pins that something.
 *
 * Measured against `ay2026_enrolment_applications` on 2026-08-10:
 * `motherMobile` is a `number` on 498 of 498 rows, `contactPersonNumber` on
 * 498, `fatherMobile` on 474, `guardianMobile` on 120.
 *
 * Two separate failures came out of the untyped gap, and the second is the
 * reason a type test is not enough on its own:
 *   - the Classroom drawer threw `value.toLowerCase is not a function`
 *   - both SIS edit sheets carried the number BACK to the server on save,
 *     where the whole form 400'd — a registrar editing a preferred name lost
 *     the edit over a field they never touched.
 */

import { describe, expect, it } from 'vitest';

import { normaliseApplicationRow } from '@/lib/sis/queries';

const NUMERIC_COLUMNS = [
  'motherMobile',
  'fatherMobile',
  'guardianMobile',
  'contactPersonNumber',
  'homePhone',
  'referrerMobile',
  'postalCode',
] as const;

describe('a numeric column arrives as text', () => {
  it.each(NUMERIC_COLUMNS)('coerces %s', (column) => {
    const row = normaliseApplicationRow({ [column]: 87796901 }) as Record<
      string,
      unknown
    >;
    expect(row[column]).toBe('87796901');
    expect(typeof row[column]).toBe('string');
  });

  it('coerces every one of them on a single row, not just the first', () => {
    const row = normaliseApplicationRow({
      motherMobile: 87796901,
      fatherMobile: 87800781,
      contactPersonNumber: 87796901,
      postalCode: 123456,
    }) as Record<string, unknown>;
    expect(Object.values(row).every((v) => typeof v === 'string')).toBe(true);
  });
});

describe('what it must not touch', () => {
  it('leaves a value that is already text alone', () => {
    const row = normaliseApplicationRow({
      motherMobile: '+65 8779 6901',
    }) as Record<string, unknown>;
    expect(row.motherMobile).toBe('+65 8779 6901');
  });

  it('leaves null as null rather than the string "null"', () => {
    const row = normaliseApplicationRow({ fatherMobile: null }) as Record<
      string,
      unknown
    >;
    expect(row.fatherMobile).toBeNull();
  });

  it('leaves every other column untouched', () => {
    // Only the phone/postal family is coerced. A number arriving in a name or
    // a date is a real bug and must stay visible, not be papered over.
    const row = normaliseApplicationRow({
      firstName: 'Phoebe',
      birthDay: '2015-04-02',
      allergies: true,
      levelApplied: 5,
    }) as Record<string, unknown>;
    expect(row.firstName).toBe('Phoebe');
    expect(row.allergies).toBe(true);
    expect(row.levelApplied).toBe(5);
  });

  it('does not mutate the row it was given', () => {
    const raw: Record<string, unknown> = { motherMobile: 87796901 };
    normaliseApplicationRow(raw);
    expect(raw.motherMobile).toBe(87796901);
  });
});
