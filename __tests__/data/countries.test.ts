import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, COUNTRY_NAME_SET } from '@/lib/data/countries';

describe('COUNTRY_NAMES', () => {
  it('is non-empty', () => {
    expect(COUNTRY_NAMES.length).toBeGreaterThan(100);
  });

  it('contains real country names used at HFSE', () => {
    expect(COUNTRY_NAMES).toContain('Philippines');
    expect(COUNTRY_NAMES).toContain('Singapore');
  });

  it('has no duplicate entries', () => {
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRY_NAMES.length);
  });

  it('is sorted alphabetically', () => {
    const sorted = [...COUNTRY_NAMES].sort((a, b) => a.localeCompare(b));
    expect(COUNTRY_NAMES).toEqual(sorted);
  });
});

describe('COUNTRY_NAME_SET', () => {
  it('contains every name from COUNTRY_NAMES', () => {
    for (const name of COUNTRY_NAMES) {
      expect(COUNTRY_NAME_SET.has(name)).toBe(true);
    }
  });

  it('rejects an arbitrary non-country string', () => {
    expect(COUNTRY_NAME_SET.has('Not A Real Country')).toBe(false);
  });
});
