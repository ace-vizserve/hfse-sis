import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCK_TIME,
  formatSgtLockTime,
  isoFromSgtParts,
  isPastGradingLock,
  sgtPartsFromIso,
} from '@/lib/grading/lock-time';

// Migration 186 — the grading deadline is an exact instant, entered and shown
// in Singapore time (UTC+8, no daylight saving).

describe('isoFromSgtParts / sgtPartsFromIso', () => {
  it('converts Singapore wall time to UTC', () => {
    expect(isoFromSgtParts('2026-03-20', '17:30')).toBe(
      '2026-03-20T09:30:00.000Z'
    );
  });

  it('a date with no time is the whole day (23:59)', () => {
    expect(DEFAULT_LOCK_TIME).toBe('23:59');
    expect(isoFromSgtParts('2026-03-20', '')).toBe('2026-03-20T15:59:00.000Z');
  });

  it('crosses midnight correctly', () => {
    // 07:00 SGT on the 21st is 23:00 UTC on the 20th.
    expect(isoFromSgtParts('2026-03-21', '07:00')).toBe(
      '2026-03-20T23:00:00.000Z'
    );
    expect(sgtPartsFromIso('2026-03-20T23:00:00.000Z')).toEqual({
      date: '2026-03-21',
      time: '07:00',
    });
  });

  it('round-trips, including Postgres timestamptz output', () => {
    expect(sgtPartsFromIso('2026-03-20T15:59:00+00:00')).toEqual({
      date: '2026-03-20',
      time: '23:59',
    });
  });

  it('rejects malformed input', () => {
    expect(isoFromSgtParts('', '10:00')).toBeNull();
    expect(isoFromSgtParts('2026-3-2', '10:00')).toBeNull();
    expect(isoFromSgtParts('2026-03-20', '25:00')).toBeNull();
    expect(sgtPartsFromIso(null)).toEqual({ date: '', time: '' });
    expect(sgtPartsFromIso('nonsense')).toEqual({ date: '', time: '' });
  });
});

describe('isPastGradingLock', () => {
  const lockAt = '2026-03-20T15:59:00.000Z'; // 20 Mar 23:59 SGT
  const before = new Date('2026-03-20T15:58:59.000Z');
  const at = new Date('2026-03-20T15:59:00.000Z');
  const after = new Date('2026-03-20T16:30:00.000Z');

  it('no deadline is never past', () => {
    expect(isPastGradingLock(null, null, after)).toBe(false);
  });

  it('locks at the exact minute', () => {
    expect(isPastGradingLock(lockAt, null, before)).toBe(false);
    expect(isPastGradingLock(lockAt, null, at)).toBe(true);
    expect(isPastGradingLock(lockAt, null, after)).toBe(true);
  });

  it('an unlock after the deadline reopens the sheet', () => {
    expect(isPastGradingLock(lockAt, '2026-03-20T16:10:00.000Z', after)).toBe(
      false
    );
  });

  it('an unlock from before the deadline does not', () => {
    expect(isPastGradingLock(lockAt, '2026-03-19T02:00:00.000Z', after)).toBe(
      true
    );
  });
});

describe('formatSgtLockTime', () => {
  it('reads in Singapore time with the minute', () => {
    const s = formatSgtLockTime('2026-03-20T15:59:00.000Z');
    expect(s).toMatch(/20 Mar 2026/);
    expect(s).toMatch(/11:59\s?pm/i);
  });

  it('is blank for nothing', () => {
    expect(formatSgtLockTime(null)).toBe('');
  });
});
