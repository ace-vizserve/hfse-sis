// __tests__/sis/backfill/enrollment/name-match.test.ts
import { describe, expect, it } from 'vitest';

import {
  matchName,
  parseSheetFullName,
  similarityRatio,
  type CandidateName,
} from '@/lib/sis/backfill/enrollment/name-match';

describe('parseSheetFullName', () => {
  it('splits "LAST, First Middle." into last + firstMiddle', () => {
    expect(parseSheetFullName('BEDICO, Miguel Zion C.')).toEqual({
      lastName: 'BEDICO',
      firstMiddle: 'Miguel Zion C.',
    });
  });

  it('falls back to treating the whole string as last name when no comma', () => {
    expect(parseSheetFullName('NoComma')).toEqual({
      lastName: 'NoComma',
      firstMiddle: '',
    });
  });
});

describe('matchName', () => {
  const candidates: CandidateName[] = [
    {
      enroleeNumber: 'E260092',
      studentNumber: 'H220038',
      lastName: 'Bedico',
      firstName: 'Miguel Zion',
      middleName: 'Cabrera',
    },
    {
      enroleeNumber: 'E260093',
      studentNumber: 'H190240',
      lastName: 'Alvarez',
      firstName: 'Jaime',
      middleName: 'Dela Cruz',
    },
    {
      enroleeNumber: 'E260094',
      studentNumber: 'H190241',
      lastName: 'Alvarez',
      firstName: 'Jaime',
      middleName: 'Santos',
    },
  ];

  it('returns an exact match when last+first+middle all match', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion Cabrera' },
      candidates
    );
    expect(result.tier).toBe('exact');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns a strong match when middle name is abbreviated to an initial', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion C.' },
      candidates
    );
    expect(result.tier).toBe('strong');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns a strong match when middle name is omitted entirely', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion' },
      candidates
    );
    expect(result.tier).toBe('strong');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns none when two same-surname candidates are equally ambiguous', () => {
    const result = matchName(
      { lastName: 'ALVAREZ', firstMiddle: 'Jaime' },
      candidates
    );
    expect(result.tier).toBe('none');
    expect(result.candidate).toBeNull();
  });

  it('resolves an ambiguous surname when the middle name disambiguates', () => {
    const result = matchName(
      { lastName: 'ALVAREZ', firstMiddle: 'Jaime Santos' },
      candidates
    );
    // Full first+middle match against exactly one candidate ("Santos") —
    // this is actually an exact match, not merely a strong one; the other
    // candidate ("Dela Cruz") is ruled out at the "Santos" vs "Dela"
    // token position, not via ambiguity tolerance.
    expect(result.tier).toBe('exact');
    expect(result.candidate?.enroleeNumber).toBe('E260094');
  });

  it('returns none for a completely unrelated name', () => {
    const result = matchName(
      { lastName: 'ZZTOPP', firstMiddle: 'Nobody Here' },
      candidates
    );
    expect(result.tier).toBe('none');
  });

  it('returns a fuzzy match for a minor typo when it is uniquely close', () => {
    const result = matchName(
      { lastName: 'BEDIKO', firstMiddle: 'Miguel Zion Cabrera' },
      candidates
    );
    expect(result.tier).toBe('fuzzy');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });
});

describe('similarityRatio', () => {
  it('is 1 for identical strings', () => {
    expect(similarityRatio('ABC', 'ABC')).toBe(1);
  });

  it('is 0 for completely different strings of equal length', () => {
    expect(similarityRatio('AAAA', 'ZZZZ')).toBe(0);
  });

  it('is between 0 and 1 for a near match', () => {
    const r = similarityRatio('BEDICO', 'BEDIKO');
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(1);
  });
});
