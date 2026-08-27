import { describe, it, expect } from 'vitest';

import {
  parseActivityParams,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '@/lib/activity/params';

function search(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe('parseActivityParams — limit', () => {
  const cases: Array<{
    name: string;
    raw: string | undefined;
    expected: number;
  }> = [
    { name: 'absent', raw: undefined, expected: DEFAULT_LIMIT },
    // ⚠ F1 regression: 0 itself is fine (0 > 0 is false, falls to default),
    // but anything in the open interval (0, 1) — e.g. 0.5 — used to survive
    // both guards and then Math.trunc to 0, which reads identically to "no
    // more events" at the caller. The floor of 1 closes that gap.
    { name: '0', raw: '0', expected: DEFAULT_LIMIT },
    { name: '0.5', raw: '0.5', expected: 1 },
    { name: '1e-10', raw: '1e-10', expected: 1 },
    { name: '-1', raw: '-1', expected: DEFAULT_LIMIT },
    { name: 'NaN', raw: 'NaN', expected: DEFAULT_LIMIT },
    { name: 'abc', raw: 'abc', expected: DEFAULT_LIMIT },
    { name: '1', raw: '1', expected: 1 },
    { name: '20', raw: '20', expected: 20 },
    { name: '9999', raw: '9999', expected: MAX_LIMIT },
    { name: 'Infinity', raw: 'Infinity', expected: DEFAULT_LIMIT },
  ];

  for (const { name, raw, expected } of cases) {
    it(`limit=${name} resolves to ${expected}`, () => {
      const params = raw === undefined ? search({}) : search({ limit: raw });
      const { limit } = parseActivityParams(params);
      expect(limit).toBe(expected);
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(MAX_LIMIT);
    });
  }
});

describe('parseActivityParams — tab', () => {
  it('defaults to general when absent', () => {
    expect(parseActivityParams(search({})).tab).toBe('general');
  });

  for (const tab of ['general', 'grade_change', 'student_declaration']) {
    it(`accepts ${tab}`, () => {
      expect(parseActivityParams(search({ tab })).tab).toBe(tab);
    });
  }

  it('falls back to general for an unrecognised tab', () => {
    expect(parseActivityParams(search({ tab: 'bogus' })).tab).toBe('general');
  });
});

describe('parseActivityParams — cursor', () => {
  it('is null when absent', () => {
    expect(parseActivityParams(search({})).cursor).toBeNull();
  });

  it('is null for an empty string', () => {
    expect(parseActivityParams(search({ cursor: '' })).cursor).toBeNull();
  });

  it('is null when there is no separator', () => {
    expect(
      parseActivityParams(search({ cursor: 'no-pipe-here' })).cursor
    ).toBeNull();
  });

  it('parses a well-formed cursor', () => {
    expect(
      parseActivityParams(
        search({ cursor: '2026-08-24T01:40:00.000Z|evt-123' })
      ).cursor
    ).toEqual({ at: '2026-08-24T01:40:00.000Z', id: 'evt-123' });
  });

  it('rejoins extra separators into the id, not a half-built object', () => {
    const parsed = parseActivityParams(
      search({ cursor: '2026-08-24T01:40:00.000Z|evt|123|extra' })
    );
    expect(parsed.cursor).toEqual({
      at: '2026-08-24T01:40:00.000Z',
      id: 'evt|123|extra',
    });
  });

  it('is null when the id half is empty (trailing separator)', () => {
    expect(
      parseActivityParams(search({ cursor: '2026-08-24T01:40:00.000Z|' }))
        .cursor
    ).toBeNull();
  });
});
