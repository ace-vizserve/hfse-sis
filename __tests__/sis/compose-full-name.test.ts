/**
 * The full name the profile sheet fills in from the three name fields.
 *
 * WHY IT COMPOSES RATHER THAN SPLITS. The request was the other way round —
 * lock First/Middle/Last and edit only the full name, "since it updates them
 * all". It does not: nothing derives the parts from it, and the name on class
 * lists, mark sheets and report cards (`public.students`) syncs ONLY from
 * firstName/middleName/lastName. Editing just the full name would change the
 * admissions screens and leave every roster showing the old name.
 *
 * Splitting a full name back into parts is not a way out either. This school's
 * roll carries DELA CRUZ, SAN JOSE and SANTHOSH KUMAR — a splitter puts the
 * wrong half in the wrong column on every one of them.
 *
 * So the parts stay the source of truth and the full name follows. The format
 * is `Last, First Middle`, which is what the admissions rows already hold:
 * "Cruz, Ana", "TEST, TESTING TWO", "LORENZO, Nathaniel Inigo M.".
 */
import { describe, expect, it } from 'vitest';

import { composeFullName } from '@/lib/sis/full-name';

describe('composeFullName', () => {
  it('writes Last, First', () => {
    expect(composeFullName({ firstName: 'Ana', lastName: 'Cruz' })).toBe(
      'Cruz, Ana'
    );
  });

  it('includes the middle name after the first', () => {
    expect(
      composeFullName({
        firstName: 'Nathaniel',
        middleName: 'Inigo',
        lastName: 'Lorenzo',
      })
    ).toBe('Lorenzo, Nathaniel Inigo');
  });

  it('keeps a multi-word surname whole', () => {
    // The case that rules out splitting. Composing never has to guess.
    expect(composeFullName({ firstName: 'Juan', lastName: 'Dela Cruz' })).toBe(
      'Dela Cruz, Juan'
    );
  });

  it('preserves the case the user typed', () => {
    // Stored data is inconsistent — "Cruz, Ana" alongside "TEST, TESTING TWO" —
    // so forcing a case here would fight whatever they meant.
    expect(
      composeFullName({ firstName: 'TESTING TWO', lastName: 'TEST' })
    ).toBe('TEST, TESTING TWO');
  });

  it('trims stray whitespace', () => {
    expect(composeFullName({ firstName: '  Ana  ', lastName: ' Cruz ' })).toBe(
      'Cruz, Ana'
    );
  });

  describe('partly-filled names — no stray comma', () => {
    it('drops the comma when there is no surname', () => {
      expect(composeFullName({ firstName: 'Ana', lastName: null })).toBe('Ana');
    });

    it('drops the comma when there is only a surname', () => {
      expect(composeFullName({ firstName: '', lastName: 'Cruz' })).toBe('Cruz');
    });

    it('returns an empty string when nothing is filled in', () => {
      expect(composeFullName({})).toBe('');
    });

    it('ignores a blank middle name rather than doubling the space', () => {
      expect(
        composeFullName({
          firstName: 'Ana',
          middleName: '   ',
          lastName: 'Cruz',
        })
      ).toBe('Cruz, Ana');
    });
  });
});
